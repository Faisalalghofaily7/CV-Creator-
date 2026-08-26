import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";
import { arabicWritingStandard } from "../../../lib/arabicWritingStandard";

export const runtime = "nodejs";
// Same lighter treatment as suggest-skills/suggest-points — this fires
// automatically per added technical skill, not on a single blocking submit.
export const maxDuration = 40;

// A single attempt can legitimately take close to PER_ATTEMPT_TIMEOUT_MS —
// with too tight a window that leaves no real room for a second try, so
// one slow-but-otherwise-fine attempt surfaces as a hard failure (an empty
// description the applicant has to notice and fill in manually). Widened
// so that doesn't happen — see the same fix on suggest-skills/suggest-points.
const RETRY_WINDOW_MS = 20_000;
const PER_ATTEMPT_TIMEOUT_MS = 8_000;

// Concrete, named phrases that kept coming back verbatim across generated
// descriptions on the same CV even after a generic "vary the wording"
// instruction — a per-call, stateless prompt has no real signal to notice
// its own default template, so naming the exact offenders and detecting
// them in otherDescriptions (see detectUsedPhrases below) is what actually
// breaks the pattern, not another abstract "be varied" plea.
const BANNED_PHRASES = {
  ar: ["درستها", "تعلمتها", "دراستها", "ضمن الدبلوم", "ضمن دبلوم الدعم الفني", "أسعى لتطبيقها"],
  en: ["learned it", "studied it", "as part of the diploma", "aim to apply it", "seeking to apply it"],
};

// Scans descriptions already generated for OTHER skills on this same CV for
// any banned phrase — lets the prompt forbid reusing a SPECIFIC phrase the
// model itself already used this session, rather than relying on it to
// self-police across calls it has no memory of.
function detectUsedPhrases(otherDescriptions, lang) {
  const bank = BANNED_PHRASES[lang] || BANNED_PHRASES.ar;
  const used = new Set();
  for (const desc of otherDescriptions || []) {
    for (const phrase of bank) {
      if (desc.includes(phrase)) used.add(phrase);
    }
  }
  return [...used];
}

// NEW FEATURE — conditional skill descriptions. This route is only ever
// called for a fresh graduate (isFreshGraduate computed client-side in
// AtsCvBuilder.jsx from real experience dates — see lib/cvQualityRules.js's
// isFreshGraduate/totalMonthsOfExperience — and never left for the model to
// infer); an experienced candidate's technical skills render as bare
// keywords and never reach this call at all (see the POST short-circuit
// below, which stays as a deterministic backstop even if some future
// caller invokes this route directly).
//
// For a fresh graduate, a description is still not automatic: it's earned
// only when it states WHERE the skill was actually applied — a graduation
// project, a co-op/training placement, a course, a volunteer role — never
// a definition of what the skill/tool IS, since a definition says nothing
// about THIS applicant (anyone who lists the same tool could write the
// same sentence). If nothing in the applicant's data grounds a given
// skill, the model must say so (respond exactly "NONE") rather than invent
// a project or placement that was never mentioned — see the NONE handling
// in POST below, which treats that as a valid result, not a failed one.
function buildSystemPrompt(lang, usedPhrases) {
  const languageName = lang === "en" ? "English" : "Arabic";
  const bannedDefinitionExample = lang === "ar"
    ? "SAP: استخدامه في تسجيل القيود ومراجعة الحسابات المالية بدقة"
    : "SAP: a system used to record journal entries and review financial accounts";
  const allowedGroundedExample = lang === "ar"
    ? "SAP — تسجيل القيود ومطابقة الحسابات خلال تدريب تعاوني 6 أشهر"
    : "SAP — recorded entries and reconciled accounts during a 6-month co-op placement";
  const bannedList = (BANNED_PHRASES[lang] || BANNED_PHRASES.ar).map((p) => `"${p}"`).join(", ");
  const usedNote = usedPhrases.length
    ? ` These have ALREADY been used in a description elsewhere on this CV — do not reuse them here in any form: ${usedPhrases.map((p) => `"${p}"`).join(", ")}.`
    : "";
  return `You are a skilled, experienced professional CV writer for the Saudi job market. The applicant is a fresh graduate with no meaningful professional experience yet. Write ONE short, natural-sounding description (max ~12 words) for a single technical skill on a CV, in ${languageName} — or decide no honest description is possible (see below).

Rules:
- Ground the description ONLY in WHERE this specific skill was actually applied — a graduation project, a co-op/training placement, a course, or a volunteer role mentioned in the data below.
- NEVER describe what the skill/tool/concept IS or does in general terms — that is a definition, not information about this applicant, and anyone who listed the same skill could write the same sentence.
  BANNED (a definition, no matter how well-written): "${bannedDefinitionExample}"
  ALLOWED (states where it was applied): "${allowedGroundedExample}"
- If nothing in the data below ties THIS skill to a real project, placement, course, or activity, do not invent one — respond with exactly the single word NONE (nothing else — no punctuation, no quotes) instead of a description.
- Tone when a description IS possible: present the applicant at their strongest TRUTHFUL version — confident and capable, never fabricated and never weak/tentative.
- Never fabricate specifics (employer names, years, project names, certifications) not present in the data below.
- Each description must be short and grammatically standalone — a complete phrase on its own, not a fragment that only makes sense glued after the skill name.
- The description MUST be entirely in ${languageName}, no matter what language the context below (job title, target role) happens to be written in — the applicant may freely type the target role in a different script. Read that context for MEANING only and write fresh in ${languageName}; never let a foreign-language word or phrase leak into the description.

ANTI-REPETITION — this has failed before across multiple skills on the same CV, so follow it exactly, not just in spirit:
- BANNED phrases/openers: ${bannedList}. Across the whole set of skill descriptions for one CV, each of these may appear AT MOST ONCE TOTAL, ideally never.${usedNote}
- Build the description around ONE of these angles, rotating between them across a CV's skill list rather than reusing the same one every time:
  1. The graduation project it was used in.
  2. The co-op/training placement it was used in.
  3. The course/training it was learned and applied in.
  4. The volunteer role it was used in.
- Contrast example — BAD (a definition, reused as a template): "Excel — برنامج جداول بيانات لتنظيم البيانات." / "Word — برنامج لتحرير المستندات." GOOD (varied, each grounded in a real activity): "Excel — تحليل بيانات المبيعات ضمن مشروع التخرج." / "Word — إعداد تقارير التدريب التعاوني الأسبوعية." These illustrate STRUCTURE and VARIETY only (and are shown with the skill name glued on, matching how they render on the CV) — write fresh wording for the actual skill below, in ${languageName}; never copy these verbatim, and never include the skill name itself in your answer (the skill name is added separately when rendering — you write only the description that follows it).
- If "Other descriptions already on this CV" are listed below, this new one must use a different angle and a different opening word than every one of them.
${lang === "ar" ? `\n${arabicWritingStandard()}\n` : ""}
Return ONLY the description text, or exactly NONE — no quotes, no labels, no preamble, no explanation, no skill name.`;
}

