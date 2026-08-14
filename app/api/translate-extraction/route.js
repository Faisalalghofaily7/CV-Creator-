import { NextResponse } from "next/server";
import { APIError } from "@anthropic-ai/sdk";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Chunks run concurrently (see CHUNK_SIZE below), so total wall time is
// bounded by the slowest chunk's own retry window, not the sum of all of
// them — this just needs headroom above one chunk's window plus an
// in-flight attempt still running when that window closed.
export const maxDuration = 60;

// Per-attempt timeout, not the total retry budget — see enhance-items'
// route for the same convention (maxRetries: 0 disables the SDK's own
// retry so retryWithBackoff has exclusive, observable control).
const PER_ATTEMPT_TIMEOUT_MS = 20_000;
// Bounded-retry window per CHUNK (see CHUNK_SIZE) — smaller than the
// other routes' default ~40s since a chunk's own response is short and
// should complete quickly; still enough room for 2-3 attempts.
const CHUNK_WINDOW_MS = 30_000;

// This route only ever handles the short, structured "leftover" fields
// from a CV upload (job title, employer, an unmatched dropdown's custom
// text, a skill tag, a course/certification name...) — never a whole
// paragraph — so this cap is generous on purpose.
const MAX_TERMS = 120;

// A real, detailed CV can easily produce 30-40+ of these leftover values
// (several experiences' titles/employers, unmatched skills, course and
// certification names...) once translation was extended to cover all of
// them. Sending that many in ONE request risks the model running out of
// its max_tokens budget partway through — observed in production as the
// response coming back with far fewer lines than requested (e.g. "Expected
// 38 translated lines, got 3"), which fails the whole batch and falls back
// to leaving EVERY item untranslated, even ones that would have succeeded
// on their own. Splitting into small chunks, each retried independently
// and run in parallel, means a struggling chunk only costs its own items —
// not the whole CV's translation — and each chunk's response is short
// enough that max_tokens is never remotely in question.
const CHUNK_SIZE = 15;

// Used only when a CV was uploaded in one language but the applicant
// selected the other as their CV's output language (see the mismatch
// popup in AtsCvBuilder.jsx). Unlike enhance-items (which polishes the
// applicant's own prose), this route's ONLY job is a faithful translation
// of short, already-extracted values — it must never invent, embellish, or
// guess at content that isn't already there.
function buildSystemPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are translating short CV data values (job titles, employer names, skill names, course/certification names, years-of-experience phrases, GPA/grade descriptions, and similar short labels — never full sentences) into ${languageName}, for an applicant whose CV was uploaded in a different language than the one they chose for their final CV.

Rules:
- Translate ONLY — never invent, embellish, or add any fact, qualifier, or detail that isn't already in the source value. In particular, never add a unit/label word (e.g. "years", "years of experience", "GPA", "out of") that is NOT already present in the source value — several of these values (like years of experience or a GPA) are displayed next to a label the application adds separately, so inventing your own copy of that label produces a visibly duplicated label in the final CV.
- Every word that IS already in the source must end up in ${languageName} — a value that mixes a number with connective/descriptive words already present in the source language (e.g. "أكثر من ثماني سنوات", "4.5 من 5") must come back with exactly those same words translated (e.g. "More than eight years", "4.5 of 5") — never leave a connective word or short phrase behind in the source language just because a number sits next to it, but also never pad the result with extra words the source didn't have (e.g. a bare "5+" must come back as just "5+", NOT "5+ years" or "5+ years experience").
- Do NOT translate literally where it would be wrong to do so. Keep the ORIGINAL, unchanged form for:
  - Technical terms, tools, and software names (e.g. Power BI, Python, SQL, Excel, SAP, Photoshop, AutoCAD) — always keep these in their original Latin form, even inside an Arabic translation.
  - Brand and company names that are conventionally written in English (e.g. Google, Microsoft) — keep as-is.
  - Emails, URLs, LinkedIn handles, and bare numbers with nothing else to translate — leave completely unchanged.
  - A well-known Saudi/Arab organization's own conventional Arabic name may be used when translating into Arabic (e.g. "King Saud University" -> "جامعة الملك سعود"); if you are not confident of the correct proper-noun form, keep the original text unchanged rather than guessing.
