// Shared by lib/cvArchive.js (CV/Integrated notifications, triggered at PDF
// generation) and lib/linkedinOrdersDb.js (LinkedIn-only notifications,
// triggered at order creation) — kept in one place so both call sites
// resolve "who gets notified for staff type X" identically rather than
// each re-implementing the same query.
import { getSql } from "./db";

/**
 * Active staff-of-type recipient emails, resolved fresh on every send so a
 * just-added address or a just-deactivated account always takes effect
 * immediately — no caching. Falls back to the legacy STAFF_NOTIFICATION_EMAIL
 * env var (if set) when no active staff of that type has an email
 * configured yet, so notifications keep flowing during the transition to
 * per-account emails rather than silently going nowhere.
 */
export async function resolveNotificationRecipients(staffType, sql = getSql()) {
  const rows = await sql`
    SELECT email FROM staff_accounts
    WHERE staff_type = ${staffType} AND active = true AND email IS NOT NULL AND email <> ''
  `;
  const emails = rows.map((r) => r.email);
  if (emails.length) return emails;
  const fallback = process.env.STAFF_NOTIFICATION_EMAIL;
  return fallback ? [fallback] : [];
}
