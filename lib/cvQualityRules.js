// Pure validation/derivation rules for the CV-quality batch — no side
// effects, no DB/network access. Imported by the client (AtsCvBuilder.jsx)
// AND both export routes (generate-pdf, generate-docx) so "what counts as
// a valid CV" is defined exactly once and can never drift between the
// client-side gate and the server-side re-check. Returns issue CODES only
// (not messages) — each caller maps a code to its own bilingual text,
// matching how each already builds its error strings today.

// Arabic name-part connector words (بن/ابن/بنت/آل/أبو and common spelling
// variants) — these link name components together without being a "part"
// themselves, so "فيصل بن سعد المطيري" (4 raw tokens) correctly counts as
// 3 meaningful name parts, not 4.
const NAME_CONNECTOR_WORDS = new Set(["بن", "ابن", "إبن", "بنت", "آل", "أبو"]);

export function countMeaningfulNameParts(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter((part) => part && !NAME_CONNECTOR_WORDS.has(part)).length;
}

// Empty name is a separate, pre-existing "required" check (name non-empty
// is already enforced elsewhere) — this only judges a name that's actually
// been typed.
export function isValidNamePartCount(name) {
  if (!String(name || "").trim()) return true;
  return countMeaningfulNameParts(name) === 3;
}

// An experience entry becomes "started" the moment ANY field has content —
// from that point every field is required (no partial entries). A still
// fully-empty row (right after "Add experience") is never flagged, matching
// the existing dateRangeInvalid convention of only flagging entries with
// actual content.
export function isExperienceEntryStarted(x) {
  return !!(
    x.title?.trim() || x.employer?.trim() || x.fromYear || x.fromMonth ||
    x.toYear || x.toMonth || x.current || (x.bullets || []).some((b) => b?.trim())
  );
}

// The "core" identifying fields of an experience entry — title, employer,
// and dates — WITHOUT the bullets requirement. This is what gates the
// tasks/responsibilities free-text and its AI-suggest button: neither is
// usable until the entry is at least identifiable, so a suggestion (or a
// manually-typed task) is never generated/attached to an anonymous,
// dateless entry. Deliberately excludes "current" as a synonym for a
// filled end-date pair the same way isExperienceEntryComplete does.
export function areExperienceCoreFieldsComplete(x) {
  const hasEndDate = x.current || (x.toYear && x.toMonth);
  return !!(x.title?.trim() && x.employer?.trim() && x.fromYear && x.fromMonth && hasEndDate);
}

export function isExperienceEntryComplete(x) {
  if (!isExperienceEntryStarted(x)) return true;
  const hasBullet = (x.bullets || []).some((b) => b?.trim());
  return areExperienceCoreFieldsComplete(x) && hasBullet;
}

// A course row counts as "entered" the moment any field has content
// (matches the existing displayCourses filter in AtsCvBuilder.jsx) — from
// that point its issuing body becomes mandatory.
export function isCourseEntryStarted(c) {
  return !!(c.name?.trim() || String(c.hours || "").trim() || c.provider?.trim() || c.date);
}

export function isCourseEntryComplete(c) {
  if (!isCourseEntryStarted(c)) return true;
  return !!c.provider?.trim();
}

// "Sparse" CV — no experience entries at all. Internships/co-op jobs are
// entered as ordinary experience rows in this app (there's no separate
// internship field), so this single check already covers "no experience
// AND no summer/co-op training."
export function isSparseCv(experiences) {
  return !(experiences || []).some(isExperienceEntryStarted);
}

// Total months of an experience entry's date range, or null if the entry
// doesn't have enough to compute one yet (incomplete dates — by the time
// this matters for export, every started entry is already required to have
// full dates; this stays defensive for the live-typing preview, where an
// in-progress entry is normal). "current" uses today as the effective end
// date.
function experienceMonthsRange(x) {
  if (!x.fromYear || !x.fromMonth) return null;
  const fromM = Number(x.fromYear) * 12 + Number(x.fromMonth);
  let toM;
  if (x.current) {
    const now = new Date();
    toM = now.getFullYear() * 12 + (now.getMonth() + 1);
  } else {
    if (!x.toYear || !x.toMonth) return null;
    toM = Number(x.toYear) * 12 + Number(x.toMonth);
  }
  if (toM < fromM) return null; // invalid range — already flagged by dateRangeInvalid
  return [fromM, toM];
}

// Total months of REAL experience across all entries, merging overlapping/
// concurrent ranges (classic interval union) so two simultaneous jobs are
// never double-counted, and gaps between jobs are never counted at all.
export function totalMonthsOfExperience(experiences) {
  const ranges = (experiences || []).map(experienceMonthsRange).filter(Boolean).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [start, end] of ranges) {
    if (curStart === null) {
      curStart = start;
      curEnd = end;
    } else if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total;
}

// A "fresh graduate" for skill-description purposes: no real experience, or
// under a year of it once overlapping entries are merged — a single
// 3-month internship still isn't enough for descriptions to make sense as
// keyword-diluting page filler the way they do for a genuinely blank
// experience section. Broader than isSparseCv (zero experience only) by
// design; computed here, in code, so nothing downstream has to infer it.
export const FRESH_GRADUATE_MONTHS_THRESHOLD = 12;
export function isFreshGraduate(experiences) {
  return totalMonthsOfExperience(experiences) < FRESH_GRADUATE_MONTHS_THRESHOLD;
}

export const SPARSE_SKILLS_MINIMUM = 5;

// Technical skills only ever carry a description for a fresh graduate (see
// isFreshGraduate), and even then only when the applicant's own data
// actually grounds it — a legitimate keyword-only skill is no longer a
// sign anything is wrong (see app/api/describe-skill/route.js), so the
// sparse-CV minimum is a bare tag count now, exactly like soft skills.
function sparseTechOk(tags) {
  return (tags || []).length >= SPARSE_SKILLS_MINIMUM;
}
function sparseSoftOk(tags) {
  return (tags || []).length >= SPARSE_SKILLS_MINIMUM;
}

/**
 * Returns an array of issue codes (empty if the CV passes every rule in
 * this batch). Codes: "nameParts", "experienceIncomplete", "courseProvider",
 * "sparseSkillsMinimum".
 */
export function getCvQualityIssues({ name, experiences, courses, techSkillTags, softSkillTags }) {
  const issues = [];

  if (!isValidNamePartCount(name)) issues.push("nameParts");
  if ((experiences || []).some((x) => !isExperienceEntryComplete(x))) issues.push("experienceIncomplete");
  if ((courses || []).some((c) => !isCourseEntryComplete(c))) issues.push("courseProvider");

  if (isSparseCv(experiences)) {
    if (!sparseTechOk(techSkillTags) || !sparseSoftOk(softSkillTags)) issues.push("sparseSkillsMinimum");
  }

  return issues;
}