- DO translate genuine generic role/skill/field terms into natural, professional ${languageName} (e.g. "Project Manager" -> "مدير مشاريع", "Teamwork" -> "العمل الجماعي").
- If a value is already entirely in ${languageName}, or has nothing translatable in it (e.g. it's just a bare number or an email), return it completely unchanged.
- Return the results in the same order, one per line, no numbering, no headings, no preamble, no explanation. Every input line must produce exactly one output line, even if unchanged.`;
}

// One request to the model, one parse attempt, throwing on anything that
// isn't a clean, matching-length result — retryWithBackoff treats a wrong
// line count exactly the same as a network/HTTP failure: this attempt
// didn't produce a usable result, try again within the same bounded window.
async function requestTranslation(client, lang, numbered, expectedCount) {
  const message = await client.messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: buildSystemPrompt(lang),
      messages: [{ role: "user", content: numbered }],
    },
    { maxRetries: 0, timeout: PER_ATTEMPT_TIMEOUT_MS }
  );
  const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // Defensive: strip any leading "1. " / "1)" the model adds despite
    // being told not to, so a stray numbering artifact never leaks in.
    // Requires at least one space after the punctuation (\s+, not \s*) —
    // otherwise this also matches (and corrupts) a legitimate value that
    // itself starts with a decimal number, e.g. "4.5 of 5" -> "5 of 5",
    // since "\d+[.).]" alone already matches the "4." in "4.5".
    .map((l) => l.replace(/^\d+[.).]\s+/, ""));

  if (lines.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} translated lines, got ${lines.length}`);
  }
  return lines;
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const lang = body.lang === "en" ? "en" : "ar";
  const terms = Array.isArray(body.terms)
    ? body.terms.map((x) => (typeof x === "string" ? x : ""))
    : [];

  if (!terms.length) {
    return NextResponse.json({ terms: [] });
  }
  if (terms.length > MAX_TERMS) {
    return NextResponse.json({ error: "عدد القيم كبير جداً." }, { status: 400 });
  }

  // Empty entries carry no position information for the model to translate
  // — send only the non-empty ones, and splice the (unchanged) empties back
  // into their original slots afterward so the returned array still lines
  // up 1:1 with the request.
  const nonEmptyIndexes = [];
  const nonEmptyTerms = [];
  terms.forEach((term, i) => {
    if (term.trim()) {
      nonEmptyIndexes.push(i);
      nonEmptyTerms.push(term.trim());
    }
  });

  if (!nonEmptyTerms.length) {
    return NextResponse.json({ terms });
  }

  const client = getAnthropicClient();

  // Split into small chunks (see CHUNK_SIZE) and retry each one
  // independently, in parallel — a chunk that ultimately fails falls back
  // to its own original terms without dragging down chunks that succeeded.
  const chunks = [];
  for (let start = 0; start < nonEmptyTerms.length; start += CHUNK_SIZE) {
    chunks.push({
      terms: nonEmptyTerms.slice(start, start + CHUNK_SIZE),
      indexes: nonEmptyIndexes.slice(start, start + CHUNK_SIZE),
    });
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk, chunkIdx) => {
      const numbered = chunk.terms.map((it, i) => `${i + 1}. ${it}`).join("\n");
      return retryWithBackoff(
        () => requestTranslation(client, lang, numbered, chunk.terms.length),
        { logTag: `[TRANSLATE-EXTRACTION-RETRY chunk ${chunkIdx + 1}/${chunks.length}]`, windowMs: CHUNK_WINDOW_MS }
      );
    })
  );

  const merged = [...terms];
  chunkResults.forEach((result, chunkIdx) => {
    const chunk = chunks[chunkIdx];
    if (result.ok) {
      result.result.forEach((translated, i) => {
        merged[chunk.indexes[i]] = translated;
      });
      return;
    }
    console.error(`[TRANSLATE-EXTRACTION-ERROR] chunk ${chunkIdx + 1}/${chunks.length}`, {
      message: result.error?.message,
      name: result.error?.name,
      stack: result.error?.stack,
      attempts: result.attempts,
      stoppedEarly: !!result.stoppedEarly,
      ...(result.error instanceof APIError && {
        anthropicStatus: result.error.status,
        anthropicErrorType: result.error.type,
        anthropicResponseBody: result.error.error,
      }),
    });
    // Never a 500 for a best-effort translation, and never a garbled/
    // partial chunk either — this chunk's original (untranslated) terms
    // are already sitting in `merged` (seeded from `terms` above), so
    // leaving them as-is is the fallback. The review-notice card still
    // applies either way, since a mismatch-triggered translation was
    // attempted for the CV as a whole.
  });

  if (chunkResults.every((r) => !r.ok)) {
    // Every chunk failed — surface the same best-effort error the caller
    // already handles by falling back to the untranslated values it sent.
    return NextResponse.json({ error: "تعذّر ترجمة بعض بيانات السيرة الذاتية تلقائياً." });
  }

  return NextResponse.json({ terms: merged });
}
