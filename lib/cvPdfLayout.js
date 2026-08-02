import { rtlText, ltrText } from "./pdfText";

const INK = "#14283c";
const BRASS = "#a67c34";
const SLATE = "#4a5568";

const PAGE_H = 297;
const MARGIN = 18;
const RIGHT_X = 210 - MARGIN;
const LEFT_X = MARGIN;
const CONTENT_W = RIGHT_X - LEFT_X;
const BOTTOM = PAGE_H - MARGIN;

function ensureRoom(doc, y, needed) {
  if (y + needed > BOTTOM) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function drawParagraph(doc, text, y, { maxWidth = CONTENT_W, lineHeight = 5, color = SLATE, rightX = RIGHT_X } = {}) {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    y = ensureRoom(doc, y, lineHeight);
    rtlText(doc, line, rightX, y, { color });
    y += lineHeight;
  }
  return y;
}

/** Draws a bullet paragraph with the marker as an actual shape (not a text glyph the font may lack), indented from the right edge. */
function bulletParagraph(doc, text, y, { lineHeight = 4.8, color = SLATE, maxWidth = CONTENT_W } = {}) {
  const inset = 4;
  y = ensureRoom(doc, y, lineHeight);
  doc.setFillColor(BRASS);
  doc.rect(RIGHT_X - 1, y - 2.6, 1.1, 1.1, "F");
  return drawParagraph(doc, text, y, { maxWidth: maxWidth - inset, lineHeight, color, rightX: RIGHT_X - inset });
}

function sectionTitle(doc, title, y) {
  y = ensureRoom(doc, y, 11);
  doc.setFont("Amiri", "bold");
  doc.setFontSize(11);
  rtlText(doc, title, RIGHT_X, y, { color: BRASS });
  doc.setDrawColor("#e0d9ca");
  doc.setLineWidth(0.2);
  doc.line(LEFT_X, y + 1.8, RIGHT_X, y + 1.8);
  return y + 8;
}

function labeledParagraph(doc, label, text, y) {
  y = ensureRoom(doc, y, 10);
  doc.setFont("Amiri", "bold");
  doc.setFontSize(9.5);
  rtlText(doc, label, RIGHT_X, y, { color: INK });
  y += 5;
  doc.setFont("Amiri", "normal");
  doc.setFontSize(9.5);
  y = drawParagraph(doc, text, y, { lineHeight: 4.6, color: SLATE });
  return y + 3;
}

/**
 * Lays out the CV as real, selectable text in ATS-friendly reading order:
 * personal info, summary, experience, education, skills, certifications,
 * languages — single column, plain section headings, no tables/text boxes.
 */
export function buildCvPdf(doc, { form, experiences, education, techSkills, softSkills, splitLines, splitList }) {
  let y = MARGIN + 4;

  doc.setFont("Amiri", "bold");
  doc.setFontSize(20);
  rtlText(doc, form.name || "الاسم الكامل", RIGHT_X, y, { color: INK });
  y += 7;

  if (form.targetRole) {
    doc.setFont("Amiri", "bold");
    doc.setFontSize(12);
    rtlText(doc, form.targetRole, RIGHT_X, y, { color: BRASS });
    y += 6;
  }

  const contactParts = [form.email, form.phone, form.city].filter(Boolean);
  if (contactParts.length) {
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9);
    rtlText(doc, contactParts.join("   |   "), RIGHT_X, y, { color: SLATE });
    y += 6;
  }

  doc.setDrawColor(INK);
  doc.setLineWidth(0.6);
  doc.line(LEFT_X, y, RIGHT_X, y);
  y += 9;

  if (form.summary) {
    y = sectionTitle(doc, "الملخص المهني", y);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(10);
    y = drawParagraph(doc, form.summary, y, { lineHeight: 5.2, color: SLATE });
    y += 4;
  }

  const exps = experiences.filter((x) => x.title || x.employer);
  if (exps.length) {
    y = sectionTitle(doc, "الخبرات العملية", y);
    exps.forEach((x) => {
      y = ensureRoom(doc, y, 7);
      doc.setFont("Amiri", "bold");
      doc.setFontSize(10.5);
      rtlText(doc, x.employer ? `${x.title} — ${x.employer}` : x.title, RIGHT_X, y, { color: INK });
      if (x.period) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        ltrText(doc, x.period, LEFT_X, y, { color: SLATE });
      }
      y += 5.5;

      if (x.bullets) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9.5);
        splitLines(x.bullets).forEach((b) => {
          y = bulletParagraph(doc, b, y, { lineHeight: 4.8, color: SLATE });
        });
      }
      y += 3;
    });
    y += 2;
  }

  const edus = education.filter((x) => x.degree || x.school);
  if (edus.length) {
    y = sectionTitle(doc, "التعليم", y);
    edus.forEach((x) => {
      y = ensureRoom(doc, y, 6);
      doc.setFont("Amiri", "bold");
      doc.setFontSize(10);
      rtlText(doc, x.school ? `${x.degree} — ${x.school}` : x.degree, RIGHT_X, y, { color: INK });
      if (x.year) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        ltrText(doc, x.year, LEFT_X, y, { color: SLATE });
      }
      y += 5;

      if (x.detail) {
        doc.setFont("Amiri", "normal");
        doc.setFontSize(9);
        y = drawParagraph(doc, x.detail, y, { lineHeight: 4.5, color: SLATE });
      }
      y += 3;
    });
    y += 2;
  }

  if (techSkills || softSkills) {
    y = sectionTitle(doc, "المهارات", y);
    if (techSkills) y = labeledParagraph(doc, "المهارات التقنية:", splitList(techSkills).join("، "), y);
    if (softSkills) y = labeledParagraph(doc, "المهارات المهنية:", splitList(softSkills).join("، "), y);
    y += 1;
  }

  if (form.certs) {
    y = sectionTitle(doc, "الشهادات والدورات", y);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9.5);
    splitLines(form.certs).forEach((c) => {
      y = bulletParagraph(doc, c, y, { lineHeight: 4.8, color: SLATE });
    });
    y += 2;
  }

  if (form.languages) {
    y = sectionTitle(doc, "اللغات", y);
    doc.setFont("Amiri", "normal");
    doc.setFontSize(9.5);
    drawParagraph(doc, form.languages, y, { lineHeight: 4.8, color: SLATE });
  }
}
