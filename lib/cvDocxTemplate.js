// Builds the Word (.docx) export — a completely independent module from
// lib/cvHtmlTemplate.js (used only by the PDF/preview). Nothing here is
// imported BY, or imports FROM, the PDF path except the pure, already-
// shared label strings in lib/cvLabels.js — every formatting helper below
// (GPA, years-of-experience, line/list splitting) is deliberately
// duplicated rather than shared, so this file can never affect PDF output
// even if changed. See app/api/generate-docx/route.js for the caller.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, convertMillimetersToTwip,
  Table, TableRow, TableCell, TableBorders, WidthType,
} from "docx";
import { CV_LABELS } from "./cvLabels";

const FONT = "Arial";

function splitLines(t) {
  return String(t || "").split("\n").map((l) => l.trim()).filter(Boolean);
}
function splitList(t) {
  return String(t || "").split(/[،,\n]/).map((l) => l.trim()).filter(Boolean);
}

// Duplicated from lib/cvHtmlTemplate.js on purpose — see the file-level note above.
function gpaExceedsScale(value, scale) {
  if (!value || !scale) return false;
  const num = parseFloat(value);
  const max = parseFloat(scale);
  return !isNaN(num) && !isNaN(max) && num > max;
}
function formatGpaValue(value, scale, lang) {
  if (!value || !scale || gpaExceedsScale(value, scale)) return "";
  return lang === "en" ? `${value} / ${scale}` : `${value} من ${scale}`;
}

/**
 * Builds a complete docx.Document from the same CV data shape the PDF
 * route receives (see app/api/generate-pdf/route.js's request body) —
 * same section order, same content rules (internal notes/target cities
 * never rendered, GPA "x / scale", translated content as given). Returns
 * the Document object; the caller packs it to a buffer.
 */
