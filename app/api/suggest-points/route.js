import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Comfortably above RETRY_WINDOW_MS plus headroom for an in-flight attempt
// still running when the window closed.
export const maxDuration = 20;

// Lighter treatment than the main preview-generation routes: this is a
// small, optional, one-off "give me some ideas" click, not something the
// whole preview screen is waiting on — a shorter bounded window (a couple
// of quick retries) is enough, and a failure just leaves the existing
// "اقترح لي" button clickable again rather than needing its own recovery
// flow client-side.
const RETRY_WINDOW_MS = 12_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

const SUGGESTION_COUNT = 5;

// These are *generic* starting points the applicant must review and edit —
// never claims of the applicant's own verified achievements. That honesty
// boundary is what separates this from enhance-items (which only ever
// rephrases text the applicant actually wrote).
function buildSystemPrompt(lang, kind) {
  const languageName = lang === "en" ? "English" : "Arabic";
  const kindLabel = kind === "achievements" ? "notable achievements" : "job responsibilities / tasks";
  return `You are a professional CV writer for the Saudi job market. Suggest ${SUGGESTION_COUNT} generic, common ${kindLabel} for someone in the given role/field, written in ${languageName}, to help an applicant who isn't sure how to phrase their own CV entries.

Rules:
- These are GENERIC professional starting points, not the applicant's real, verified accomplishments. The applicant will review, edit, or discard each one before it appears on their CV.
- Do NOT invent specific numbers, percentages, amounts, or metrics (e.g. "increased sales by 30%") — that would misrepresent an unverified claim as a real fact. Keep suggestions phrased as general professional statements (e.g. "Managed daily accounting operations and prepared monthly financial reports").
- Base the suggestions on the job title, years of experience, specialization/major, and target role provided — make them relevant, not generic filler unrelated to the field.
- Each suggestion should be one concise, professional line using a strong action verb, suitable to paste directly into a CV.
- Return exactly ${SUGGESTION_COUNT} suggestions, one per line, no numbering, no headings, no preamble, no explanations.`;
}

function buildContext({ jobTitle, employer, yearsOfExperience, specialization, targetRole }) {
  const lines = [];
  if (jobTitle) lines.push(`Job title: ${jobTitle}`);
  if (employer) lines.push(`Employer/company: ${employer}`);
  if (yearsOfExperience) lines.push(`Years of experience: ${yearsOfExperience}`);
  if (specialization) lines.push(`Specialization/major: ${specialization}`);
  if (targetRole) lines.push(`Target role: ${targetRole}`);
  return lines.length ? lines.join("\n") : "No specific context provided — suggest common entries for a general professional role.";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lang = body.lang === "en" ? "en" : "ar";
    const kind = body.kind === "achievements" ? "achievements" : "bullets";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const employer = typeof body.employer === "string" ? body.employer.trim() : "";
    const yearsOfExperience = typeof body.yearsOfExperience === "string" ? body.yearsOfExperience.trim() : "";
    const specialization = typeof body.specialization === "string" ? body.specialization.trim() : "";
    const targetRole = typeof body.targetRole === "string" ? body.targetRole.trim() : "";

    const client = getAnthropicClient();
    const result = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 700,
            system: buildSystemPrompt(lang, kind),
            messages: [{ role: "user", content: buildContext({ jobTitle, employer, yearsOfExperience, specialization, targetRole }) }],
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
      { logTag: "[SUGGEST-POINTS-RETRY]", windowMs: RETRY_WINDOW_MS }
    );

    if (!result.ok) {
      console.error("Failed to generate point suggestions:", result.error?.message || result.error, `(${result.attempts} attempt(s))`);
      return NextResponse.json({ error: "تعذّر توليد اقتراحات تلقائياً." }, { status: 500 });
    }

    return NextResponse.json({ suggestions: result.result });
  } catch (err) {
    console.error("Failed to generate point suggestions:", err);
    return NextResponse.json({ error: "تعذّر توليد اقتراحات تلقائياً." }, { status: 500 });
  }
}
