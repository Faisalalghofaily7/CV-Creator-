// Shared between server routes and the admin UI — no DB/server-only imports.
// Tracks HOW an access code was created, and lets the UI render a clear
// "who made this" label without duplicating the mapping logic everywhere.

export const GENERATION_SOURCES = ["manual", "bulk_excel", "salla_webhook", "unknown"];

export const GENERATION_SOURCE_LABELS = {
  manual: "يدوي",
  bulk_excel: "ملف Excel",
  salla_webhook: "سلة (Webhook)",
  unknown: "غير محدد",
};

export const GENERATION_SOURCE_COLORS = {
  manual: { bg: "#e8eef4", fg: "#1a3a5c" },
  bulk_excel: { bg: "#e0f2e9", fg: "#0f5132" },
  salla_webhook: { bg: "#ede9fe", fg: "#5b21b6" },
  unknown: { bg: "#f1f1f1", fg: "#5a5a5a" },
};

// Codes created by a human (manual form / bulk Excel upload) show that
// person's username; webhook/automated codes never had a human involved, so
// showing a username there would be misleading — same for legacy records
// that predate this tracking, which get "unknown" source and no creator.
export function creatorLabel({ generation_source, created_by } = {}) {
  if (generation_source === "salla_webhook") return "تلقائي / النظام";
  return created_by || "غير معروف";
}
