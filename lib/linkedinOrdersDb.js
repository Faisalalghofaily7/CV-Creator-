// Server-only DB access for the LinkedIn-work track. Never import this
// from a "use client" component — see lib/linkedinOrders.js for the
// client-safe constants/labels/composite-id parsing instead.
import { getSql } from "./db";
import { sendLinkedinNotification } from "./email";
import { resolveNotificationRecipients } from "./staffNotifications";

/**
 * Inserts a standalone LinkedIn-only order (no CV, no access code) —
 * mirrors lib/accessCodes.js's createAccessCode shape/conventions so both
 * "creation paths" a bulk-upload row can take read the same way at the
 * call site.
 */
export async function createLinkedinOrder({
  sallaOrderNumber,
  applicantName = null,
  applicantPhone = null,
  requestedPackage = null,
  generationSource = "unknown",
  createdBy = null,
} = {}) {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO linkedin_orders (salla_order_number, applicant_name, applicant_phone, requested_package, generation_source, created_by)
    VALUES (${sallaOrderNumber}, ${applicantName}, ${applicantPhone}, ${requestedPackage}, ${generationSource}, ${createdBy})
    RETURNING id, salla_order_number, applicant_name, applicant_phone, requested_package, status, generation_source, created_by, created_at
  `;
  return row;
}

/**
 * Dedup check spanning BOTH tables a Salla order number could already
 * exist in — "one Salla order number = one record ever" applies across
 * CV/Integrated codes and standalone LinkedIn-only orders alike, so a
 * bulk-upload row must never create a second record of either kind for an
 * order it already processed.
 */
export async function sallaOrderNumberExists(sallaOrderNumber) {
  if (!sallaOrderNumber) return false;
  const sql = getSql();
  const [inCodes] = await sql`SELECT 1 FROM access_codes WHERE salla_order_number = ${sallaOrderNumber} LIMIT 1`;
  if (inCodes) return true;
  const [inLinkedin] = await sql`SELECT 1 FROM linkedin_orders WHERE salla_order_number = ${sallaOrderNumber} LIMIT 1`;
  return !!inLinkedin;
}

/**
 * Appends one row to the shared LinkedIn-track timeline — exactly one of
 * accessCodeId/linkedinOrderId should be given, matching the table the
 * status change actually happened on (see the CHECK constraint on
 * linkedin_status_history in scripts/schema.sql).
 */
export async function logLinkedinStatusChange({ accessCodeId = null, linkedinOrderId = null, status, changedBy = null }) {
  const sql = getSql();
  await sql`
    INSERT INTO linkedin_status_history (access_code_id, linkedin_order_id, status, changed_by)
    VALUES (${accessCodeId}, ${linkedinOrderId}, ${status}, ${changedBy})
  `;
}

/**
 * The single "create a standalone LinkedIn-only order" path — creates the
 * row, logs its initial status, and emails active LinkedIn-staff accounts,
 * all in one place so every caller (manual admin creation, Excel bulk
 * upload) gets identical behavior with nothing duplicated. This is
 * deliberately the ONLY place that emails on LinkedIn-order creation —
 * the Integrated package's LinkedIn portion is a different record (an
 * access_codes row's linkedin_status column, never a linkedin_orders row)
 * and is already emailed separately by lib/cvArchive.js at CV-generation
 * time, so calling this function only for genuine standalone LinkedIn-only
 * orders is what keeps Integrated from ever being notified twice.
 *
 * The email is best-effort: a Resend failure (or no active LinkedIn staff
 * with an email configured) is logged and never thrown, so it can never
 * fail the order creation itself.
 */
export async function createLinkedinOrderAndNotify({
  sallaOrderNumber,
  applicantName = null,
  applicantPhone = null,
  requestedPackage = null,
  generationSource = "unknown",
  createdBy = null,
} = {}) {
  const created = await createLinkedinOrder({ sallaOrderNumber, applicantName, applicantPhone, requestedPackage, generationSource, createdBy });
  await logLinkedinStatusChange({ linkedinOrderId: created.id, status: created.status, changedBy: createdBy });

  try {
    const recipients = await resolveNotificationRecipients("linkedin");
    if (!recipients.length) {
      console.warn(`No active LinkedIn-staff notification email configured — skipping LinkedIn notification for order "${sallaOrderNumber}".`);
    }
    for (const to of recipients) {
      try {
        await sendLinkedinNotification({
          to,
          applicantName,
          sallaOrderNumber,
          city: null,
          phone: applicantPhone,
          requestedPackage,
          createdAt: created.created_at,
        });
      } catch (err) {
        console.error(`LinkedIn-staff notification email to ${to} failed (non-fatal, LinkedIn order already created):`, err);
      }
    }
  } catch (err) {
    console.error("Failed to resolve/send LinkedIn-order notification (non-fatal, LinkedIn order already created):", err);
  }

  return created;
}
