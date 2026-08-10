import ExcelJS from "exceljs";

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

export function normalizeArabicText(s) {
  return String(s ?? "")
    .replace(ARABIC_DIACRITICS_RE, "")
    .replace(ALEF_VARIANTS_RE, "ا") // ا
    .replace(TA_MARBUTA_RE, "ه") // ه
    .replace(/\s+/g, " ")
    .trim();
}

export function isTargetStatus(statusText) {
  return normalizeArabicText(statusText) === normalizeArabicText(TARGET_STATUS_LABEL);
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
    // Skip fully-blank rows (common trailing rows in Excel exports) — they
    // don't count as processed data at all.
    if (!name && !phone && !order && !status) return;
    rows.push({ name, phone, order, status });
  });

  if (!rows.length) {
    throw new BulkImportError("لا توجد بيانات في الملف بعد صف العناوين.");
  }

  return rows;
}

export { BulkImportError, TARGET_STATUS_LABEL };
