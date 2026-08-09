import { NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

function buildSystemPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are a professional CV writer specialized in the Saudi job market. Write a professional summary for the applicant based on their data, in ${languageName}.

Instructions:
1. Write a summary oriented toward the target role, highlighting the most relevant experience and skills.
2. Decide the length based on the applicant's experience: senior/long experience → 5-6 lines; mid-level → ~4 lines; junior/fresh graduate → 2-3 lines.
3. Use strong professional language and action verbs (led, developed, managed, achieved).
4. You MAY add general professional phrasing to enrich the writing, but:
   - NEVER invent any numbers, statistics, or achievements not present in the data.
   - NEVER invent job titles, companies, or qualifications not mentioned.
   - Stick strictly to the given facts, phrased professionally.
5. Write in professional third-person style (no "I"), like real professional CVs.
6. Do NOT add a heading — return only the summary text.
7. The final summary MUST be entirely in ${languageName}, regardless of what language the applicant's data below is written in. If the applicant wrote any of their data in Arabic while the target CV language is English (or vice versa), translate that content faithfully into ${languageName} — translate meaning, not word-for-word — while still following every rule above (never invent facts; only translate and phrase professionally).

Return ONLY the professional summary text, with no preamble or explanation.`;
}

// Renders the applicant's data as a plain labeled block for the model —
// deliberately kept separate from the system prompt (which carries all the
// behavioral rules) so this is unambiguously *data*, not instructions.
function buildApplicantData({ targetRoles, yearsOfExperience, experiences, education, techSkills, softSkills }) {
  const lines = [];

  if (targetRoles) lines.push(`Target role(s): ${targetRoles}`);
  if (yearsOfExperience) lines.push(`Years of experience: ${yearsOfExperience}`);

  const realExperiences = experiences.filter((x) => x && (x.title || x.employer || x.bullets));
  if (realExperiences.length) {
    lines.push("", "Work experience:");
    realExperiences.forEach((x, i) => {
      const head = [x.title, x.employer, x.period].filter(Boolean).join(" — ");
      lines.push(`${i + 1}. ${head || "(untitled entry)"}`);
      (x.bullets || "")
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean)
        .forEach((b) => lines.push(`   - ${b}`));
    });
  }

  const realEducation = education.filter((x) => x && (x.degree || x.school));
  if (realEducation.length) {
    lines.push("", "Education:");
    realEducation.forEach((x, i) => {
      const head = [x.degree, x.school, x.year].filter(Boolean).join(" — ");
      lines.push(`${i + 1}. ${head}`);
    });
  }

  if (techSkills) lines.push("", `Technical skills: ${techSkills}`);
  if (softSkills) lines.push("", `Soft skills: ${softSkills}`);

  return lines.length ? lines.join("\n").trim() : "No data provided.";
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lang = body.lang === "en" ? "en" : "ar";
    const targetRoles = typeof body.targetRoles === "string" ? body.targetRoles.trim() : "";
    const yearsOfExperience = typeof body.yearsOfExperience === "string" ? body.yearsOfExperience.trim() : "";
    const experiences = Array.isArray(body.experiences) ? body.experiences : [];
    const education = Array.isArray(body.education) ? body.education : [];
    const techSkills = typeof body.techSkills === "string" ? body.techSkills.trim() : "";
    const softSkills = typeof body.softSkills === "string" ? body.softSkills.trim() : "";

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: buildSystemPrompt(lang),
      messages: [
        {
          role: "user",
          content: buildApplicantData({ targetRoles, yearsOfExperience, experiences, education, techSkills, softSkills }),
        },
      ],
    });

    const summary = message.content?.find((block) => block.type === "text")?.text?.trim();
    if (!summary) throw new Error("Empty response from Claude");

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("Failed to generate professional summary:", err);
    return NextResponse.json({ error: "تعذّر إنشاء الملخص المهني تلقائياً." }, { status: 500 });
  }
}
