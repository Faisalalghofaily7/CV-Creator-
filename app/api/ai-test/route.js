import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Connectivity/latency check only — confirms ANTHROPIC_API_KEY and the
// selected Claude model work end-to-end from the deployed Vercel runtime.
export async function GET() {
  const startedAt = Date.now();
  try {
    const client = getAnthropicClient();
    console.log("[AI-TEST] Claude request starting", { model: CLAUDE_MODEL });

    const message = await client.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with exactly: connection OK" }],
      },
      { maxRetries: 0, timeout: 20_000 }
    );

    const reply = message.content?.find((block) => block.type === "text")?.text?.trim() || null;
    const elapsedMs = Date.now() - startedAt;
    console.log("[AI-TEST] Claude response", {
      model: CLAUDE_MODEL,
      elapsedMs,
      stopReason: message.stop_reason,
      reply,
    });

    return NextResponse.json({
      ok: true,
      model: CLAUDE_MODEL,
      elapsedMs,
      stopReason: message.stop_reason,
      reply,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error("[AI-TEST] Claude connection test failed", {
      elapsedMs,
      message: err?.message,
      name: err?.name,
      status: err?.status,
      type: err?.error?.type,
    });
    return NextResponse.json(
      {
        ok: false,
        model: CLAUDE_MODEL,
        elapsedMs,
        error: err?.message || "Unknown error",
        status: err?.status ?? null,
        type: err?.error?.type ?? null,
      },
      { status: 500 }
    );
  }
}
