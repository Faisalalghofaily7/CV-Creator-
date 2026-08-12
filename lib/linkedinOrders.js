// Pure constants + helpers for the LinkedIn-work status track — shared by
// both server routes (validation) and the admin UI (labels/colors), so no
// DB or server-only imports here, safe to import from either side (see
// lib/lifecycleStatus.js / lib/staffAccounts.js for the same pattern).
// The actual DB reads/writes live in lib/linkedinOrdersDb.js instead —
// keeping them out of this file is what lets components/AdminCodes.jsx
// import these constants without pulling `pg` into the client bundle.
//
// This track is kept separate from lib/lifecycleStatus.js on purpose: it
// applies to two different kinds of record (a standalone linkedin_orders
// row, or the LinkedIn portion of an Integrated-package access_codes row
// via its linkedin_status column) and progresses independently of the
// CV-sending lifecycle_status.

export const LINKEDIN_ORDER_STATUSES = ["awaiting_processing", "in_progress", "on_hold", "done"];

export const LINKEDIN_ORDER_STATUS_LABELS = {
  awaiting_processing: "بانتظار المعالجة",
  in_progress: "قيد التنفيذ",
  on_hold: "معلّق",
  done: "تم الإنجاز",
};

export const LINKEDIN_ORDER_STATUS_COLORS = {
  awaiting_processing: { bg: "#fef3c7", fg: "#92400e" },
  in_progress: { bg: "#fff3cd", fg: "#8a6100" },
  on_hold: { bg: "#f8d7da", fg: "#842029" },
  done: { bg: "#d4edda", fg: "#155724" },
};

export function isValidLinkedinOrderStatus(value) {
  return LINKEDIN_ORDER_STATUSES.includes(value);
}

// The merged LinkedIn panel (see app/api/admin/linkedin-orders) exposes a
// composite id like "lo-5" (linkedin_orders.id) or "cv-12"
// (access_codes.id) so the client never needs to know which of the two
// tables a given row actually lives in — this parses that id back apart
// for the PATCH/history routes. Returns null on anything malformed.
export function parseCompositeOrderId(compositeId) {
  const match = /^(lo|cv)-(\d+)$/.exec(String(compositeId || ""));
  if (!match) return null;
  return { sourceType: match[1] === "lo" ? "linkedin_only" : "integrated_cv", id: Number(match[2]) };
}
