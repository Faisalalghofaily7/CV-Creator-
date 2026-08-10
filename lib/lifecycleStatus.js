// Shared between server routes (validation) and the admin UI (labels/colors)
// — no DB or server-only imports here, safe to import from either side.
//
// The unified code/order lifecycle. Stages 1-3 are set automatically by the
// system (code generation, customer redemption, successful PDF export);
// stages 4-6 are set manually by staff and never skip ahead of stage 3.

export const LIFECYCLE_STATUSES = [
  "available",
  "customer_in_progress",
  "awaiting_sending",
  "staff_processing",
  "on_hold",
  "sent",
];

// The subset staff can manually move a record between — the automatic
// early stages (available, customer_in_progress) are always system-driven.
export const MANUAL_LIFECYCLE_STATUSES = ["awaiting_sending", "staff_processing", "on_hold", "sent"];

export const LIFECYCLE_STATUS_LABELS = {
  available: "متاح",
  customer_in_progress: "تحت الإجراء",
  awaiting_sending: "بانتظار الإرسال",
  staff_processing: "قيد التنفيذ",
  on_hold: "معلّق",
  sent: "تم الإرسال",
};

export const LIFECYCLE_STATUS_COLORS = {
  available: { bg: "#e8eef4", fg: "#1a3a5c" },
  customer_in_progress: { bg: "#e0e7ff", fg: "#3730a3" },
  awaiting_sending: { bg: "#fef3c7", fg: "#92400e" },
  staff_processing: { bg: "#fff3cd", fg: "#8a6100" },
  on_hold: { bg: "#f8d7da", fg: "#842029" },
  sent: { bg: "#d4edda", fg: "#155724" },
};

export function isValidLifecycleStatus(value) {
  return LIFECYCLE_STATUSES.includes(value);
}

export function isManualLifecycleStatus(value) {
  return MANUAL_LIFECYCLE_STATUSES.includes(value);
}
