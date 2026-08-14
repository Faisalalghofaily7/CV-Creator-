import { CV_LABELS } from "./cvLabels";
import {
  CV_FONT_ARABIC_REGULAR_WOFF2,
  CV_FONT_ARABIC_BOLD_WOFF2,
  CV_FONT_LATIN_REGULAR_WOFF2,
  CV_FONT_LATIN_BOLD_WOFF2,
} from "./cvFontData";

// KNOWN UNRESOLVED ISSUES — both are Chromium/PDFium PDF-text-export bugs,
// not a rendering problem: the mandatory Lam-Alef ligature ("لا", incl. at
// the very common "ال" article + alef-initial-word boundary, e.g.
// "الاقتصاد") and any word containing a shadda (gemination mark, U+0651,
// e.g. "متمكّن") can both come out with their character order scrambled
// when the PDF's text layer is copy/pasted or run through pdftotext —
// confirmed via isolated repro and independent of font. On-screen and
// printed rendering is correct either way; only the copied text's exact
// character order is affected.
//
// A previous attempt "fixed" the Lam-Alef case by inserting a zero-width
// non-joiner between the Lam and the following Alef to stop the ligature
// from forming at all. That traded a copy/paste bug for a much worse,
// visible one: it also stopped the letters from *cursively joining*, so
// "الأحمد" printed as two disconnected chunks ("ال" + "أحمد") — wrong for
// every reader, not just someone copying text out of the PDF. That trick
// was removed; both issues are left as the unavoidable Chromium bugs they
// are, matching how the shadda case was already handled.
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Appends the "years experience" / "سنوات خبرة" label to a years-of-
// experience value, UNLESS the value already ends with that exact label —
// a safety net against a translated/extracted value that (against the
// translate-extraction prompt's instructions) folded the label wording
// into the value itself, which would otherwise render duplicated, e.g.
// "4 سنوات خبرة سنوات خبرة". Same helper duplicated in components/
// AtsCvBuilder.jsx (the client-side preview) since the two run in
// separate modules.
function formatYearsLine(value, label) {
  const v = String(value || "").trim();
  if (!v) return "";
  const trimmedLabel = String(label || "").trim();
  if (trimmedLabel && v.toLowerCase().endsWith(trimmedLabel.toLowerCase())) return v;
  return trimmedLabel ? `${v} ${trimmedLabel}` : v;
}

function paragraphHtml(text) {
  // Preserve manual line breaks within a free-text field as separate lines.
  return esc(text).split("\n").map((l) => l.trim()).filter(Boolean).join("<br>");
}

