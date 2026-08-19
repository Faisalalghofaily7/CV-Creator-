import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Same lighter treatment as suggest-skills/suggest-points — this fires
// automatically per added technical skill, not on a single blocking submit.
export const maxDuration = 20;

const RETRY_WINDOW_MS = 12_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

// hasExperience steers the entire prompt: an applicant with real work
// history gets a description grounded in it, while a no-experience
// applicant gets a description grounded only in education/target role —
// the route must never let the model invent practical experience the
// applicant doesn't have. Both cases must still read CONFIDENT, not
// tentative — a no-experience applicant genuinely does know what they
// studied, and should be described that way, just never as if they'd
// already worked with it professionally.
function buildSystemPrompt(lang, hasExperience) {
  const languageName = lang === "en" ? "English" : "Arabic";
  const groundingRule = hasExperience
    ? "Ground the description in the applicant's actual work experience below — briefly and confidently how they used or applied this skill on the job."
    : 'The applicant has NO work experience yet. NEVER claim, imply, or fabricate any practical/work experience with this skill (no "used in my job", "applied at work", years of practice, specific employers, etc.). Instead, confidently state their real, education-grounded knowledge or capability with this skill — e.g. how it relates to what they studied or the role they are targeting. Write it as genuine, solid knowledge, not as a hesitant or apologetic disclaimer that they lack experience.';
  return `You are a skilled, experienced professional CV writer for the Saudi job market. Write ONE short, natural-sounding description (max ~12 words) for a single technical skill on a CV, in ${languageName}.

Rules:
- ${groundingRule}
- Tone: present the applicant at their strongest TRUTHFUL version — confident and capable, never fabricated and never weak/tentative. Truthful confidence, not modesty and not invention.
- Never fabricate specifics (employer names, years, project names, certifications) not present in the data below.
- Vary your phrasing and sentence opener naturally — do not default to the same templated structure every time. If "Other descriptions already on this CV" are listed below, make sure this one does not start with the same opening words or follow the identical sentence pattern as any of them.
- Return ONLY the description text — no quotes, no labels, no preamble, no explanation.`;
}

function buildContext({ skillName, jobTitle, experienceSummary, educationSummary, targetRoles, hasExperience, otherDescriptions }) {
  const lines = [`Skill: ${skillName}`];
  if (jobTitle) lines.push(`Target/current job title: ${jobTitle}`);
  if (hasExperience && experienceSummary) lines.push(`Experience:\n${experienceSummary}`);
  if (educationSummary) lines.push(`Education:\n${educationSummary}`);
  if (targetRoles) lines.push(`Target role(s): ${targetRoles}`);
  if (otherDescriptions?.length) lines.push(`Other descriptions already on this CV (vary your opener/pattern from these):\n${otherDescriptions.map((d) => `- ${d}`).join("\n")}`);
  return lines.join("\n");
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lang = body.lang === "en" ? "en" : "ar";
    const skillName = typeof body.skillName === "string" ? body.skillName.trim() : "";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const experienceSummary = typeof body.experienceSummary === "string" ? body.experienceSummary.trim() : "";
    const educationSummary = typeof body.educationSummary === "string" ? body.educationSummary.trim() : "";
    const targetRoles = typeof body.targetRoles === "string" ? body.targetRoles.trim() : "";
    const hasExperience = !!body.hasExperience;
    const otherDescriptions = Array.isArray(body.otherDescriptions)
      ? body.otherDescriptions.filter((d) => typeof d === "string" && d.trim()).slice(0, 10)
      : [];

    if (!skillName) {
      return NextResponse.json({ error: "skillName is required" }, { status: 400 });
    }

    const client = getAnthropicClient();
    const result = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 150,
            system: buildSystemPrompt(lang, hasExperience),
            messages: [{ role: "user", content: buildContext({ skillName, jobTitle, experienceSummary, educationSummary, targetRoles, hasExperience, otherDescriptions }) }],
          },
          { maxRetries: 0, timeout: PER_ATTEMPT_TIMEOUT_MS }
        );

        const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
        const description = raw.replace(/^["'“”]+|["'“”]+$/g, "").trim();
        if (!description) throw new Error("Empty response from Claude");
        return description;
      },
      { logTag: "[DESCRIBE-SKILL-RETRY]", windowMs: RETRY_WINDOW_MS }
    );

    if (!result.ok) {
      console.error("Failed to generate skill description:", result.error?.message || result.error, `(${result.attempts} attempt(s))`);
      return NextResponse.json({ error: "تعذّر توليد وصف تلقائياً." }, { status: 500 });
    }

    return NextResponse.json({ description: result.result });
  } catch (err) {
    console.error("Failed to generate skill description:", err);
    return NextResponse.json({ error: "تعذّر توليد وصف تلقائياً." }, { status: 500 });
  }
}
