import { NextResponse } from "next/server";
import { APIError } from "@anthropic-ai/sdk";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

// Defensive cap — a real CV's bullets/achievements/graduation projects
// never come close to this; it just bounds the request if something odd
// gets sent.
const MAX_ITEMS = 60;

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

// One request to the model, one parse attempt — split out so POST can call
// it twice (see the retry below) without duplicating either.
async function requestEnhancement(client, lang, numbered) {
  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system: buildSystemPrompt(lang),
    messages: [{ role: "user", content: numbered }],
  });
  const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    // Defensive: strip any leading "1. " / "1)" the model adds despite
    // being told not to, so a stray numbering artifact never leaks in.
    .map((l) => l.replace(/^\d+[.).]\s*/, ""));
  return { lines, raw };
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

  // Numbering the input helps the model keep order/count reliable even
  // though the numbering itself is stripped from what we send back.
  const numbered = items.map((it, i) => `${i + 1}. ${it}`).join("\n");

  try {
    const client = getAnthropicClient();

    // The model is asked for exactly one output line per input item; that
    // count occasionally comes back off by one or two on a large batch (a
    // merged line, a stray blank line) — one retry clears up most of those
    // before this is treated as a real failure.
    let lines = [];
    let raw = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      ({ lines, raw } = await requestEnhancement(client, lang, numbered));
      if (lines.length === items.length) {
        return NextResponse.json({ items: lines });
      }
      console.warn(`[ENHANCE-ITEMS-ERROR] attempt ${attempt}: expected ${items.length} lines, got ${lines.length}`);
    }

    console.error("[ENHANCE-ITEMS-ERROR] giving up after 2 attempts", { expected: items.length, got: lines.length, rawOutput: raw });
  } catch (err) {
    console.error("[ENHANCE-ITEMS-ERROR]", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      ...(err instanceof APIError && {
        anthropicStatus: err.status,
        anthropicErrorType: err.type,
        anthropicResponseBody: err.error,
      }),
    });
  }

  // Never a 500 for a best-effort AI polish, and never a garbled/partial
  // array either — the client already seeds every item with its original
  // text before this call resolves, and only swaps in the AI version when
  // this response is a clean, matching-length `items` array. Omitting it
  // here falls back to exactly that original text, with the client's
  // existing "couldn't auto-improve, edit manually" notice.
  return NextResponse.json({ error: "تعذّر تحسين المحتوى تلقائياً." });
}
