import { NextResponse } from "next/server";
import mammoth from "mammoth";
// The internal path avoids pdf-parse's top-level index.js, which runs a
// debug self-test against a bundled sample file when required in certain
// module contexts (a known issue with this package) — importing the
// library module directly skips that entirely.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Comfortably above two full per-attempt timeouts back-to-back (worst case
// PER_ATTEMPT_TIMEOUT_MS twice, plus a short backoff between them) plus
// headroom for document reading/parsing and response overhead.
export const maxDuration = 120;

// Per-attempt timeout, not the total retry budget — the SDK's own default
// (10 minutes) would let a single hung attempt swallow the entire bounded
// window on its own. maxRetries: 0 disables the SDK's built-in retry too,
// so retryWithBackoff has exclusive, observable control over every retry
// (one call to .create() below is exactly one logged attempt). Longer than
// the other AI routes' per-attempt budget — a full CV extraction reads a
// whole document (potentially multi-page, image-heavy PDF) AND generates
// up to 16000 output tokens, which genuinely takes longer than a short
// summary or a handful of polished lines. 25s was proving too tight in
// production — real CVs were consistently hitting this ceiling on every
// attempt (a client-side timeout, not a real API error), so this is raised
// with real headroom instead of just enough for the fastest case.
const PER_ATTEMPT_TIMEOUT_MS = 45_000;

// Wider than the default 40s window (see retryWithBackoff) so a second
// attempt isn't cut off before it even gets to run its own full timeout —
// with a 45s per-attempt budget, a default 40s window would let the first
// slow-but-not-hung attempt exhaust the window on its own and skip the
// retry entirely. Sized to allow exactly two full-length attempts
// (45s + ~1s backoff + 45s ≈ 91s) and then stop — not a third, which
// wouldn't have room to finish inside maxDuration (120s) anyway.
const RETRY_WINDOW_MS = 90_000;

// Conservative cap — comfortably covers a real multi-page CV while staying
// well under Vercel's inbound request-body limit (~4.5MB on Hobby) and
// Claude's own document-input limits.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Below this, treat the PDF as having no usable text layer (a scan/image)
// and fall back to document vision instead — a real CV's text layer runs
// into the thousands of characters, so this only catches the genuine
// scanned-PDF case, not a short-but-real CV.
const MIN_PDF_TEXT_CHARS = 200;

// Extraction only — never translates or rephrases (that happens later, at
// preview time, through the same AI-enhancement pipeline every other CV
// field already goes through). Field names match the shape the client
// (AtsCvBuilder's applyExtractedData) expects, but deliberately stay
// "plain" — e.g. a bare city/degree/university string rather than the
// form's internal choice/custom split — since matching those against the
// option lists is simpler and more reliable done deterministically on the
// client, which already has those lists in scope.
const SYSTEM_PROMPT = `You are a CV data-extraction assistant. Read the applicant's CV (attached) and extract its content into STRICT JSON matching exactly this shape. Return ONLY the JSON object — no prose, no markdown code fences, no explanation before or after it.

{
  "detectedLanguage": "ar" | "en",
  "name": string, "email": string, "phone": string, "city": string, "linkedin": string, "yearsOfExperience": string,
  "targetRoles": string[],
  "experiences": [{ "title": string, "employer": string, "fromMonth": number|null, "fromYear": string, "toMonth": number|null, "toYear": string, "current": boolean, "bullets": string[] }],
  "education": [{ "degree": string, "major": string, "university": string, "year": string, "gpa": string, "gradProject": string }],
  "techSkills": string[],
  "softSkills": string[],
  "languages": [{ "name": string, "level": string }],
  "achievements": string[],
  "courses": [{ "name": string, "hours": string, "provider": string, "date": string }],
  "certifications": [{ "name": string, "issuingBody": string, "date": string }],
  "otherSections": [{ "title": string, "points": string[] }]
}

Rules:
- Extract ONLY what is actually written in the CV. NEVER invent, guess, or embellish any fact, number, date, employer, or achievement not present in the source document.
- If a field isn't present in the CV, use an empty string "" (or an empty array, or null for month numbers) — never fabricate a plausible-sounding value to fill a gap.
- "detectedLanguage": the CV's own dominant language — "ar" if it's written mainly in Arabic, "en" if mainly in English. Judge this from the bulk of the document's prose (summary, bullet points, section text), not from isolated proper nouns, tool names, or a bilingual header/contact line.
- fromMonth/toMonth must be a plain integer 1-12 (1 = January) if a month is stated in that entry's date range, otherwise null. Never a month name or any other format.
- "current" is true only if the CV explicitly indicates the applicant still works there (e.g. "Present", "current", "حتى الآن", "لا يزال يعمل").
- targetRoles: if the CV doesn't state a target/desired role explicitly, you may infer ONE likely target role from the applicant's most recent/prominent job title — never invent a role unrelated to their actual experience. If genuinely unclear, return an empty array.
- Put achievements, training courses, and certifications/memberships into their respective arrays if the CV has such sections. Put ANY other distinct, substantive content that doesn't fit any field above (e.g. volunteering, publications, notable projects) into "otherSections" as one or more {title, points} entries, using a section title drawn from the CV itself.
- Write every extracted text value in whatever language it actually appears in the source CV — do NOT translate anything during extraction. Translation (if needed) happens later, separately.
- Keep bullet points and achievement/course/certification entries in the applicant's own words, only lightly cleaned up (trimmed whitespace, stray line-break artifacts) — never rephrase, embellish, or add claims that aren't in the source.
- Return ONLY the JSON object described above.`;

