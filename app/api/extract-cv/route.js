import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

// Conservative cap — comfortably covers a real multi-page CV while staying
// well under Vercel's inbound request-body limit (~4.5MB on Hobby) and
// Claude's own document-input limits.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

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
      messageContent = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } },
        { type: "text", text: "Extract this CV's data as instructed in the system prompt." },
      ];
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
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: messageContent }],
    });

    const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
    const jsonText = stripJsonFences(raw);

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (err) {
      console.error("Failed to parse CV extraction JSON:", err, "raw (first 500 chars):", raw.slice(0, 500));
      return NextResponse.json({ error: "تعذّر قراءة بيانات السيرة الذاتية تلقائياً من الملف. يمكنك المتابعة وتعبئة النموذج يدوياً." }, { status: 502 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error("CV extraction failed:", err);
    return NextResponse.json({ error: "تعذّر معالجة الملف. حاول مرة أخرى أو ابدأ من نموذج فارغ." }, { status: 500 });
  }
}
