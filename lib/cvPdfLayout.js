import { bidiText } from "./pdfText";
import { CV_LABELS } from "./cvLabels";

const INK = "#000000";
const BRASS = "#000000";
const SLATE = "#333333";

const PAGE_H = 297;
const MARGIN = 18;
const LEFT_X = MARGIN;
const RIGHT_X = 210 - MARGIN;
const CONTENT_W = RIGHT_X - LEFT_X;
const BOTTOM = PAGE_H - MARGIN;

function ensureRoom(doc, y, needed) {
  if (y + needed > BOTTOM) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

/** Layout helpers below take `dir` ("rtl" | "ltr") and mirror anchor edges accordingly. */
function edgeX(dir) {
  return dir === "rtl" ? RIGHT_X : LEFT_X;
}
function align(dir) {
  return dir === "rtl" ? "right" : "left";
}
function oppositeEdgeX(dir) {
  return dir === "rtl" ? LEFT_X : RIGHT_X;
}
function oppositeAlign(dir) {
  return dir === "rtl" ? "left" : "right";
}

function drawParagraph(doc, text, y, dir, { maxWidth = CONTENT_W, lineHeight = 5, color = SLATE, x } = {}) {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    y = ensureRoom(doc, y, lineHeight);
    bidiText(doc, line, x ?? edgeX(dir), y, { align: align(dir), color });
    y += lineHeight;
  }
  return y;
}

/** Draws a bullet paragraph with the marker as an actual shape (not a text glyph the font may lack), indented from the leading edge. */
function bulletParagraph(doc, text, y, dir, { lineHeight = 4.8, color = SLATE, maxWidth = CONTENT_W } = {}) {
  const inset = 4;
  y = ensureRoom(doc, y, lineHeight);
  doc.setFillColor(BRASS);
  const squareX = dir === "rtl" ? RIGHT_X - 1 : LEFT_X - 0.1;
  doc.rect(squareX, y - 2.6, 1.1, 1.1, "F");
  const textX = dir === "rtl" ? RIGHT_X - inset : LEFT_X + inset;
  return drawParagraph(doc, text, y, dir, { maxWidth: maxWidth - inset, lineHeight, color, x: textX });
}

function sectionTitle(doc, title, y, dir) {
  y = ensureRoom(doc, y, 11);
  doc.setFont("Amiri", "bold");
  doc.setFontSize(11);
  bidiText(doc, title, edgeX(dir), y, { align: align(dir), color: BRASS });
  doc.setDrawColor("#d0d0d0");
  doc.setLineWidth(0.2);
  doc.line(LEFT_X, y + 1.8, RIGHT_X, y + 1.8);
  return y + 8;
}

function labeledParagraph(doc, label, text, y, dir) {
  y = ensureRoom(doc, y, 10);
  doc.setFont("Amiri", "bold");
  doc.setFontSize(9.5);
  bidiText(doc, label, edgeX(dir), y, { align: align(dir), color: INK });
  y += 5;
  doc.setFont("Amiri", "normal");
  doc.setFontSize(9.5);
  y = drawParagraph(doc, text, y, dir, { lineHeight: 4.6, color: SLATE });
  return y + 3;
}

/**
 * Lays out the CV as real, selectable text in ATS-friendly reading order:
 * personal info, summary, experience, education, skills, certifications,
 * languages — single column, plain section headings, no tables/text boxes.
 *
 * `lang` ("ar" | "en") controls both the reading direction (right-aligned
 * RTL vs left-aligned LTR) and which language the section headings are
 * drawn in. Field values themselves are drawn as entered — only the
 * static labels translate.
 */
export function buildCvPdf(doc, { form, experiences, education, techSkills, softSkills, splitLines, splitList, lang = "ar" }) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const t = CV_LABELS[lang] || CV_LABELS.ar;
  let y = MARGIN + 4;

  doc.setFont("Amiri", "bold");
  doc.setFontSize(20);
  bidiText(doc, form.name || t.fallbackName, edgeX(dir), y, { align: align(dir), color: INK });
  y += 7;

  if (form.targetRole) {
    doc.setFont("Amiri", "bold");
    doc.setFontSize(12);
    bidiText(doc, form.targetRole, edgeX(dir), y, { align: align(dir), color: BRASS });
    y += 6;
  }

  const contactParts = [form.email, form.phone, form.city].filter(Boolean);
  if (contactParts.length) {
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9);
    bidiText(doc, contactParts.join("   |   "), edgeX(dir), y, { align: align(dir), color: SLATE });
    y += 6;
  }

  doc.setDrawColor(INK);
  doc.setLineWidth(0.6);
  doc.line(LEFT_X, y, RIGHT_X, y);
  y += 9;

  if (form.summary) {
    y = sectionTitle(doc, t.summary, y, dir);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(10);
    y = drawParagraph(doc, form.summary, y, dir, { lineHeight: 5.2, color: SLATE });
    y += 4;
  }

  const exps = experiences.filter((x) => x.title || x.employer);
  if (exps.length) {
    y = sectionTitle(doc, t.experience, y, dir);
    exps.forEach((x) => {
      y = ensureRoom(doc, y, 7);
      doc.setFont("Amiri", "bold");
      doc.setFontSize(10.5);
      bidiText(doc, x.employer ? `${x.title} — ${x.employer}` : x.title, edgeX(dir), y, { align: align(dir), color: INK });
      if (x.period) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        bidiText(doc, x.period, oppositeEdgeX(dir), y, { align: oppositeAlign(dir), color: SLATE });
      }
      y += 5.5;

      if (x.bullets) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9.5);
        splitLines(x.bullets).forEach((b) => {
          y = bulletParagraph(doc, b, y, dir, { lineHeight: 4.8, color: SLATE });
        });
      }
      y += 3;
    });
    y += 2;
  }

  const edus = education.filter((x) => x.degree || x.school);
  if (edus.length) {
    y = sectionTitle(doc, t.education, y, dir);
    edus.forEach((x) => {
      y = ensureRoom(doc, y, 6);
      doc.setFont("Amiri", "bold");
      doc.setFontSize(10);
      bidiText(doc, x.school ? `${x.degree} — ${x.school}` : x.degree, edgeX(dir), y, { align: align(dir), color: INK });
      if (x.year) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        bidiText(doc, x.year, oppositeEdgeX(dir), y, { align: oppositeAlign(dir), color: SLATE });
      }
      y += 5;

      if (x.detail) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        y = drawParagraph(doc, x.detail, y, dir, { lineHeight: 4.5, color: SLATE });
      }
      y += 3;
    });
    y += 2;
  }

  if (techSkills || softSkills) {
    y = sectionTitle(doc, t.skills, y, dir);
    const sep = lang === "en" ? ", " : "، ";
    if (techSkills) y = labeledParagraph(doc, t.techSkills, splitList(techSkills).join(sep), y, dir);
    if (softSkills) y = labeledParagraph(doc, t.softSkills, splitList(softSkills).join(sep), y, dir);
    y += 1;
  }

  if (form.certs) {
    y = sectionTitle(doc, t.certs, y, dir);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9.5);
    splitLines(form.certs).forEach((c) => {
      y = bulletParagraph(doc, c, y, dir, { lineHeight: 4.8, color: SLATE });
    });
    y += 2;
  }

  if (form.languages) {
    y = sectionTitle(doc, t.languages, y, dir);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9.5);
    drawParagraph(doc, form.languages, y, dir, { lineHeight: 4.8, color: SLATE });
  }
}
