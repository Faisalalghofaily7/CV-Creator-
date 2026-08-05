import { CV_LABELS } from "./cvLabels";
import {
  CV_FONT_ARABIC_REGULAR_WOFF2,
  CV_FONT_ARABIC_BOLD_WOFF2,
  CV_FONT_LATIN_REGULAR_WOFF2,
  CV_FONT_LATIN_BOLD_WOFF2,
} from "./cvFontData";

// Chromium's PDF text export has a font-independent bug with the mandatory
// Lam-Alef ligature ("لا"): the ligated glyph cluster's underlying text
// order gets scrambled on copy/select (e.g. "لا" -> "ال", "الإنجليزية" ->
// "اإلنجليزية") even though it renders correctly on screen — verified via
// poppler's pdftotext and Chromium's own PDFium copy/paste, independent of
// which font is used. A zero-width non-joiner between Lam and an
// Alef-family letter prevents the ligature from forming, which sidesteps
// the buggy code path; the letters still render clearly, just not fused
// into the single compact ligature glyph.
function guardLigatures(str) {
  return str.replace(/ل(?=[آأإا])/g, "ل‌");
}

// KNOWN UNRESOLVED ISSUE (found while adding the "متمكّن" proficiency level):
// Chromium's PDF text export also scrambles the extracted order of ANY
// Arabic word containing a shadda (gemination mark, U+0651) — e.g.
// "متمكّن" -> extracts as "متمّك ن" (the mark shifts one letter early and a
// stray space appears at the mark-attachment cluster boundary). Confirmed
// via isolated repro (varying font/word/justify/context — always
// reproduces) and via pdftotext -raw, which shows Chromium emits the
// shadda+base-letter as a separate ActualText run painted out of logical
// order — a different failure mode from the Lam-Alef ligature bug above,
// and NOT fixable with the same zero-width-non-joiner trick (tried
// inserting it on both sides of the base letter and after the mark; none
// corrected the order, and some made it worse). Word still renders
// correctly on screen/print — only extracted/copied text is affected.
// Left unfixed here per explicit instruction not to touch PDF generation
// in this change; flagging for the separate PDF-generation review.

