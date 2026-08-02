import bidiFactory from "bidi-js";
import { shapeArabic, REVERSE_SHAPE_MAP } from "./arabicShape";

const bidi = bidiFactory();

async function fetchFontBase64(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Loads and embeds the Amiri regular + bold fonts into a jsPDF document. */
export async function embedArabicFonts(doc) {
  const [regular, bold] = await Promise.all([
    fetchFontBase64("/fonts/Amiri-Regular.ttf"),
    fetchFontBase64("/fonts/Amiri-Bold.ttf"),
  ]);
  doc.addFileToVFS("Amiri-Regular.ttf", regular);
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.addFileToVFS("Amiri-Bold.ttf", bold);
  doc.addFont("Amiri-Bold.ttf", "Amiri", "bold");
}

function toVisualArabic(text) {
  const shaped = shapeArabic(text);
  const levels = bidi.getEmbeddingLevels(shaped);
  return bidi.getReorderedString(shaped, levels);
}

function hexColor(doc, hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [r, g, b].map((v) => v.toFixed(3)).join(" ");
}

/**
 * Draws `chars` (already in the exact order they should appear in the PDF
 * content stream) as raw glyph-showing operators, writing straight to the
 * content stream via doc.internal.write — bypassing doc.text()'s public
 * pipeline entirely. That pipeline auto-runs jsPDF's built-in Arabic
 * shaper + bidi engine on every call (with mutable, call-history-dependent
 * internal state), which repeatedly, unpredictably re-reordered text we
 * had already shaped/positioned ourselves. Going straight to glyph IDs
 * sidesteps that behavior for good, and lets us set each glyph's
 * ToUnicode entry directly, in one step, to whatever character it should
 * extract/search/copy as — no separate shape-then-unshape fixup pass needed.
 *
 * `unicodeFor(char, index)` returns the ToUnicode target for that drawn
 * character (its own code, or the original letter it stands in for).
 */
function drawGlyphRun(doc, chars, unicodeFor, x, y, { color, invisible } = {}) {
  if (!chars.length) return;
  const font = doc.internal.getFont();
  const metadata = font.metadata;
  const widths = metadata.Unicode.widths;

  let hex = "";
  for (let i = 0; i < chars.length; i++) {
    const charCode = chars.charCodeAt(i);
    const glyphId = metadata.characterToGlyph(charCode);
    metadata.glyIdsUsed.push(glyphId);
    metadata.toUnicode[glyphId] = unicodeFor(chars[i], i);
    if (widths.indexOf(glyphId) === -1) {
      widths.push(glyphId);
      widths.push([parseInt(metadata.widthOfGlyph(glyphId), 10)]);
    }
    hex += ("0000" + glyphId.toString(16)).slice(-4);
  }

  const xStr = doc.internal.getCoordinateString(x);
  const yStr = doc.internal.getVerticalCoordinateString(y);
  const fontSize = doc.internal.getFontSize();

  let out = "BT\n";
  out += "/" + font.id + " " + fontSize + " Tf\n";
  if (color) out += hexColor(doc, color) + " rg\n";
  // Tr (render mode) is a persistent text-state parameter that carries
  // across BT/ET blocks — always set it explicitly, or an invisible draw
  // leaks forward and silently blanks every visible draw that follows it.
  out += (invisible ? "3" : "0") + " Tr\n";
  out += xStr + " " + yStr + " Td\n";
  out += "<" + hex + "> Tj\n";
  out += "ET";
  doc.internal.write(out);
}

/**
 * Draws `text` right-aligned to `rightX` with correctly joined, RTL-laid-out
 * Arabic for human reading, PLUS an invisible duplicate (plain, unshaped,
 * left-to-right glyph order matching the original logical string) at the
 * same spot — an OCR-style invisible text layer. Extractors reconstruct
 * text from glyph positions; the invisible layer's glyphs are laid out in
 * simple ascending-x / logical order, so any position-based extractor
 * (virtually all of them, including ATS parsers) recovers the exact
 * original string, while a human only ever sees the shaped, right-aligned
 * visible layer on top.
 */
export function rtlText(doc, text, rightX, y, { color } = {}) {
  if (!text) return;
  const visual = toVisualArabic(text);
  const visualUnicode = (ch) => REVERSE_SHAPE_MAP.get(ch.charCodeAt(0)) ?? ch.charCodeAt(0);
  const width = doc.getTextWidth(visual);
  drawGlyphRun(doc, visual, visualUnicode, rightX - width, y, { color });

  const identityUnicode = (ch) => ch.charCodeAt(0);
  drawGlyphRun(doc, text, identityUnicode, rightX - width, y, { color, invisible: true });
}

/** Word-wraps `text` to `maxWidth` (current font/size) and draws each line right-aligned, returning the new cursor Y. */
export function rtlParagraph(doc, text, rightX, y, maxWidth, lineHeight, opts) {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, maxWidth);
  lines.forEach((line, i) => rtlText(doc, line, rightX, y + i * lineHeight, opts));
  return y + lines.length * lineHeight;
}

/** Draws plain left-to-right text (numbers, dates) at `x`, bypassing jsPDF's text() pipeline for consistency. */
export function ltrText(doc, text, x, y, { color } = {}) {
  if (!text) return;
  drawGlyphRun(doc, text, (ch) => ch.charCodeAt(0), x, y, { color });
}
