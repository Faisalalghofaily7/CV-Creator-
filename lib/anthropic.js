import Anthropic from "@anthropic-ai/sdk";

// Server-only. Never import this file from a "use client" component — the
// API key must never reach the browser.
let cached;

export const CLAUDE_MODEL = "claude-sonnet-5";

export function getAnthropicClient() {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Run `vercel env pull .env.development.local` (or set it in your environment) before using the Claude API."
      );
    }
    cached = new Anthropic({ apiKey });
  }
  return cached;
}
