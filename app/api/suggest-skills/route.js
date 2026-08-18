import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Comfortably above RETRY_WINDOW_MS plus headroom for an in-flight attempt
// still running when the window closed. Same lighter treatment as
// suggest-points — an optional, one-off "give me some ideas" click.
export const maxDuration = 20;

const RETRY_WINDOW_MS = 12_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

const SUGGESTION_COUNT = 8;

function buildSystemPrompt(lang, kind) {
  const languageName = lang === "en" ? "English" : "Arabic";
  const kindLabel = kind === "soft"
    ? "soft/professional workplace skills — things like time management, leadership, communication, teamwork, problem-solving"
    : "technical/hard skills — concrete tools, software, technologies, methodologies, or technical competencies";
  const nameRule = kind === "soft"
    ? `Soft skills should read naturally in ${languageName}.`
    : `Keep well-known tool/technology/platform names in their conventional form regardless of CV language (e.g. "Power BI", "SQL", "Excel", "Python") — do not translate or Arabize brand/tool names.`;
  return `You are a professional CV writer for the Saudi job market. Suggest ${SUGGESTION_COUNT} ${kindLabel} that would be genuinely relevant for the applicant's profile below, written in ${languageName}.

Rules:
- Base suggestions on the applicant's job title, experience, education, and target role — make them specifically relevant, not generic filler.
- Do NOT repeat any skill already listed under "Existing skills" below.
- Each suggestion is a short skill NAME only (2-4 words max) — no descriptions, no full sentences.
- ${nameRule}
- Return exactly ${SUGGESTION_COUNT} suggestions, one per line, no numbering, no headings, no preamble, no explanations.`;
}

function buildContext({ jobTitle, experienceSummary, educationSummary, targetRoles, existingSkills }) {
  const lines = [];
  if (jobTitle) lines.push(`Most recent/current job title: ${jobTitle}`);
  if (experienceSummary) lines.push(`Experience:\n${experienceSummary}`);
  if (educationSummary) lines.push(`Education:\n${educationSummary}`);
  if (targetRoles) lines.push(`Target role(s): ${targetRoles}`);
  lines.push(`Existing skills already on the CV (do NOT repeat these): ${existingSkills || "(none)"}`);
  return lines.length ? lines.join("\n") : "No specific context provided — suggest common, broadly useful skills for a general professional role.";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lang = body.lang === "en" ? "en" : "ar";
    const kind = body.kind === "soft" ? "soft" : "technical";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const experienceSummary = typeof body.experienceSummary === "string" ? body.experienceSummary.trim() : "";
    const educationSummary = typeof body.educationSummary === "string" ? body.educationSummary.trim() : "";
    const targetRoles = typeof body.targetRoles === "string" ? body.targetRoles.trim() : "";
    const existingSkills = typeof body.existingSkills === "string" ? body.existingSkills.trim() : "";

    const client = getAnthropicClient();
    const result = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 400,
            system: buildSystemPrompt(lang, kind),
            messages: [{ role: "user", content: buildContext({ jobTitle, experienceSummary, educationSummary, targetRoles, existingSkills }) }],
          },
          { maxRetries: 0, timeout: PER_ATTEMPT_TIMEOUT_MS }
        );

        const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
        const suggestions = raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => l.replace(/^[-•\d.).\s]+/, "").trim())
          .filter(Boolean);

        if (!suggestions.length) throw new Error("Empty response from Claude");
        return suggestions;
      },
      { logTag: "[SUGGEST-SKILLS-RETRY]", windowMs: RETRY_WINDOW_MS }
    );

    if (!result.ok) {
      console.error("Failed to generate skill suggestions:", result.error?.message || result.error, `(${result.attempts} attempt(s))`);
      return NextResponse.json({ error: "تعذّر توليد اقتراحات تلقائياً." }, { status: 500 });
    }

    return NextResponse.json({ suggestions: result.result });
  } catch (err) {
    console.error("Failed to generate skill suggestions:", err);
    return NextResponse.json({ error: "تعذّر توليد اقتراحات تلقائياً." }, { status: 500 });
  }
}
