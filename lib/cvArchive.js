import { put, del } from "@vercel/blob";
import { getSql } from "./db";
import { assertBlobConfigured } from "./blob";
import { sendStaffCvNotification } from "./email";
import { packageNotifiesSending, packageNotifiesLinkedin } from "./staffAccounts";
import { resolveNotificationRecipients } from "./staffNotifications";
import { notifyLinkedinStaff, logLinkedinStatusChange } from "./linkedinOrdersDb";
import { notifyAdminStatusChange } from "./adminStatusNotifications";

/**
 * Best-effort: uploads a generated CV PDF to the private Blob store and
 * links it to the access code that unlocked it. Never throws — archival is
 * secondary to the user getting their PDF, so any failure here is logged
 * and swallowed by the caller's perspective (the download must not fail
 * because of this).
 */
export async function archiveGeneratedPdf({ accessCode, pdfBuffer, applicantName, applicantEmail, applicantPhone, applicantCity, applicantTargetRole, applicantTargetCities, applicantInternalNotes, lang }) {
  if (!accessCode) {
    console.warn("Skipping CV archival: no accessCode was sent with this generate-pdf request.");
    return;
  }

  try {
    assertBlobConfigured();
    const sql = getSql();

    // Look up the previous archived blob (if any) so it can be cleaned up
    // after a successful re-generation, instead of leaking storage. Also
    // checks renewed_at — an admin-renewed code (lib/adminRenewal.js) keeps
    // its OLD pdf_url on purpose, so previousPathname alone can't tell a
    // genuine re-generation apart from a renewed code's first fresh CV;
    // wasRenewed makes that distinction below.
    const [existing] = await sql`SELECT pdf_url, renewed_at FROM access_codes WHERE code = ${accessCode}`;
    if (!existing) {
      console.warn(`Skipping CV archival: no access_codes row found for code "${accessCode}".`);
      return;
    }
    const previousPathname = existing.pdf_url || null;
    const wasRenewed = !!existing.renewed_at;

    const safeName = (applicantName || "cv")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics (e.g. "José" -> "Jose")
      .replace(/[^\w-]+/g, "_") // anything else (incl. Arabic script) -> "_"; this is just a storage path, not shown to users
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "cv";
    const pathname = `cvs/${accessCode}/${Date.now()}-${safeName}.pdf`;

    const blob = await put(pathname, pdfBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    // applicant_name, applicant_phone, and salla_order_number are the
    // order record's identity — set once from Salla at creation (manual
    // admin entry or the bulk-Excel import) and never touched again here.
    // Whatever name/phone the customer's uploaded-CV extraction (or manual
    // edits to the CV form) produced belongs only to the CV document, not
    // the order record, so it's deliberately excluded from this UPDATE.
    // renewed_at/renewed_by are cleared here too — this IS the "new PDF
    // replaces the old one" moment a pending renewal (see
    // lib/adminRenewal.js) was waiting for, so the admin UI's "don't send
    // the old CV" banner goes away exactly when it stops being true. A
    // no-op for every non-renewed code, since both are already NULL there.
    const [updated] = await sql`
      UPDATE access_codes
      SET pdf_url = ${blob.pathname}, pdf_language = ${lang || null},
          applicant_email = ${applicantEmail || null},
          applicant_city = ${applicantCity || null}, applicant_target_role = ${applicantTargetRole || null},
          applicant_target_cities = ${applicantTargetCities || null}, applicant_internal_notes = ${applicantInternalNotes || null},
          generated_at = now(), renewed_at = NULL, renewed_by = NULL
      WHERE code = ${accessCode} AND lifecycle_status <> 'available'
      RETURNING id, salla_order_number, generated_at, requested_package
    `;

    if (!updated) {
      // Row exists but the code was never actually consumed (shouldn't
      // happen via the normal flow) — don't leave an unlinked file behind.
      console.warn(`Skipping CV archival: access_codes row for "${accessCode}" was never consumed.`);
      del(blob.pathname).catch((err) => console.error("Failed to clean up unlinked archived PDF:", err));
      return;
    }

    // First time this code is archived (not a re-generation), OR a renewed
    // code's first fresh CV since renewal — either way this is a genuinely
    // new CV staff haven't been told about yet. The 'awaiting_sending'
    // lifecycle transition (and its timeline entry) was already recorded
    // synchronously in /api/generate-pdf at the moment the code was
    // consumed, so there's nothing to add to the timeline here; this block
    // is just the staff notification(s) for that new CV.
    if (!previousPathname || wasRenewed) {
      const requestedPackage = updated.requested_package;

      // Routed by package (see lib/staffAccounts.js): CV Arabic/English and
      // Integrated notify sending staff; Integrated and LinkedIn-only
      // notify LinkedIn staff — Integrated notifies both, once each, since
      // it covers both services. Each recipient is sent independently so
      // one bad address (or one Resend failure) never blocks the others,
      // and a failure here never affects the archival above, which has
      // already succeeded by this point.
      if (packageNotifiesSending(requestedPackage)) {
        const recipients = await resolveNotificationRecipients("sending", sql);
        if (!recipients.length) {
          console.warn(`No active sending-staff notification email configured — skipping CV notification for code "${accessCode}".`);
        }
        for (const to of recipients) {
          try {
            await sendStaffCvNotification({
              to,
              applicantName,
              sallaOrderNumber: updated.salla_order_number,
              targetRole: applicantTargetRole,
              city: applicantCity,
              createdAt: updated.generated_at,
            });
          } catch (err) {
            console.error(`Sending-staff notification email to ${to} failed (non-fatal, CV archival already succeeded):`, err);
          }
        }
      }

      if (packageNotifiesLinkedin(requestedPackage)) {
        // Integrated's LinkedIn track starts HERE, not at order creation —
        // Staff2's work depends on the CV existing, so it only enters their
        // queue the moment the CV is actually generated, alongside Staff1's
        // sending track above. (LinkedIn-only orders have no CV at all and
        // start their track at creation instead — see lib/linkedinOrdersDb.js.)
        console.log(`[linkedin-notify] code "${accessCode}" (Integrated) archived — resolving LinkedIn-staff recipients...`);
        const { status, emails } = await notifyLinkedinStaff({
          logTag: `code "${accessCode}"`,
          applicantName,
          sallaOrderNumber: updated.salla_order_number,
          city: applicantCity,
          phone: applicantPhone,
          requestedPackage,
          createdAt: updated.generated_at,
        });
        await sql`
          UPDATE access_codes
          SET linkedin_status = 'awaiting_processing',
              linkedin_notification_status = ${status}, linkedin_notified_email = ${emails.join(", ") || null}, linkedin_notified_at = now()
          WHERE id = ${updated.id}
        `;
        await logLinkedinStatusChange({ accessCodeId: updated.id, status: "awaiting_processing", changedBy: null });
        await notifyAdminStatusChange({
          track: "linkedin",
          code: accessCode,
          sallaOrderNumber: updated.salla_order_number,
          applicantName,
          requestedPackage,
          // A renewed code's LinkedIn track was already at
          // 'awaiting_processing' (reset by lib/adminRenewal.js) rather
          // than genuinely starting fresh here.
          oldStatus: wasRenewed ? "awaiting_processing" : null,
          newStatus: "awaiting_processing",
        });
      }
    }

    if (previousPathname && previousPathname !== blob.pathname) {
      del(previousPathname).catch((err) => console.error("Failed to clean up previous archived PDF:", err));
    }

    console.log(`Archived CV for code "${accessCode}" -> ${blob.pathname}`);
  } catch (err) {
    console.error("CV archival failed (non-fatal, user's download is unaffected):", err);
  }
}