function buildContext({ skillName, jobTitle, experienceSummary, educationSummary, gradProjectSummary, coursesSummary, targetRoles, otherDescriptions }) {
  const lines = [`Skill: ${skillName}`];
  if (jobTitle) lines.push(`Target/current job title: ${jobTitle}`);
  if (experienceSummary) lines.push(`Experience (co-op/training placements, if any):\n${experienceSummary}`);
  if (educationSummary) lines.push(`Education:\n${educationSummary}`);
  if (gradProjectSummary) lines.push(`Graduation project(s):\n${gradProjectSummary}`);
  if (coursesSummary) lines.push(`Courses/training completed:\n${coursesSummary}`);
  if (targetRoles) lines.push(`Target role(s): ${targetRoles}`);
  if (otherDescriptions?.length) lines.push(`Other descriptions already on this CV (use a different angle/opener from every one of these):\n${otherDescriptions.map((d) => `- ${d}`).join("\n")}`);
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
    const gradProjectSummary = typeof body.gradProjectSummary === "string" ? body.gradProjectSummary.trim() : "";
    const coursesSummary = typeof body.coursesSummary === "string" ? body.coursesSummary.trim() : "";
    const targetRoles = typeof body.targetRoles === "string" ? body.targetRoles.trim() : "";
    const isFreshGraduate = !!body.isFreshGraduate;
    const otherDescriptions = Array.isArray(body.otherDescriptions)
      ? body.otherDescriptions.filter((d) => typeof d === "string" && d.trim()).slice(0, 10)
      : [];

    if (!skillName) {
      return NextResponse.json({ error: "skillName is required" }, { status: 400 });
    }

    // NEW FEATURE — conditional skill descriptions: an experienced
    // candidate (isFreshGraduate false) never gets a skill description.
    // Decided here, in code, before any AI call is made — not left for the
    // model to infer or enforce through the prompt (the caller already
    // skips calling this route in that case; this is a deterministic
    // backstop, not the primary mechanism).
    if (!isFreshGraduate) {
      return NextResponse.json({ description: "" });
    }

    const usedPhrases = detectUsedPhrases(otherDescriptions, lang);

    const client = getAnthropicClient();
    const result = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 150,
            system: buildSystemPrompt(lang, usedPhrases),
            messages: [{ role: "user", content: buildContext({ skillName, jobTitle, experienceSummary, educationSummary, gradProjectSummary, coursesSummary, targetRoles, otherDescriptions }) }],
          },
          { maxRetries: 0, timeout: PER_ATTEMPT_TIMEOUT_MS }
        );

        // A response cut off by the token budget ends wherever generation
        // happened to be, mid-word — never on real punctuation. Treat it
        // as a failed attempt (like every other multi-line AI route in
        // this codebase already does) rather than accepting a description
        // silently missing its final character(s).
        if (message.stop_reason === "max_tokens") throw new Error("Response truncated by max_tokens");
        const raw = message.content?.find((block) => block.type === "text")?.text?.trim() || "";
        // The model deciding it has no honest grounding for this skill
        // (see the NEVER invent a project... rule above) is a valid,
        // expected outcome, not a failed attempt — it must never hit the
        // retry path or the generic "couldn't generate" error below.
        if (/^none\.?$/i.test(raw)) return "";
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
