// Admin-only code renewal, server-side only — never import from a "use
// client" component. app/api/admin/codes/[id]/renew/route.js already
// gates on requireRole: "admin" before reaching here.
import { getSql } from "./db";
import { resolveNotificationRecipients } from "./staffNotifications";
import { sendStaffRenewalNotification } from "./email";
import { packageNotifiesSending, packageNotifiesLinkedin } from "./staffAccounts";
import { notifyAdminStatusChange } from "./adminStatusNotifications";

/**
 * Resets a used code back to redeemable so the customer can build and
 * export a fresh CV from scratch, WITHOUT touching the existing archived
 * PDF or its link (pdf_url) — the old CV stays fully intact and
 * downloadable until the customer actually exports a new one, at which
 * point lib/cvArchive.js replaces it and clears the renewed_at flag set
 * here. Deliberately reuses the normal 'available' status (not a new
 * enum value) so the code re-enters the exact same redemption/consumption
 * path every other code already goes through — the only new state is the
 * renewed_at/renewed_by flag, read by the admin UI to show a "don't send
 * the old CV" banner on both the sending and (if applicable) LinkedIn
 * panels, and by lib/cvArchive.js to know a fresh CV should re-trigger the
 * normal "new CV archived" staff notifications even though pdf_url was
 * already set before this renewal.
 *
 * Returns { record } on success, or { error: "not_found" | "not_used" }.
 */
export async function renewAccessCode(id, renewedBy) {
  const sql = getSql();
  const [existing] = await sql`
    SELECT id, code, lifecycle_status, linkedin_status, applicant_name, salla_order_number, requested_package
    FROM access_codes WHERE id = ${id}
  `;
  if (!existing) return { error: "not_found" };
  if (existing.lifecycle_status === "available" || existing.lifecycle_status === "customer_in_progress") {
    return { error: "not_used" };
  }

  // An Integrated code's LinkedIn track is independent of the CV file
  // itself, but the customer redoing their CV from scratch means LinkedIn
  // staff should also treat it as needing fresh attention rather than
  // trusting whatever stage it was already at.
  const resetLinkedin = existing.linkedin_status !== null;

  const [updated] = resetLinkedin
    ? await sql`
        UPDATE access_codes
        SET status = 'available', used_at = NULL, lifecycle_status = 'available',
            renewed_at = now(), renewed_by = ${renewedBy}, linkedin_status = 'awaiting_processing'
        WHERE id = ${id}
        RETURNING id, code, lifecycle_status, linkedin_status, applicant_name, salla_order_number, requested_package, renewed_at, renewed_by
      `
    : await sql`
        UPDATE access_codes
        SET status = 'available', used_at = NULL, lifecycle_status = 'available',
            renewed_at = now(), renewed_by = ${renewedBy}
        WHERE id = ${id}
        RETURNING id, code, lifecycle_status, linkedin_status, applicant_name, salla_order_number, requested_package, renewed_at, renewed_by
      `;

  await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${id}, 'available', ${renewedBy})`;
  if (resetLinkedin) {
    await sql`INSERT INTO linkedin_status_history (access_code_id, status, changed_by) VALUES (${id}, 'awaiting_processing', ${renewedBy})`;
  }
  await sql`INSERT INTO renewal_log (access_code_id, renewed_by) VALUES (${id}, ${renewedBy})`;

  // Same fixed-admin-address notification every other lifecycle change
  // already triggers (lib/adminStatusNotifications.js) — never throws.
  await notifyAdminStatusChange({
    track: "sending",
    code: existing.code,
    sallaOrderNumber: existing.salla_order_number,
    applicantName: existing.applicant_name,
    requestedPackage: existing.requested_package,
    oldStatus: existing.lifecycle_status,
    newStatus: "available",
    changedBy: renewedBy,
  });
  if (resetLinkedin) {
    await notifyAdminStatusChange({
      track: "linkedin",
      code: existing.code,
      sallaOrderNumber: existing.salla_order_number,
      applicantName: existing.applicant_name,
      requestedPackage: existing.requested_package,
      oldStatus: existing.linkedin_status,
      newStatus: "awaiting_processing",
      changedBy: renewedBy,
    });
  }

  // The actual "don't send the old CV" warning to the staff who'd
  // otherwise send it — sending staff always (the sending track is always
  // affected by a renewal), LinkedIn staff too only if this package
  // involves that track and it was actually reset above.
  const staffTypes = [];
  if (packageNotifiesSending(existing.requested_package)) staffTypes.push("sending");
  if (resetLinkedin && packageNotifiesLinkedin(existing.requested_package)) staffTypes.push("linkedin");
  for (const staffType of staffTypes) {
    const recipients = await resolveNotificationRecipients(staffType, sql);
    for (const to of recipients) {
      try {
        await sendStaffRenewalNotification({
          to,
          applicantName: existing.applicant_name,
          code: existing.code,
          sallaOrderNumber: existing.salla_order_number,
        });
      } catch (err) {
        console.error(`Renewal notification email to ${to} failed (non-fatal, renewal already succeeded):`, err);
      }
    }
  }

  return { record: updated };
}
