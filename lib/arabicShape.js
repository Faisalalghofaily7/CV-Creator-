/**
 * Minimal Arabic contextual shaper (isolated/initial/medial/final forms),
 * WITHOUT ligature merging (e.g. no Lam-Alef combining), so shaped output
 * always has the same length as the input — a strict 1:1 codepoint
 * correspondence. That lets us build a static REVERSE map (shaped
 * presentation-form codepoint -> original base codepoint) and use it to
 * patch jsPDF's ToUnicode CMap after drawing, so extracted/copied/searched
 * text is the real logical Arabic, not the shaped glyph forms.
 */

// [base, isolated, initial, medial, final]
const SHAPE_TABLE = [
  [0x0621, 0xfe80, null, null, null],
  [0x0622, 0xfe81, null, null, 0xfe82],
  [0x0623, 0xfe83, null, null, 0xfe84],
  [0x0624, 0xfe85, null, null, 0xfe86],
  [0x0625, 0xfe87, null, null, 0xfe88],
  [0x0626, 0xfe89, 0xfe8b, 0xfe8c, 0xfe8a],
  [0x0627, 0xfe8d, null, null, 0xfe8e],
  [0x0628, 0xfe8f, 0xfe91, 0xfe92, 0xfe90],
  [0x0629, 0xfe93, null, null, 0xfe94],
  [0x062a, 0xfe95, 0xfe97, 0xfe98, 0xfe96],
  [0x062b, 0xfe99, 0xfe9b, 0xfe9c, 0xfe9a],
  [0x062c, 0xfe9d, 0xfe9f, 0xfea0, 0xfe9e],
  [0x062d, 0xfea1, 0xfea3, 0xfea4, 0xfea2],
  [0x062e, 0xfea5, 0xfea7, 0xfea8, 0xfea6],
  [0x062f, 0xfea9, null, null, 0xfeaa],
  [0x0630, 0xfeab, null, null, 0xfeac],
  [0x0631, 0xfead, null, null, 0xfeae],
  [0x0632, 0xfeaf, null, null, 0xfeb0],
  [0x0633, 0xfeb1, 0xfeb3, 0xfeb4, 0xfeb2],
  [0x0634, 0xfeb5, 0xfeb7, 0xfeb8, 0xfeb6],
  [0x0635, 0xfeb9, 0xfebb, 0xfebc, 0xfeba],
  [0x0636, 0xfebd, 0xfebf, 0xfec0, 0xfebe],
  [0x0637, 0xfec1, 0xfec3, 0xfec4, 0xfec2],
  [0x0638, 0xfec5, 0xfec7, 0xfec8, 0xfec6],
  [0x0639, 0xfec9, 0xfecb, 0xfecc, 0xfeca],
  [0x063a, 0xfecd, 0xfecf, 0xfed0, 0xfece],
  [0x0640, 0x0640, 0x0640, 0x0640, 0x0640],
  [0x0641, 0xfed1, 0xfed3, 0xfed4, 0xfed2],
  [0x0642, 0xfed5, 0xfed7, 0xfed8, 0xfed6],
  [0x0643, 0xfed9, 0xfedb, 0xfedc, 0xfeda],
  [0x0644, 0xfedd, 0xfedf, 0xfee0, 0xfede],
  [0x0645, 0xfee1, 0xfee3, 0xfee4, 0xfee2],
  [0x0646, 0xfee5, 0xfee7, 0xfee8, 0xfee6],
  [0x0647, 0xfee9, 0xfeeb, 0xfeec, 0xfeea],
  [0x0648, 0xfeed, null, null, 0xfeee],
  [0x0649, 0xfeef, null, null, 0xfef0],
  [0x064a, 0xfef1, 0xfef3, 0xfef4, 0xfef2],
  [0x067e, 0xfb56, 0xfb58, 0xfb59, 0xfb57],
  [0x06cc, 0xfbfc, 0xfbfe, 0xfbff, 0xfbfd],
  [0x0686, 0xfb7a, 0xfb7c, 0xfb7d, 0xfb7b],
  [0x06a9, 0xfb8e, 0xfb90, 0xfb91, 0xfb8f],
  [0x06af, 0xfb92, 0xfb94, 0xfb95, 0xfb93],
  [0x0698, 0xfb8a, null, null, 0xfb8b],
];

const TRANSPARENT = new Set([
  0x0610, 0x0612, 0x0613, 0x0614, 0x0615, 0x064b, 0x064c, 0x064d, 0x064e,
  0x064f, 0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655, 0x0656, 0x0657,
  0x0658, 0x0670, 0x06d6, 0x06d7, 0x06d8, 0x06d9, 0x06da, 0x06db, 0x06dc,
  0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e3, 0x06e4, 0x06e7, 0x06e8, 0x06ea,
  0x06eb, 0x06ec, 0x06ed,
]);

const byBase = new Map(SHAPE_TABLE.map((row) => [row[0], row]));
// Reverse map: any presentation-form codepoint -> its original base codepoint.
const REVERSE_SHAPE_MAP = new Map();
for (const row of SHAPE_TABLE) {
  const [base, iso, init, med, fin] = row;
  for (const form of [iso, init, med, fin]) {
    if (form != null) REVERSE_SHAPE_MAP.set(form, base);
  }
}

function connectsForward(code) {
  const row = byBase.get(code);
  return !!(row && (row[2] != null || row[3] != null));
}
function connectsBackward(code) {
  const row = byBase.get(code);
  return !!(row && (row[3] != null || row[4] != null));
}

/** Shapes Arabic text into presentation forms, 1 input char -> 1 output char (no ligatures). */
export function shapeArabic(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const current = text.charCodeAt(i);
    const row = byBase.get(current);
    if (!row) {
      out += text[i];
      continue;
    }

    let prevID = i - 1;
    while (prevID >= 0 && TRANSPARENT.has(text.charCodeAt(prevID))) prevID--;
    let prev = prevID >= 0 ? text.charCodeAt(prevID) : null;
    if (prev != null && !connectsForward(prev)) prev = null;

    let nextID = i + 1;
    while (nextID < text.length && TRANSPARENT.has(text.charCodeAt(nextID))) nextID++;
    let next = nextID < text.length ? text.charCodeAt(nextID) : null;
    if (next != null && !connectsBackward(next)) next = null;

    const [, iso, init, med, fin] = row;
    if (prev != null && next != null && med != null) {
      out += String.fromCharCode(med);
    } else if (prev != null && fin != null) {
      out += String.fromCharCode(fin);
    } else if (next != null && init != null) {
      out += String.fromCharCode(init);
    } else {
      out += String.fromCharCode(iso);
    }
  }
  return out;
}

export { REVERSE_SHAPE_MAP };