function esc(str) {
  return guardLigatures(String(str ?? "")).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function paragraphHtml(text) {
  // Preserve manual line breaks within a free-text field as separate lines.
  return esc(text).split("\n").map((l) => l.trim()).filter(Boolean).join("<br>");
}

function bulletsHtml(lines) {
  return `<ul class="bullets">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

/**
 * Builds a complete, self-contained HTML document for the CV — real text,
 * no manual glyph/bidi handling. Chromium's own text-layout engine shapes
 * and orders Arabic natively, so the PDF it prints keeps correct, copyable,
 * logical-order text (this is the entire point of rendering via a browser
 * instead of hand-drawing glyphs).
 */
export function buildCvHtml({ form, experiences, education, projects, courses, techSkills, softSkills, splitLines, splitList, lang = "ar" }) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const t = CV_LABELS[lang] || CV_LABELS.ar;
  const sep = lang === "en" ? ", " : "، ";

  const exps = experiences.filter((x) => x.title || x.employer);
  const edus = education.filter((x) => x.degree || x.school);
  const projs = (projects || []).filter((x) => x.name || x.details);
  const crs = (courses || []).filter((x) => x.name || x.hours || x.provider);

  const headerName = esc(form.name || t.fallbackName);
  const contactRaw = [form.email, form.phone, form.city, form.linkedin];
  if (form.yearsOfExperience) contactRaw.push(`${form.yearsOfExperience} ${t.yearsOfExperience}`);
  const contactParts = contactRaw.filter(Boolean).map(esc);

  const sections = [];

  if (form.summary) {
    sections.push(`
      <section>
        <h2>${esc(t.summary)}</h2>
        <p>${paragraphHtml(form.summary)}</p>
      </section>`);
  }

  if (exps.length) {
    sections.push(`
      <section>
        <h2>${esc(t.experience)}</h2>
        ${exps.map((x) => `
          <div class="entry">
            <div class="entry-head">
              <span class="entry-title">${esc(x.title)}${x.employer ? ` — ${esc(x.employer)}` : ""}</span>
              ${x.period ? `<span class="entry-meta">${esc(x.period)}</span>` : ""}
            </div>
            ${x.bullets ? bulletsHtml(splitLines(x.bullets)) : ""}
          </div>`).join("")}
      </section>`);
  }

  if (edus.length) {
    sections.push(`
      <section>
        <h2>${esc(t.education)}</h2>
        ${edus.map((x) => `
          <div class="entry">
            <div class="entry-head">
              <span class="entry-title">${esc(x.degree)}${x.school ? ` — ${esc(x.school)}` : ""}</span>
              ${x.year ? `<span class="entry-meta">${esc(x.year)}</span>` : ""}
            </div>
            ${x.detail ? `<div class="entry-detail">${esc(x.detail)}</div>` : ""}
            ${x.gradProject ? `<div class="entry-detail"><strong>${esc(t.gradProject)}:</strong> ${esc(x.gradProject)}</div>` : ""}
          </div>`).join("")}
      </section>`);
  }

  if (projs.length) {
    sections.push(`
      <section>
        <h2>${esc(t.projects)}</h2>
        ${projs.map((x) => `
          <div class="entry">
            <div class="entry-head">
              <span class="entry-title">${esc(x.name)}</span>
            </div>
            ${x.details ? `<div class="entry-detail">${paragraphHtml(x.details)}</div>` : ""}
          </div>`).join("")}
      </section>`);
  }

  if (form.achievements) {
    sections.push(`
      <section>
        <h2>${esc(t.achievements)}</h2>
        ${bulletsHtml(splitLines(form.achievements))}
      </section>`);
  }

  if (techSkills || softSkills) {
    sections.push(`
      <section>
        <h2>${esc(t.skills)}</h2>
        ${techSkills ? `<p><strong>${esc(t.techSkills)}</strong> ${esc(splitList(techSkills).join(sep))}</p>` : ""}
        ${softSkills ? `<p><strong>${esc(t.softSkills)}</strong> ${esc(splitList(softSkills).join(sep))}</p>` : ""}
      </section>`);
  }

  if (crs.length) {
    sections.push(`
      <section>
        <h2>${esc(t.courses)}</h2>
        ${crs.map((x) => {
          const meta = [x.hours ? `${x.hours} ${t.hoursUnit}` : "", x.date || ""].filter(Boolean).join(" · ");
          return `
          <div class="entry">
            <div class="entry-head">
              <span class="entry-title">${esc(x.name)}${x.provider ? ` — ${esc(x.provider)}` : ""}</span>
              ${meta ? `<span class="entry-meta">${esc(meta)}</span>` : ""}
            </div>
          </div>`;
        }).join("")}
      </section>`);
  }

  if (form.certs) {
    sections.push(`
      <section>
        <h2>${esc(t.certs)}</h2>
        ${bulletsHtml(splitLines(form.certs))}
      </section>`);
  }

  if (form.languages) {
    sections.push(`
      <section>
        <h2>${esc(t.languages)}</h2>
        <p>${paragraphHtml(form.languages)}</p>
      </section>`);
  }

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<style>
  /* Arabic and Latin subsets share the family name but need distinct
     unicode-range declarations — without them, both @font-face rules have
     identical family/weight/style and which glyph table Chromium actually
     uses per character is undefined, which is what produced broken/tofu
     glyphs for whichever script "lost". unicode-range makes the pick
     per-codepoint and deterministic instead. */
  @font-face {
    font-family: "Tajawal";
    font-weight: 400;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_ARABIC_REGULAR_WOFF2}) format("woff2");
    unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1;
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 400;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_LATIN_REGULAR_WOFF2}) format("woff2");
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 700;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_ARABIC_BOLD_WOFF2}) format("woff2");
    unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1;
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 700;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_LATIN_BOLD_WOFF2}) format("woff2");
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Tajawal", sans-serif;
    color: #000000;
    background: #ffffff;
    font-size: 13px;
    line-height: 1.7;
  }
  .cv-page { padding: 0; }

  .header { border-bottom: 2px solid #000000; padding-bottom: 10px; margin-bottom: 14px; }
  .name { font-size: 24px; font-weight: 700; line-height: 1.5; }
  .contact { font-size: 11.5px; margin-top: 8px; color: #333333; }
  /* Sibling inline elements don't get their own bidi context by default —
     without this, adjacent LTR-ish contact fields (a phone number, a
     LinkedIn handle, "5 سنوات خبرة") can bleed into each other's content
     during Chromium's PDF text-layout pass (verified: without isolation,
     "5 سنوات خبرة" next to a LinkedIn handle rendered as
     "linkedin.com/in/faisal5" — the digit from one field visually fused
     onto the end of an unrelated field). Isolating each field keeps its
     content self-contained regardless of what's next to it. */
  .contact span { margin-inline-end: 14px; unicode-bidi: isolate; }

  section { margin-bottom: 14px; }
  h2 {
    font-size: 13px;
    font-weight: 700;
    margin: 0 0 10px;
    padding-bottom: 7px;
    line-height: 1.8;
    border-bottom: 1px solid #cccccc;
  }
  p { margin: 0 0 4px; text-align: justify; }

  .entry { margin-bottom: 10px; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .entry-title { font-weight: 700; }
  .entry-meta { font-size: 11px; color: #333333; white-space: nowrap; font-style: italic; }
  .entry-detail { font-size: 12px; color: #333333; margin-top: 2px; }

  ul.bullets { margin: 4px 0 0; padding-inline-start: 18px; }
  ul.bullets li { margin-bottom: 3px; }

  strong { font-weight: 700; }
</style>
</head>
<body>
  <div class="cv-page">
    <div class="header">
      <div class="name">${headerName}</div>
      ${contactParts.length ? `<div class="contact">${contactParts.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}
    </div>
    ${sections.join("\n")}
  </div>
</body>
</html>`;
}