export function buildCvDocx({ form, experiences, education, courses, certifications, customSections, techSkills, softSkills, skillDetails, lang = "ar" }) {
  const isAr = lang !== "en";
  const t = CV_LABELS[lang] || CV_LABELS.ar;
  const align = isAr ? AlignmentType.RIGHT : AlignmentType.LEFT;

  const exps = (experiences || []).filter((x) => x.title || x.employer);
  const edus = (education || []).filter((x) => x.degree || x.school);
  const crs = (courses || []).filter((x) => x.name || x.hours || x.provider);
  const certs = (certifications || []).filter((x) => x.name || x.issuingBody || x.date);
  const customs = (customSections || []).filter((x) => x.title || x.points);

  // run() / para() below centralize the RTL/bidi + font attributes so every
  // paragraph/run in the document gets them identically — the single
  // source of truth for "what makes this doc render correctly RTL/LTR".
  function run(text, opts = {}) {
    return new TextRun({
      text: String(text ?? ""),
      font: FONT,
      rightToLeft: isAr,
      ...opts,
    });
  }
  function para(children, opts = {}) {
    return new Paragraph({
      bidirectional: isAr,
      alignment: align,
      children: Array.isArray(children) ? children : [children],
      ...opts,
    });
  }
  function bulletPara(text) {
    return para([run(text, { size: 21 })], { bullet: { level: 0 }, spacing: { after: 60 } });
  }
  function heading(text) {
    return para([run(text, { bold: true, size: 24 })], {
      border: { bottom: { color: "999999", space: 4, style: BorderStyle.SINGLE, size: 4 } },
      spacing: { before: 220, after: 100 },
    });
  }
  function inlineFields(parts) {
    return parts.filter(Boolean).join(" | ");
  }

  const children = [];

  // ── Header ──
  children.push(para([run(form.name || t.fallbackName, { bold: true, size: 40 })], { spacing: { after: 40 } }));
  const headline = exps[0]?.title || "";
  if (headline) children.push(para([run(headline, { bold: true, size: 23, color: "333333" })], { spacing: { after: 60 } }));
  const contactLine = inlineFields([
    form.email, form.phone, form.city, form.linkedin,
    // Already a complete, grammatically-correct phrase computed client-side
    // (see formatYearsOfExperiencePhrase in AtsCvBuilder.jsx) — no label
    // concatenation needed here.
    form.yearsOfExperience,
  ]);
  if (contactLine) children.push(para([run(contactLine, { size: 20, color: "333333" })], { spacing: { after: 160 } }));

  // ── Summary ──
  if (form.summary) {
    children.push(heading(t.summary));
    splitLines(form.summary).forEach((line) => children.push(para([run(line, { size: 21 })], { spacing: { after: 40 } })));
  }

  // ── Skills ──
  // Technical skills always carry an (AI-generated, editable) description
  // now — for every CV, not just a sparse one — so whenever at least one is
  // present the group renders as a bulleted "**Name**: description" list,
  // name and description inline on one line. Professional/soft skills
  // NEVER have descriptions, for anyone — rendered as a borderless 2-column
  // table of plain-name bullets instead (docx has no CSS-multicolumn
  // equivalent within a single section, so a table is the standard way to
  // lay out a side-by-side bulleted grid in Word).
  const techDetails = (skillDetails?.tech || []).filter((s) => s.name);
  const techHasDescriptions = techDetails.some((s) => s.description);
  function skillsGridTable(names) {
    const rows = [];
    for (let i = 0; i < names.length; i += 2) {
      rows.push(new TableRow({
        children: [names[i], names[i + 1]].map((name) => new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          margins: { top: 20, bottom: 20, left: 80, right: 80 },
          children: [name !== undefined ? bulletPara(name) : para([run("")])],
        })),
      }));
    }
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: isAr, borders: TableBorders.NONE, rows });
  }
  if (techSkills || softSkills) {
    children.push(heading(t.skills));
    if (techHasDescriptions) {
      children.push(para([run(t.techSkills, { bold: true, size: 21 })], { spacing: { after: 20 } }));
      techDetails.forEach((s) => children.push(bulletPara(s.description ? `${s.name}: ${s.description}` : s.name)));
    } else if (techSkills) {
      children.push(para([run(t.techSkills, { bold: true, size: 21 }), run(` ${splitList(techSkills).join(" | ")}`, { size: 21 })], { spacing: { after: 40 } }));
    }
    if (softSkills) {
      children.push(para([run(t.softSkills, { bold: true, size: 21 })], { spacing: { after: 20 } }));
      children.push(skillsGridTable(splitList(softSkills)));
    }
  }

  // ── Experience ──
  if (exps.length) {
    children.push(heading(t.experience));
    exps.forEach((x) => {
      children.push(para([run(inlineFields([x.title, x.employer, x.period]), { bold: true, size: 21 })], { spacing: { after: 30 } }));
      if (x.bullets) splitLines(x.bullets).forEach((line) => children.push(bulletPara(line)));
      children.push(para([run("")], { spacing: { after: 60 } }));
    });
  }

  // ── Education ──
  if (edus.length) {
    children.push(heading(t.education));
    edus.forEach((x) => {
      children.push(para([run(inlineFields([x.degree, x.school, x.year]), { bold: true, size: 21 })], { spacing: { after: 30 } }));
      const gpaLine = formatGpaValue(x.gpaValue, x.gpaScale, lang);
      if (gpaLine) children.push(para([run(`${t.gpa}: `, { bold: true, size: 19, color: "444444" }), run(gpaLine, { size: 19, color: "444444" })], { spacing: { after: 20 } }));
      if (x.gradProject) children.push(para([run(`${t.gradProject}: `, { bold: true, size: 19, color: "444444" }), run(x.gradProject, { size: 19, color: "444444" })], { spacing: { after: 20 } }));
      children.push(para([run("")], { spacing: { after: 60 } }));
    });
  }

  // ── Achievements ──
  if (form.achievements) {
    children.push(heading(t.achievements));
    splitLines(form.achievements).forEach((line) => children.push(bulletPara(line)));
  }

  // ── Courses ──
  if (crs.length) {
    children.push(heading(t.courses));
    crs.forEach((x) => {
      children.push(para([run(inlineFields([x.name, x.provider, x.hours ? `${x.hours} ${t.hoursUnit}` : "", x.date]), { bold: true, size: 21 })], { spacing: { after: 30 } }));
      if (x.hasLicense && x.licenseNumber) children.push(para([run(`${t.licenseNumber}: `, { bold: true, size: 19, color: "444444" }), run(x.licenseNumber, { size: 19, color: "444444" })], { spacing: { after: 20 } }));
      children.push(para([run("")], { spacing: { after: 60 } }));
    });
  }

  // ── Certifications ──
  if (certs.length) {
    children.push(heading(t.certs));
    certs.forEach((x) => {
      children.push(para([run(inlineFields([x.name, x.issuingBody, x.date]), { bold: true, size: 21 })], { spacing: { after: 60 } }));
    });
  }

  // ── Custom sections (applicant order) ──
  customs.forEach((x) => {
    children.push(heading(x.title || t.customSectionFallbackTitle));
    if (x.points) splitLines(x.points).forEach((line) => children.push(bulletPara(line)));
  });

  // ── Languages — always absolute last, matching cvHtmlTemplate.js/AtsCvBuilder.jsx's order ──
  if (form.languages) {
    children.push(heading(t.languages));
    splitLines(form.languages).forEach((line) => children.push(para([run(line, { size: 21 })], { spacing: { after: 40 } })));
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
            margin: {
              top: convertMillimetersToTwip(18),
              bottom: convertMillimetersToTwip(18),
              left: convertMillimetersToTwip(18),
              right: convertMillimetersToTwip(18),
            },
          },
        },
        children,
      },
    ],
  });
}
