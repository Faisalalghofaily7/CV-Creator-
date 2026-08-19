import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";
import { retryWithBackoff } from "../../../lib/aiRetry";

export const runtime = "nodejs";
// Same lighter treatment as suggest-skills/suggest-points — this fires
// automatically per added technical skill, not on a single blocking submit.
export const maxDuration = 20;

const RETRY_WINDOW_MS = 12_000;
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

// hasExperience steers the entire prompt: an applicant with real work
// history gets a description grounded in it, while a no-experience
// applicant gets a description grounded only in education/target role —
// the route must never let the model invent practical experience the
// applicant doesn't have. Both cases must still read CONFIDENT, not
// tentative — a no-experience applicant genuinely does know what they
// studied, and should be described that way, just never as if they'd
// already worked with it professionally.
function buildSystemPrompt(lang, hasExperience, usedPhrases) {
  const languageName = lang === "en" ? "English" : "Arabic";
  const groundingRule = hasExperience
    ? "Ground the description in the applicant's actual work experience below — briefly and confidently how they used or applied this skill on the job."
    : 'The applicant has NO work experience yet. NEVER claim, imply, or fabricate any practical/work experience with this skill (no "used in my job", "applied at work", years of practice, specific employers, etc.). Instead, confidently state their real, education-grounded knowledge or capability with this skill.';
  const bannedList = (BANNED_PHRASES[lang] || BANNED_PHRASES.ar).map((p) => `"${p}"`).join(", ");
  const usedNote = usedPhrases.length
    ? ` These have ALREADY been used in a description elsewhere on this CV — do not reuse them here in any form: ${usedPhrases.map((p) => `"${p}"`).join(", ")}.`
    : "";
  return `You are a skilled, experienced professional CV writer for the Saudi job market. Write ONE short, natural-sounding description (max ~12 words) for a single technical skill on a CV, in ${languageName}.

Rules:
- ${groundingRule}
- Tone: present the applicant at their strongest TRUTHFUL version — confident and capable, never fabricated and never weak/tentative.
- Never fabricate specifics (employer names, years, project names, certifications) not present in the data below.
- Each description must be short and grammatically standalone — a complete phrase on its own, not a fragment that only makes sense glued after the skill name.

ANTI-REPETITION — this has failed before across multiple skills on the same CV, so follow it exactly, not just in spirit:
- BANNED phrases/openers: ${bannedList}. Across the whole set of skill descriptions for one CV, each of these may appear AT MOST ONCE TOTAL, ideally never.${usedNote} For a no-experience applicant, achieve honesty through WHAT you describe (concrete knowledge or capability), never by repeating a disclaimer phrase like these.
- Build the description around ONE of these angles, rotating between them across a CV's skill list rather than reusing the same one every time:
  1. What the skill IS / what it enables — e.g. "تنظيم البيانات وإنشاء الجداول والتقارير."
  2. The capability/competence it gives — e.g. "القدرة على تهيئة الشبكات المحلية وربط الأجهزة."
  3. The technical function/mechanism — e.g. "فهم بروتوكولات الاتصال واستكشاف أعطال الشبكة."
  4. (Rarely — at most once across the whole CV) the learning/education context.
- Contrast example — BAD (repetitive, same template reused): "Excel — إجادة استخدامه ضمن الدبلوم." / "Word — تعلمته ضمن الدبلوم." / "الشبكات — درستها ضمن الدبلوم وأسعى لتطبيقها." GOOD (varied structure): "تنظيم البيانات وإنشاء الجداول والتقارير الأساسية." / "إعداد وتنسيق المستندات والتقارير الاحترافية." / "تهيئة الأجهزة وربطها ضمن الشبكة الداخلية." / "فهم آلية الاتصال بين الأجهزة واستكشاف أعطال الشبكة." These illustrate STRUCTURE and VARIETY only (and are shown with the skill name glued on, matching how they render on the CV) — write fresh wording for the actual skill below, in ${languageName}; never copy these verbatim, and never include the skill name itself in your answer (the skill name is added separately when rendering — you write only the description that follows it).
- If "Other descriptions already on this CV" are listed below, this new one must use a different angle and a different opening word than every one of them.

Return ONLY the description text — no quotes, no labels, no preamble, no explanation, no skill name.`;
}

function buildContext({ skillName, jobTitle, experienceSummary, educationSummary, targetRoles, hasExperience, otherDescriptions }) {
  const lines = [`Skill: ${skillName}`];
  if (jobTitle) lines.push(`Target/current job title: ${jobTitle}`);
  if (hasExperience && experienceSummary) lines.push(`Experience:\n${experienceSummary}`);
  if (educationSummary) lines.push(`Education:\n${educationSummary}`);
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
    const targetRoles = typeof body.targetRoles === "string" ? body.targetRoles.trim() : "";
    const hasExperience = !!body.hasExperience;
    const otherDescriptions = Array.isArray(body.otherDescriptions)
      ? body.otherDescriptions.filter((d) => typeof d === "string" && d.trim()).slice(0, 10)
      : [];

    if (!skillName) {
      return NextResponse.json({ error: "skillName is required" }, { status: 400 });
    }

    const usedPhrases = detectUsedPhrases(otherDescriptions, lang);

    const client = getAnthropicClient();
    const result = await retryWithBackoff(
      async () => {
        const message = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 150,
            system: buildSystemPrompt(lang, hasExperience, usedPhrases),
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
