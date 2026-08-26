// Mock implementation of lib/anthropic.js's public surface, used ONLY by
// debug/test-conditional-skill-descriptions.mjs (see that file's header for
// how to swap it in and out). Simulates a compliant model following the
// describe-skill prompt's grounding rule from app/api/describe-skill/
// route.js: only produce a description when the request context actually
// contains a non-empty grounding section (experience, grad project, or
// courses); otherwise respond exactly "NONE", exactly as instructed.
import fs from "fs";

export const CLAUDE_MODEL = "claude-sonnet-5-mock";

const LOG_PATH = process.env.DESCRIBE_SKILL_MOCK_LOG;

function log(entry) {
  if (LOG_PATH) fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

function mockRespond(userContent) {
  const grounded =
    /Experience \(co-op\/training placements, if any\):\n\S/.test(userContent) ||
    /Graduation project\(s\):\n\S/.test(userContent) ||
    /Courses\/training completed:\n\S/.test(userContent);
  return grounded
    ? "استخدمته لتحليل بيانات المبيعات ضمن مشروع التخرج"
    : "NONE";
}

export function getAnthropicClient() {
  return {
    messages: {
      async create(params) {
        const userContent = params.messages?.[0]?.content || "";
        log({ system: params.system, userContent });
        const text = mockRespond(userContent);
        return { stop_reason: "end_turn", content: [{ type: "text", text }] };
      },
    },
  };
}
