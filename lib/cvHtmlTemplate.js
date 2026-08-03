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
export function buildCvHtml({ form, experiences, education, techSkills, softSkills, splitLines, splitList, lang = "ar" }) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const t = CV_LABELS[lang] || CV_LABELS.ar;
  const sep = lang === "en" ? ", " : "، ";

  const exps = experiences.filter((x) => x.title || x.employer);
  const edus = education.filter((x) => x.degree || x.school);

  const headerName = esc(form.name || t.fallbackName);
  const contactParts = [form.email, form.phone, form.city].filter(Boolean).map(esc);

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
          </div>`).join("")}
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
  @font-face {
    font-family: "Tajawal";
    font-weight: 400;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_ARABIC_REGULAR_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 400;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_LATIN_REGULAR_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 700;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_ARABIC_BOLD_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "Tajawal";
    font-weight: 700;
    font-style: normal;
    src: url(data:font/woff2;base64,${CV_FONT_LATIN_BOLD_WOFF2}) format("woff2");
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
  .role { font-size: 14px; font-weight: 700; margin-top: 4px; line-height: 1.6; }
  .contact { font-size: 11.5px; margin-top: 8px; color: #333333; }
  .contact span { margin-inline-end: 14px; }

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
      ${form.targetRole ? `<div class="role">${esc(form.targetRole)}</div>` : ""}
      ${contactParts.length ? `<div class="contact">${contactParts.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}
    </div>
    ${sections.join("\n")}
  </div>
</body>
</html>`;
}
