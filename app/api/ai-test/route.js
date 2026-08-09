import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

// Connectivity check only — confirms ANTHROPIC_API_KEY works end-to-end.
// Not wired into any CV-generation feature yet.
export async function GET() {
  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: connection OK" }],
    });

    const reply = message.content?.find((block) => block.type === "text")?.text?.trim() || null;
    return NextResponse.json({ ok: true, model: CLAUDE_MODEL, reply });
  } catch (err) {
    console.error("Claude connection test failed:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
