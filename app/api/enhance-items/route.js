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

// Per-attempt timeout, not the total retry budget — the SDK's own default
// (10 minutes) would let a single hung attempt swallow the entire bounded
// window on its own. maxRetries: 0 disables the SDK's built-in retry too,
// so retryWithBackoff has exclusive, observable control over every retry
// (one call to .create() below is exactly one logged attempt).
const PER_ATTEMPT_TIMEOUT_MS = 20_000;
// Bounded-retry window per CHUNK (see CHUNK_SIZE) — smaller than a
// whole-batch window since a chunk's own response is short and should
// complete quickly; still enough room for 2-3 attempts.
const CHUNK_WINDOW_MS = 30_000;

// Defensive cap — a real CV's bullets/achievements/graduation projects
// never come close to this; it just bounds the request if something odd
// gets sent.
const MAX_ITEMS = 60;

// A senior applicant's real CV can easily have 25-30+ bullets across
// several experiences plus achievements and custom-section points.
// Packing all of them into one request risks the model's max_tokens
// budget running out partway through the response — observed in
// production (on the sibling translate-extraction route, same failure
// shape) as the response coming back with far fewer lines than requested,
// which fails the whole batch and falls back to leaving EVERY item
// unenhanced, even ones that would have polished fine on their own.
// Splitting into small chunks, each retried independently and run in
// parallel, means a struggling chunk only costs its own items — not the
// whole CV's polish — and each chunk's response is short enough that
// max_tokens is never remotely in question.
const CHUNK_SIZE = 10;

function buildSystemPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are a professional CV writer for the Saudi market. Rewrite each of the following short entries into a single polished, professional CV line using a strong action verb, in ${languageName}.
Rules:
- Rephrase and elevate ONLY what is written. Do NOT invent numbers, metrics, tools, companies, or any facts not present.
- Keep each to roughly one line, concise and professional.
- Preserve the original meaning exactly.
- Every output line MUST be entirely in ${languageName}, even if the corresponding input entry was written in a different language (e.g. Arabic text submitted for an English CV, or vice versa) — translate it faithfully into ${languageName} before polishing it, never leave it in the original language.
- Return the results in the same order, one per line, no numbering, no headings, no preamble.`;
}

// One request to the model, one parse attempt, throwing on anything that
// isn't a clean, matching-length result — retryWithBackoff treats that
// exactly the same as a network/HTTP failure, so a wrong item count and a
// dropped connection both just mean "this attempt didn't work, try again"
// within the same bounded window.
async function requestEnhancement(client, lang, numbered, expectedCount) {
  const message = await client.messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: 1200,
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
    // otherwise this also matches (and corrupts) a legitimate polished
    // line that itself starts with a decimal number, e.g. a bullet like
    // "4.5 million SAR budget managed" -> "5 million SAR budget managed",
    // since "\d+[.).]" alone already matches the "4." in "4.5".
    .map((l) => l.replace(/^\d+[.).]\s+/, ""));

  if (lines.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} enhanced lines, got ${lines.length}`);
  }
  return lines;
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const lang = body.lang === "en" ? "en" : "ar";
  const items = Array.isArray(body.items)
    ? body.items.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
    : [];

  if (!items.length) {
    return NextResponse.json({ items: [] });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: "عدد العناصر كبير جداً." }, { status: 400 });
  }

  const client = getAnthropicClient();

  // Split into small chunks (see CHUNK_SIZE) and retry each one
  // independently, in parallel — a chunk that ultimately fails falls back
  // to its own original items without dragging down chunks that succeeded.
  const chunks = [];
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    chunks.push(items.slice(start, start + CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(
    chunks.map((chunk, chunkIdx) => {
      const numbered = chunk.map((it, i) => `${i + 1}. ${it}`).join("\n");
      return retryWithBackoff(
        () => requestEnhancement(client, lang, numbered, chunk.length),
        { logTag: `[ENHANCE-ITEMS-RETRY chunk ${chunkIdx + 1}/${chunks.length}]`, windowMs: CHUNK_WINDOW_MS }
      );
    })
  );

  const merged = [...items];
  chunkResults.forEach((result, chunkIdx) => {
    const chunkStart = chunkIdx * CHUNK_SIZE;
    if (result.ok) {
      result.result.forEach((enhanced, i) => {
        merged[chunkStart + i] = enhanced;
      });
      return;
    }
    console.error(`[ENHANCE-ITEMS-ERROR] chunk ${chunkIdx + 1}/${chunks.length}`, {
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
    // Never a 500 for a best-effort AI polish, and never a garbled/
    // partial chunk either — this chunk's original (unenhanced) items are
    // already sitting in `merged` (seeded from `items` above), so leaving
    // them as-is is the fallback for just this chunk.
  });

  if (chunkResults.every((r) => !r.ok)) {
    // Every chunk failed — the client already seeded every item with its
    // original text before this call resolves, and only swaps in the AI
    // version when this response is a clean, matching-length `items`
    // array. Omitting it here falls back to exactly that original text,
    // with the client's existing "couldn't auto-improve, edit manually"
    // notice.
    return NextResponse.json({ error: "تعذّر تحسين المحتوى تلقائياً." });
  }

  return NextResponse.json({ items: merged });
}
