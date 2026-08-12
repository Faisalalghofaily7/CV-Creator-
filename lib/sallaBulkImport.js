import ExcelJS from "exceljs";
import { PACKAGE_INTEGRATED, PACKAGE_CV_ENGLISH, PACKAGE_CV_ARABIC, PACKAGE_LINKEDIN } from "./staffAccounts";

// Defensive cap — a real Salla orders export never comes close to this; it
// just bounds how much work one upload can trigger.
const MAX_ROWS = 5000;

// Exact Arabic header text expected in row 1, matched by name (not column
// position) so the admin can export with columns in any order.
const HEADERS = {
  name: "اسم العميل",
  phone: "رقم الجوال",
  order: "رقم الطلب",
  status: "حالة الطلب",
  product: "اسماء المنتجات مع SKU",
};

// The one order status this import acts on. Salla's Arabic status labels
// can vary slightly in spelling (e.g. the hamza on "بإنتظار" vs "بانتظار")
// and in whitespace between exports, so status text is normalized on both
// sides before comparing rather than matched verbatim.
const TARGET_STATUS_LABEL = "بإنتظار المراجعة";

// Arabic diacritics (tashkeel) block, by codepoint rather than literal
// characters embedded in the regex, to avoid any ambiguity about which
// combining marks are actually being matched.
const ARABIC_DIACRITICS_RE = /[ً-ٰٟۖ-ۭ]/g;
const ALEF_VARIANTS_RE = /[آأإٱ]/g; // آ أ إ ٱ -> ا
const TA_MARBUTA_RE = /ة/g; // ة -> ه

const ALEF_MAKSURA_RE = /ى/g; // ى -> ي

export function normalizeArabicText(s) {
  return String(s ?? "")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(ALEF_VARIANTS_RE, "ا") // ا
    .replace(TA_MARBUTA_RE, "ه") // ه
    .replace(ALEF_MAKSURA_RE, "ي") // ي
    .replace(/\s+/g, " ")
    .trim();
}

export function isTargetStatus(statusText) {
  return normalizeArabicText(statusText) === normalizeArabicText(TARGET_STATUS_LABEL);
}

