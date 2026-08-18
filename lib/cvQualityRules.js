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

export function isExperienceEntryComplete(x) {
  if (!isExperienceEntryStarted(x)) return true;
  const hasBullet = (x.bullets || []).some((b) => b?.trim());
  const hasEndDate = x.current || (x.toYear && x.toMonth);
  return !!(x.title?.trim() && x.employer?.trim() && x.fromYear && x.fromMonth && hasEndDate && hasBullet);
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

export const SPARSE_SKILLS_MINIMUM = 5;

function sparseSkillGroupOk(tags, descriptions) {
  return (tags || []).length >= SPARSE_SKILLS_MINIMUM
    && (tags || []).every((s) => descriptions?.[s]?.trim());
}

/**
 * Returns an array of issue codes (empty if the CV passes every rule in
 * this batch). Codes: "nameParts", "experienceIncomplete", "courseProvider",
 * "sparseSkillsMinimum".
 */
export function getCvQualityIssues({ name, experiences, courses, techSkillTags, softSkillTags, techSkillDescriptions, softSkillDescriptions }) {
  const issues = [];

  if (!isValidNamePartCount(name)) issues.push("nameParts");
  if ((experiences || []).some((x) => !isExperienceEntryComplete(x))) issues.push("experienceIncomplete");
  if ((courses || []).some((c) => !isCourseEntryComplete(c))) issues.push("courseProvider");

  if (isSparseCv(experiences)) {
    const techOk = sparseSkillGroupOk(techSkillTags, techSkillDescriptions);
    const softOk = sparseSkillGroupOk(softSkillTags, softSkillDescriptions);
    if (!techOk || !softOk) issues.push("sparseSkillsMinimum");
  }

  return issues;
}
