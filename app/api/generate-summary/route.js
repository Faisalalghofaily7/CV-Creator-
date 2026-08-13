import { NextResponse } from "next/server";
import { APIError } from "@anthropic-ai/sdk";
import { getAnthropicClient, CLAUDE_MODEL } from "../../../lib/anthropic";

export const runtime = "nodejs";

// Hard ceiling enforced both in the prompt and, deterministically, in code
// below (a prompt instruction alone doesn't reliably hold on longer/senior
// profiles) — see enforceSummaryCap. Word count, not sentence count: a
// handful of long sentences can still render to far more than 5 lines in
// the PDF (a real 5-sentence summary rendered ~10 lines), so sentence
// count was a poor proxy. Exact rendered lines still depend on the PDF's
// font/page width, which this route has no visibility into — word count
// is just a steadier stand-in. TUNE THIS NUMBER after checking real PDFs.
const SUMMARY_MAX_WORDS = 75;

function buildSystemPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are a professional CV writer specialized in the Saudi job market. Write a professional summary for the applicant based on their data, in ${languageName}.

Instructions:
1. Write a summary oriented toward the target role, making the best possible use of the applicant's real experience and capabilities, blended with what that role actually calls for.
2. Judge the right length and depth yourself, holistically, from the applicant's whole profile — their actual experience, seniority, achievements, role, and skills. Do NOT use a mechanical rule like "X years = Y lines." A more accomplished, senior profile can naturally warrant a fuller summary; a lighter or junior profile warrants a shorter, focused one — but let the substance of what they've actually done drive that, not a formula.
3. HARD LIMIT, NON-NEGOTIABLE: the summary must be AT MOST ${SUMMARY_MAX_WORDS} words total (that's what keeps it to roughly 5 lines in the final document), no matter how senior or accomplished the applicant is. Before you finish, COUNT the words in your draft. If it is more than ${SUMMARY_MAX_WORDS} words, you MUST cut it down — combine sentences or remove the least essential ones — until it is at or under ${SUMMARY_MAX_WORDS} words. Never submit a draft you haven't counted. A senior profile that seems to need more room must still be compressed to fit; density, not length, is how you show seniority.
4. HONESTY is critical: base the summary strictly on the real inputs. Never over-qualify or inflate a profile — a junior applicant must never be made to sound senior. Never pad the summary to fill space or reach a target length; if the applicant's real substance is modest, keep the summary appropriately concise rather than stretching it with generic filler.
5. Use strong professional language and action verbs (led, developed, managed, achieved) where the facts genuinely support them.
6. You MAY add general professional phrasing to enrich the writing, but:
   - NEVER invent any numbers, statistics, or achievements not present in the data.
   - NEVER invent job titles, companies, or qualifications not mentioned.
   - Stick strictly to the given facts, phrased professionally.
7. Write in professional third-person style (no "I"), like real professional CVs.
8. Do NOT add a heading — return only the summary text.
9. The final summary MUST be entirely in ${languageName}, regardless of what language the applicant's data below is written in. If the applicant wrote any of their data in Arabic while the target CV language is English (or vice versa), translate that content faithfully into ${languageName} — translate meaning, not word-for-word — while still following every rule above (never invent facts; only translate and phrase professionally).

Return ONLY the professional summary text, with no preamble or explanation.`;
}

function buildCompressionPrompt(lang) {
  const languageName = lang === "en" ? "English" : "Arabic";
  return `You are compressing a professional CV summary that came out too long, in ${languageName}.

Rewrite it so it is AT MOST ${SUMMARY_MAX_WORDS} words total (roughly 5 lines). Rules:
- Do not invent, add, or exaggerate any fact — only compress what's already there.
- Keep the most important, role-focused, honest content — the applicant's real seniority, core skills, and strongest concrete achievements. Drop the least essential phrasing first; never over-qualify or add anything not already present to fill space.
- You may drop less-essential phrasing or combine sentences, but never lose a concrete fact (a role, a real number, a real skill) unless you truly have no room.
- Keep the same professional third-person tone and role focus.
- Count your words before responding — if it's still more than ${SUMMARY_MAX_WORDS}, cut further.

Return ONLY the compressed summary text, with no preamble or explanation.`;
}

const SENTENCE_SPLIT_RE = /(?<=[.!?؟])\s+/;
function splitSentences(text) {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Deterministic last resort: walks whole sentences in order, keeping each
// one only if the running total still fits under the cap — so the result
// always ends on real sentence-final punctuation, never mid-sentence. The
// very first sentence is always kept even if it alone exceeds the cap
// (better to end slightly over than return nothing).
function trimToWordCap(text, maxWords) {
  const sentences = splitSentences(text);
  const included = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (included.length && wordCount + sentenceWords > maxWords) break;
    included.push(sentence);
    wordCount += sentenceWords;
  }
  return included.join(" ") || text;
}

// Deterministically holds the word cap the prompt alone doesn't reliably
// enforce on longer/senior profiles: first tries one AI compression pass
// (keeps the writing natural), then falls back to trimToWordCap if that
// still isn't short enough. Never throws — any failure here just falls
// back to the best text already in hand.
async function enforceSummaryCap(client, lang, summary) {
  const wordCount = countWords(summary);
  if (wordCount <= SUMMARY_MAX_WORDS) return summary;

  console.warn(`[SUMMARY-CAP] AI summary exceeded the cap: ${wordCount} words (max ${SUMMARY_MAX_WORDS}) — attempting a compression pass.`);

  try {
    const compressed = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: buildCompressionPrompt(lang),
      messages: [{ role: "user", content: summary }],
    });
    const compressedText = compressed.content?.find((block) => block.type === "text")?.text?.trim();
    if (compressedText) {
      const compressedWordCount = countWords(compressedText);
      if (compressedWordCount <= SUMMARY_MAX_WORDS) {
        console.warn(`[SUMMARY-CAP] resolved via compression pass: ${compressedWordCount} words.`);
        return compressedText;
      }
      // Still over, but likely closer — trim this version below rather
      // than the longer original.
      const trimmed = trimToWordCap(compressedText, SUMMARY_MAX_WORDS);
      console.warn(`[SUMMARY-CAP] compression pass still over the cap (${compressedWordCount} words) — resolved via deterministic trim: ${countWords(trimmed)} words.`);
      return trimmed;
    }
  } catch (err) {
    console.error("[SUMMARY-CAP] compression pass failed, falling back to a deterministic trim of the original:", err?.message || err);
  }

  // No compressed text to work with (compression pass failed or returned
  // nothing) — fall back to trimming the original draft.
  const trimmed = trimToWordCap(summary, SUMMARY_MAX_WORDS);
  console.warn(`[SUMMARY-CAP] resolved via deterministic trim: ${countWords(trimmed)} words (from ${wordCount}, original draft).`);
  return trimmed;
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

    const rawSummary = message.content?.find((block) => block.type === "text")?.text?.trim();
    if (!rawSummary) throw new Error("Empty response from Claude");

    // enforceSummaryCap already catches its own failures internally, but
    // if it were ever to throw anyway, the best available text is still
    // the uncapped draft — better to return that over the cap than lose a
    // perfectly good summary to an unrelated hiccup in the cap logic.
    let summary = rawSummary;
    try {
      summary = await enforceSummaryCap(client, lang, rawSummary);
    } catch (capErr) {
      console.error("[SUMMARY-CAP] unexpected failure, returning the uncapped draft:", capErr?.message || capErr);
    }

    return NextResponse.json({ summary });
  } catch (err) {
    // Full diagnostic detail server-side (message/type/stack, plus the
    // Anthropic API's own status + response body when this came from the
    // model call) — the client only ever sees the graceful fallback below.
    console.error("[AI-SUMMARY-ERROR]", {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      ...(err instanceof APIError && {
        anthropicStatus: err.status,
        anthropicErrorType: err.type,
        anthropicResponseBody: err.error,
      }),
    });

    // This is a best-effort AI enhancement, never a required step — the CV
    // form's summary field just stays empty/editable and the rest of the
    // flow (preview, PDF export, archival, LinkedIn track, notifications)
    // is entirely unaffected by this failing. Always 200, never a 500: an
    // AI hiccup here must never look like a server crash to the client,
    // to monitoring, or to the customer.
    return NextResponse.json({ summary: "", error: "تعذّر إنشاء الملخص المهني تلقائياً." });
  }
}
