// Admin-only notification email, fired on every order status change on
// EITHER track (CV-sending and LinkedIn), at any stage. This is additive
// to — and completely independent of — the existing per-track staff
// notifications (lib/staffNotifications.js resolves those from active
// staff_accounts rows); this module always targets one fixed admin
// address instead, and every call site below fires both, never merging
// or replacing either.
//
// Never throws. A failed/misconfigured admin notification (missing env
// var, bad Resend key, network error, ...) must never block the status
// change that triggered it, so every failure here is caught and logged,
// never re-thrown — callers can call notifyAdminStatusChange without any
// try/catch of their own.
import { LIFECYCLE_STATUS_LABELS, LIFECYCLE_STATUSES } from "./lifecycleStatus";
import { LINKEDIN_ORDER_STATUS_LABELS, LINKEDIN_ORDER_STATUSES } from "./linkedinOrders";
import { sendAdminStatusChangeNotification } from "./email";

// Single kill switch: set ADMIN_STATUS_EMAILS_ENABLED=false in Vercel to
// silence every admin status-change email instantly, no code change or
// redeploy of anything else needed. Defaults on (any other value, or
// unset, leaves it enabled).
const ENABLED = process.env.ADMIN_STATUS_EMAILS_ENABLED !== "false";

// The ONE place to narrow which stages actually email the admin — remove
// an entry from either set below to stop notifying on it (e.g. drop
// 'customer_in_progress' from NOTIFY_ON_LIFECYCLE_STATUSES to stop
// emailing on customer redemption) without touching any call site. Starts
// covering every stage on both tracks, matching "at ANY stage" as asked.
const NOTIFY_ON_LIFECYCLE_STATUSES = new Set(LIFECYCLE_STATUSES);
const NOTIFY_ON_LINKEDIN_STATUSES = new Set(LINKEDIN_ORDER_STATUSES);

const TRACK_LABELS = { sending: "مسار إرسال السيرة الذاتية", linkedin: "مسار لينكدإن" };

/**
 * Best-effort admin notification for a single status change on one track.
 * Every argument beyond track/newStatus is optional — call sites pass
 * whatever they already have on hand from the change they just made;
 * nothing here requires an extra DB round trip to work. `changedBy` is the
 * acting staff/admin username, or omitted/null for an automatic (system)
 * transition — rendered as "تلقائي / النظام" either way. `oldStatus` is
 * omitted/null for the very first stage on a track (e.g. a LinkedIn
 * track's initial 'awaiting_processing', which has no prior status).
 */
export async function notifyAdminStatusChange({
  track,
  code = null,
  sallaOrderNumber = null,
  applicantName = null,
  requestedPackage = null,
  oldStatus = null,
  newStatus,
  changedBy = null,
}) {
  try {
    if (!ENABLED) return;

    const to = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!to) {
      console.warn("[admin-status-notify] ADMIN_NOTIFICATION_EMAIL is not set — skipping admin status-change notification.");
      return;
    }

    const notifyStatuses = track === "linkedin" ? NOTIFY_ON_LINKEDIN_STATUSES : NOTIFY_ON_LIFECYCLE_STATUSES;
    if (!notifyStatuses.has(newStatus)) return;

    const labels = track === "linkedin" ? LINKEDIN_ORDER_STATUS_LABELS : LIFECYCLE_STATUS_LABELS;

    await sendAdminStatusChangeNotification({
      to,
      trackLabel: TRACK_LABELS[track] || track,
      applicantName,
      code,
      sallaOrderNumber,
      requestedPackage,
      oldStatusLabel: oldStatus ? labels[oldStatus] || oldStatus : null,
      newStatusLabel: labels[newStatus] || newStatus,
      changedByLabel: changedBy || "تلقائي / النظام",
      changedAt: new Date(),
    });
  } catch (err) {
    console.error("[admin-status-notify] failed to send admin status-change notification (non-fatal):", err);
  }
}
