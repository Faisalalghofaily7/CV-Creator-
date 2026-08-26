import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Comfortably above RETRY_WINDOW_MS plus headroom for an in-flight attempt
// still running when the window closed. Same lighter treatment as
// suggest-points — an optional, one-off "give me some ideas" click.
export const maxDuration = 40;

// A single attempt can legitimately take close to PER_ATTEMPT_TIMEOUT_MS on
// a longer/senior profile — with the old 12s window that left no real room
// for a second try, so one slow-but-otherwise-fine attempt surfaced as a
// hard failure ("couldn't generate, type manually") to the applicant.
// Widened so a genuinely slow first attempt doesn't burn the whole budget.
const RETRY_WINDOW_MS = 20_000;
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
- Every suggestion MUST be written in ${languageName} (aside from the conventional tool/brand names carved out above), no matter what language the context below (job title, target role) happens to be written in — the applicant may freely type the target role in a different script. Read that context for MEANING only; never let a stray foreign-language word leak into a suggestion.
- If the applicant's "Existing skills" already cover the most obvious/common skills for their field, do NOT run out of things to say: broaden to closely-related tools, adjacent methodologies, complementary certifications, or general professional competencies for the same field/role rather than stretching to force a narrow match. There is ALWAYS something reasonable left to suggest.
- MANDATORY: respond with exactly ${SUGGESTION_COUNT} lines, one skill name each, no numbering, no headings, no preamble, no explanation, and NEVER a response that says there's nothing left to suggest — that is never an acceptable answer, always produce ${SUGGESTION_COUNT} real skill names using the broadening rule above if needed.`;
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

        // A response cut off by the token budget can leave the LAST
        // suggestion on the list missing its final character(s) without
        // reducing how many lines came back — nothing else here would
        // catch that, so treat it as a failed attempt like every other
        // multi-line AI route in this codebase does.
        if (message.stop_reason === "max_tokens") throw new Error("Response truncated by max_tokens");
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