function bulletsHtml(lines) {
  return `<ul class="bullets">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

// Renders a set of fields as one clean " | "-separated line (e.g. "Job
// Title | Employer | Jan 2020 - Present"), the professional-CV convention
// requested for entry header lines and the contact line. Each field is
// wrapped in its own isolated span — extending the same fix used for the
// header contact line to every mixed Arabic/Latin/number inline line — so
// adjacent fields never bleed into each other during Chromium's bidi text
// layout, without ever inserting anything into the Arabic text itself
// (which is what previously broke letter joining; see the note above esc).
function inlineFields(parts) {
  const filtered = parts.filter(Boolean).map(esc);
  if (!filtered.length) return "";
  return filtered.map((p) => `<span>${p}</span>`).join('<span class="sep"> | </span>');
}

/**
 * Builds a complete, self-contained HTML document for the CV — real text,
 * no manual glyph/bidi handling. Chromium's own text-layout engine shapes
 * and orders Arabic natively, so the PDF it prints keeps correct, copyable,
 * logical-order text (this is the entire point of rendering via a browser
 * instead of hand-drawing glyphs).
 */
export function buildCvHtml({ form, experiences, education, courses, certifications, customSections, techSkills, softSkills, splitLines, splitList, lang = "ar" }) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const t = CV_LABELS[lang] || CV_LABELS.ar;

  // Experiences arrive already sorted most-recent-first by the caller
  // (the same ordering the on-screen preview shows), so the entry list and
  // the headline below both just take that order as given.
  const exps = experiences.filter((x) => x.title || x.employer);
  const edus = education.filter((x) => x.degree || x.school);
  const crs = (courses || []).filter((x) => x.name || x.hours || x.provider);
  const certs = (certifications || []).filter((x) => x.name || x.issuingBody || x.date);
  // Fully user-defined sections (title + points) — already spell-checked
  // (title) / polished (points) by the caller, same as every other field
  // here; this template only ever renders what it's given.
  const customs = (customSections || []).filter((x) => x.title || x.points);

  const headerName = esc(form.name || t.fallbackName);
  // No dedicated headline field is collected — the professional title
  // under the name is simply the most recent role's job title, if any.
  const headline = exps[0]?.title || "";
  const contactHtml = inlineFields([
    form.email,
    form.phone,
    form.city,
    form.linkedin,
    formatYearsLine(form.yearsOfExperience, t.yearsOfExperience),
  ]);

  const sections = [];

  if (form.summary) {
    sections.push(`
      <section>
        <h2>${esc(t.summary)}</h2>
        <p>${paragraphHtml(form.summary)}</p>
      </section>`);
  }

  if (techSkills || softSkills) {
    sections.push(`
      <section>
        <h2>${esc(t.skills)}</h2>
        ${techSkills ? `<p><strong>${esc(t.techSkills)}</strong> ${esc(splitList(techSkills).join(" | "))}</p>` : ""}
        ${softSkills ? `<p><strong>${esc(t.softSkills)}</strong> ${esc(splitList(softSkills).join(" | "))}</p>` : ""}
      </section>`);
  }

  if (exps.length) {
    sections.push(`
      <section>
        <h2>${esc(t.experience)}</h2>
        ${exps.map((x) => `
          <div class="entry">
            <div class="entry-line">${inlineFields([x.title, x.employer, x.period])}</div>
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
            <div class="entry-line">${inlineFields([x.degree, x.school, x.year])}</div>
            ${x.detail ? `<div class="entry-detail"><strong>${esc(t.gpa)}:</strong> ${esc(x.detail)}</div>` : ""}
            ${x.gradProject ? `<div class="entry-detail"><strong>${esc(t.gradProject)}:</strong> ${esc(x.gradProject)}</div>` : ""}
          </div>`).join("")}
      </section>`);
  }

  if (form.languages) {
    sections.push(`
      <section>
        <h2>${esc(t.languages)}</h2>
        <p>${paragraphHtml(form.languages)}</p>
      </section>`);
  }

  if (form.achievements) {
    sections.push(`
      <section>
        <h2>${esc(t.achievements)}</h2>
        ${bulletsHtml(splitLines(form.achievements))}
      </section>`);
  }

  if (crs.length) {
    sections.push(`
      <section>
        <h2>${esc(t.courses)}</h2>
        ${crs.map((x) => `
          <div class="entry">
            <div class="entry-line">${inlineFields([x.name, x.provider, x.hours ? `${x.hours} ${t.hoursUnit}` : "", x.date])}</div>
            ${x.hasLicense && x.licenseNumber ? `<div class="entry-detail"><strong>${esc(t.licenseNumber)}:</strong> ${esc(x.licenseNumber)}</div>` : ""}
          </div>`).join("")}
      </section>`);
  }

  if (certs.length) {
    sections.push(`
      <section>
        <h2>${esc(t.certs)}</h2>
        ${certs.map((x) => `
          <div class="entry">
            <div class="entry-line">${inlineFields([x.name, x.issuingBody, x.date])}</div>
          </div>`).join("")}
      </section>`);
  }

  // User-defined sections always go last, in the order the applicant added
  // them — everything above is a fixed section, this is the "extra" one.
  customs.forEach((x) => {
    sections.push(`
      <section>
        <h2>${esc(x.title || t.customSectionFallbackTitle)}</h2>
        ${x.points ? bulletsHtml(splitLines(x.points)) : ""}
      </section>`);
  });

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
  .headline { font-size: 13.5px; font-weight: 600; color: #333333; margin-top: 3px; }
  .contact { font-size: 11.5px; margin-top: 8px; color: #333333; }
  /* Sibling inline elements don't get their own bidi context by default —
     without this, adjacent LTR-ish fields (a phone number, a LinkedIn
     handle, "5 سنوات خبرة", an English employer name next to an Arabic
     date) can bleed into each other's content during Chromium's PDF
     text-layout pass (verified: without isolation, "5 سنوات خبرة" next to
     a LinkedIn handle rendered as "linkedin.com/in/faisal5" — the digit
     from one field visually fused onto the end of an unrelated field).
     Isolating each field keeps its content self-contained regardless of
     what's next to it — applied to every " | "-joined inline line
     (contact line and entry header lines alike), never to running Arabic
     text itself, which is what previously broke letter joining. */
  .contact span, .entry-line span { unicode-bidi: isolate; }
  .sep { color: #999999; margin: 0 2px; }

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
  .entry-line { font-weight: 700; font-size: 13px; }
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
      ${headline ? `<div class="headline">${esc(headline)}</div>` : ""}
      ${contactHtml ? `<div class="contact">${contactHtml}</div>` : ""}
    </div>
    ${sections.join("\n")}
  </div>
</body>
</html>`;
}
