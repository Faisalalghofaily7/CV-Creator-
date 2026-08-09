import { NextResponse } from "next/server";
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
- Return the results in the same order, one per line, no numbering, no headings, no preamble.`;
}

export async function POST(request) {
  try {
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
    // Numbering the input helps the model keep order/count reliable even
    // though the numbering itself is stripped from what we send back.
    const numbered = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
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

    if (lines.length !== items.length) {
      throw new Error(`Expected ${items.length} enhanced lines, got ${lines.length}`);
    }

    return NextResponse.json({ items: lines });
  } catch (err) {
    console.error("Failed to enhance CV items:", err);
    return NextResponse.json({ error: "تعذّر تحسين المحتوى تلقائياً." }, { status: 500 });
  }
}
