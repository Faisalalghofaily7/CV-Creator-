import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

// Defensive cap — a real CV never has anywhere near this many custom
// sections; it just bounds the request if something odd gets sent.
const MAX_TITLES = 20;

// Deliberately narrower than enhance-items' system prompt: this is spelling
// correction only, never rephrasing/restyling/translation. The caller
// (AtsCvBuilder's guardLangInput) already blocks Arabic input for an
// English-mode title before it ever reaches here, so titles arriving here
// are already guaranteed to be in the right language — no translation
// clause needed, unlike enhance-items.
function buildSystemPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are a professional CV proofreader. For each of the following custom CV section titles, output the SAME title with ONLY spelling/typing mistakes corrected, in ${languageName}.

Rules:
- Fix ONLY clear spelling/typo mistakes (missing or extra letters, common misspellings). Do NOT reword, rephrase, restyle, shorten, lengthen, or otherwise change the wording or meaning.
- Do NOT translate — every title is already in ${languageName}; keep it in ${languageName}.
- If a title has no spelling mistake, or you are not confident there is one, return it EXACTLY as given, unchanged. When in doubt, leave it as-is.
- Preserve capitalization and punctuation style; correct only clear letter-level errors.
- Return the results in the same order, one per line, no numbering, no headings, no preamble, no explanation.`;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lang = body.lang === "en" ? "en" : "ar";
    const titles = Array.isArray(body.titles)
      ? body.titles.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];

    if (!titles.length) {
      return NextResponse.json({ titles: [] });
    }
    if (titles.length > MAX_TITLES) {
      return NextResponse.json({ error: "عدد العناوين كبير جداً." }, { status: 400 });
    }

    const client = getAnthropicClient();
    // Numbering the input helps the model keep order/count reliable even
    // though the numbering itself is stripped from what we send back.
    const numbered = titles.map((it, i) => `${i + 1}. ${it}`).join("\n");
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
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

    if (lines.length !== titles.length) {
      throw new Error(`Expected ${titles.length} corrected titles, got ${lines.length}`);
    }

    return NextResponse.json({ titles: lines });
  } catch (err) {
    console.error("Failed to spell-check custom section titles:", err);
    return NextResponse.json({ error: "تعذّر تدقيق العناوين إملائياً." }, { status: 500 });
  }
}
