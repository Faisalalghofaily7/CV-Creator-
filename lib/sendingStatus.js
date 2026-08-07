// Shared between server routes (validation) and the admin UI (labels/colors)
// — no DB or server-only imports here, safe to import from either side.

export const SENDING_STATUSES = ["pending", "in_progress", "on_hold", "sent"];

export const SENDING_STATUS_LABELS = {
  pending: "بانتظار الإرسال",
  in_progress: "قيد التنفيذ",
  on_hold: "معلّق",
  sent: "تم الإرسال",
};

export const SENDING_STATUS_COLORS = {
  pending: { bg: "#e8eef4", fg: "#1a3a5c" },
  in_progress: { bg: "#fff3cd", fg: "#8a6100" },
  on_hold: { bg: "#f8d7da", fg: "#842029" },
  sent: { bg: "#d4edda", fg: "#155724" },
};

export function isValidSendingStatus(value) {
  return SENDING_STATUSES.includes(value);
}