function stripJsonFences(raw) {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export async function POST(request) {
  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "الرجاء اختيار ملف السيرة الذاتية (PDF أو Word)." }, { status: 400 });
    }

    const fileName = (file.name || "").toLowerCase();
    const isPdf = fileName.endsWith(".pdf");
    const isDocx = fileName.endsWith(".docx");
    if (!isPdf && !isDocx) {
      return NextResponse.json({ error: "صيغة الملف غير مدعومة. الرجاء رفع ملف PDF أو Word (.docx)." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "حجم الملف كبير جداً (الحد الأقصى 4 ميجابايت)." }, { status: 400 });
    }

    // Read entirely into memory and never written anywhere (no disk, no
    // Blob storage) — discarded the moment this request finishes.
    const buffer = Buffer.from(await file.arrayBuffer());

    let messageContent;
    if (isPdf) {
      // Most CVs are text-layer PDFs (exported from Word, Canva, etc.), not
      // scans — extracting that text locally and sending it as plain text
      // (same as the .docx path below) is both far faster and more reliable
      // than making Claude run its own page-image vision pipeline on every
      // upload, which was the actual cause of production timeouts: a request
      // routed through vision processing is much slower and more variable in
      // latency than a plain-text request, even for a small file. Vision is
      // kept as a fallback for the genuine minority case — a scanned/
      // image-only PDF with no extractable text layer.
      let pdfText = "";
      try {
        const parsed = await pdfParse(buffer);
        pdfText = (parsed.text || "").trim();
      } catch (err) {
        console.warn("[EXTRACT-CV] Local PDF text extraction failed, falling back to document vision:", err?.message);
      }

      if (pdfText.length >= MIN_PDF_TEXT_CHARS) {
        messageContent = [{ type: "text", text: `Extract this CV's data as instructed in the system prompt.\n\n---\n${pdfText}` }];
      } else {
        messageContent = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } },
          { type: "text", text: "Extract this CV's data as instructed in the system prompt." },
        ];
      }
    } else {
      let text;
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = (result.value || "").trim();
      } catch (err) {
        console.error("Failed to extract text from .docx:", err);
        return NextResponse.json({ error: "تعذّر قراءة ملف Word. تأكد من أن الملف سليم وحاول مرة أخرى." }, { status: 400 });
      }
      if (!text) {
        return NextResponse.json({ error: "لم يتم العثور على نص قابل للقراءة في الملف." }, { status: 400 });
      }
      messageContent = [{ type: "text", text: `Extract this CV's data as instructed in the system prompt.\n\n---\n${text}` }];
    }

    const client = getAnthropicClient();

    // Bounded, backed-off retry: any failure — thrown error (network,
    // timeout, any HTTP status) OR an empty/unparseable response — retries
    // within the window; only an auth/bad-request error skips straight to
    // the fallback below (see retryWithBackoff). A parse failure carries
    // its raw-text preview + stop_reason along on the thrown error so the
    // final failure log below still has that diagnostic detail.
    const extractResult = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            // A detailed, multi-role real-world CV can easily need several
            // thousand output tokens for its JSON — 4096 was cutting genuine
            // CVs off mid-string (truncated/invalid JSON). This is
            // comfortably above what even a long, senior-level CV should
            // require.
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: messageContent }],
          },
          { maxRetries: 0, timeout: PER_ATTEMPT_TIMEOUT_MS }
        );

        const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
        if (!raw) throw new Error("Empty response from Claude");

        const jsonText = stripJsonFences(raw);
        try {
          return JSON.parse(jsonText);
        } catch (parseErr) {
          const err = new Error(`Failed to parse extraction JSON: ${parseErr.message}`);
          err.rawPreview = raw.slice(0, 500);
          err.stopReason = message.stop_reason;
          throw err;
        }
      },
      { logTag: "[EXTRACT-CV-RETRY]", windowMs: RETRY_WINDOW_MS }
    );

    if (!extractResult.ok) {
      console.error("[EXTRACT-CV-ERROR]", {
        message: extractResult.error?.message,
        name: extractResult.error?.name,
        stack: extractResult.error?.stack,
        attempts: extractResult.attempts,
        stoppedEarly: !!extractResult.stoppedEarly,
        rawPreview: extractResult.error?.rawPreview,
        stopReason: extractResult.error?.stopReason,
      });
      return NextResponse.json({ error: "تعذّر قراءة بيانات السيرة الذاتية تلقائياً من الملف. أعد المحاولة، أو يمكنك المتابعة وتعبئة النموذج يدوياً." }, { status: 502 });
    }

    return NextResponse.json({ data: extractResult.result });
  } catch (err) {
    console.error("CV extraction failed:", err);
    return NextResponse.json({ error: "تعذّر معالجة الملف. حاول مرة أخرى أو ابدأ من نموذج فارغ." }, { status: 500 });
  }
}
