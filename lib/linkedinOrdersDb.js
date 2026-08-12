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
  console.log(`[linkedin-notify] linkedin_orders id=${created.id} created for order #${sallaOrderNumber} — resolving LinkedIn-staff recipients...`);

  const { status, emails } = await notifyLinkedinStaff({
    logTag: `order #${sallaOrderNumber}`,
    applicantName,
    sallaOrderNumber,
    city: null,
    phone: applicantPhone,
    requestedPackage,
    createdAt: created.created_at,
  });

  const sql = getSql();
  const [updated] = await sql`
    UPDATE linkedin_orders
    SET notification_status = ${status}, notified_email = ${emails.join(", ") || null}, notified_at = now()
    WHERE id = ${created.id}
    RETURNING id, salla_order_number, applicant_name, applicant_phone, requested_package, status, generation_source, created_by, created_at, notification_status, notified_email, notified_at
  `;

  return updated || created;
}

/**
 * Resolves active LinkedIn-staff recipients and attempts the email to each
 * one independently, logging every step so a missing/failed notification
 * is always traceable in server logs (not just visually absent). Shared by
 * createLinkedinOrderAndNotify above and lib/cvArchive.js's Integrated-code
 * path, so both compute/log status identically.
 */
export async function notifyLinkedinStaff({ logTag, applicantName, sallaOrderNumber, city, phone, requestedPackage, createdAt }) {
  try {
    const recipients = await resolveNotificationRecipients("linkedin");
    console.log(`[linkedin-notify] ${logTag}: resolved ${recipients.length} active linkedin-staff recipient(s):`, recipients);

    if (!recipients.length) {
      console.warn(`[linkedin-notify] ${logTag}: no active 'linkedin'-type staff account has an email set — nothing to send.`);
      return { status: "no_recipient", emails: [] };
    }

    const succeeded = [];
    for (const to of recipients) {
      try {
        console.log(`[linkedin-notify] ${logTag}: sending to ${to}...`);
        await sendLinkedinNotification({ to, applicantName, sallaOrderNumber, city, phone, requestedPackage, createdAt });
        console.log(`[linkedin-notify] ${logTag}: Resend accepted the send to ${to}.`);
        succeeded.push(to);
      } catch (err) {
        console.error(`[linkedin-notify] ${logTag}: Resend send to ${to} FAILED:`, err.message || err);
      }
    }

    return { status: succeeded.length ? "sent" : "failed", emails: succeeded.length ? succeeded : recipients };
  } catch (err) {
    console.error(`[linkedin-notify] ${logTag}: unexpected error resolving/sending recipients (non-fatal):`, err);
    return { status: "failed", emails: [] };
  }
}