// Strips Salla's raw product-cell wrapper noise — "(SKU: ...)", "(Qty:
// ...)" (matched with any content inside, since a future export might
// carry a real SKU code rather than an empty one), surrounding straight
// quotes, and extra whitespace — down to just the meaningful product-name
// text.
export function extractProductName(raw) {
  return String(raw ?? "")
    .replace(/\(\s*SKU\s*:[^)]*\)/gi, " ")
    .replace(/\(\s*Qty\s*:[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

// Approach A: ordered keyword rules against the normalized product name.
// Order matters — each rule only applies if none of the earlier ones
// matched. Arabic letter variants (alef, ta marbuta, alef maksura) and
// repeated whitespace are normalized identically on the product text and
// every keyword literal below (via normalizeArabicText), so differently
// spelled real-world exports still match; Latin text is matched
// case-insensitively via .toLowerCase().
function norm(s) {
  return normalizeArabicText(s).toLowerCase();
}

const KW_INTEGRATED = norm("متكامل");
const KW_LINKEDIN = norm("لينكد"); // matches لينكد ان / لينكدان / لينكدإن alike — all share this prefix
const KW_LINKEDIN_LATIN = "linkedin";
const KW_CV = norm("سيرة");
const KW_COVER = "cover"; // catches both "cover" and "cover letter"
const KW_ENGLISH_1 = norm("الإنجليزية");
const KW_ENGLISH_2 = norm("انجليزي");
const KW_ENGLISH_LATIN = "english";
const KW_ARABIC_1 = norm("العربية");
const KW_ARABIC_2 = norm("عربي");
const KW_ARABIC_LATIN = "arabic";

/**
 * Classifies a raw (or already-cleaned) product-name string into one of
 * the four canonical package labels (see lib/staffAccounts.js), or null
 * if none of the keyword rules match — callers must treat null as "needs
 * human review", never guess or silently drop the row.
 */
export function classifyPackage(productText) {
  const text = norm(extractProductName(productText));
  if (!text) return null;

  const hasIntegratedWord = text.includes(KW_INTEGRATED);
  const hasLinkedinKw = text.includes(KW_LINKEDIN) || text.includes(KW_LINKEDIN_LATIN);
  const hasCvKw = text.includes(KW_CV);
  const hasCoverLetter = text.includes(KW_COVER);

  // 1. Integrated: explicit "متكامل", or a LinkedIn + CV keyword together
  //    (an order that mentions both services), or a cover-letter mention.
  if (hasIntegratedWord || (hasLinkedinKw && hasCvKw) || hasCoverLetter) {
    return PACKAGE_INTEGRATED;
  }

  // 2. LinkedIn-only: a LinkedIn keyword with no CV/Integrated indicator.
  if (hasLinkedinKw && !hasCvKw && !hasIntegratedWord) {
    return PACKAGE_LINKEDIN;
  }

  // 3. CV English.
  const hasEnglishKw = text.includes(KW_ENGLISH_1) || text.includes(KW_ENGLISH_2) || text.includes(KW_ENGLISH_LATIN);
  if (hasEnglishKw) {
    return PACKAGE_CV_ENGLISH;
  }

  // 4. CV Arabic — explicit Arabic-language keyword, or a bare CV mention
  //    with no other language/service indicator (default CV to Arabic).
  const hasArabicKw = text.includes(KW_ARABIC_1) || text.includes(KW_ARABIC_2) || text.includes(KW_ARABIC_LATIN);
  if (hasArabicKw || hasCvKw) {
    return PACKAGE_CV_ARABIC;
  }

  // 5. Unrecognized — never guessed, always flagged for manual review.
  return null;
}

class BulkImportError extends Error {}

function cellText(row, colNumber) {
  if (!colNumber) return "";
  const value = row.getCell(colNumber).value;
  if (value == null) return "";
  if (typeof value === "object") {
    // Rich text (`{ richText: [...] }`) and formula results (`{ result }`)
    // both carry the display text one level deeper than the raw value.
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("").trim();
    if (value.result != null) return String(value.result).trim();
    if (value.text != null) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

/**
 * Parses a Salla orders export into row objects, matched by Arabic header
 * name. Throws BulkImportError (safe to show to the admin) on a malformed
 * file, an empty sheet, or missing required columns.
 */
export async function parseSallaOrdersWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new BulkImportError("الملف غير صالح أو تالف. تأكد من أنه ملف Excel (.xlsx) سليم.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new BulkImportError("الملف فارغ.");
  }

  const headerRow = sheet.getRow(1);
  const headerCol = {};
  headerRow.eachCell((cell, colNumber) => {
    const text = String(cell.value ?? "").trim();
    if (text) headerCol[text] = colNumber;
  });

  const missing = Object.values(HEADERS).filter((h) => !headerCol[h]);
  if (missing.length) {
    throw new BulkImportError(`الأعمدة التالية مفقودة في الملف: ${missing.join("، ")}. تأكد من مطابقة أسماء الأعمدة تماماً.`);
  }

  if (sheet.rowCount - 1 > MAX_ROWS) {
    throw new BulkImportError(`عدد الصفوف كبير جداً (الحد الأقصى ${MAX_ROWS} صف). قسّم الملف وارفعه على دفعات.`);
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellText(row, headerCol[HEADERS.name]);
    const phone = cellText(row, headerCol[HEADERS.phone]);
    const order = cellText(row, headerCol[HEADERS.order]);
    const status = cellText(row, headerCol[HEADERS.status]);
    const rawProduct = cellText(row, headerCol[HEADERS.product]);
    // Skip fully-blank rows (common trailing rows in Excel exports) — they
    // don't count as processed data at all.
    if (!name && !phone && !order && !status && !rawProduct) return;
    rows.push({ name, phone, order, status, rawProduct });
  });

  if (!rows.length) {
    throw new BulkImportError("لا توجد بيانات في الملف بعد صف العناوين.");
  }

  return rows;
}

export { BulkImportError, TARGET_STATUS_LABEL };
