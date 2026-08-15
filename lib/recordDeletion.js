// Admin-only permanent deletion, server-side only — never import from a
// "use client" component. Both routes that call these
// (app/api/admin/codes/[id]/route.js, app/api/admin/linkedin-orders/[id]/route.js)
// already gate on requireRole: "admin" before reaching here.
import { del } from "@vercel/blob";
import { getSql } from "./db";
import { assertBlobConfigured } from "./blob";

/**
 * Permanently deletes an access_codes row — its FK-cascaded history rows
 * (sending_status_history, linkedin_status_history, renewal_log) go with
 * it automatically (ON DELETE CASCADE, see scripts/schema.sql), matching
 * the same cascade the DB-cleanup runbook already relies on. Also removes
 * its archived Blob PDF, if any, so nothing is left orphaned. Records the
 * deletion in deletion_log — the row itself is gone afterward, so this is
 * the only place the deletion stays visible. Returns the deleted row's
 * identity (for the caller to log/respond with), or null if no such row
 * existed.
 */
export async function deleteAccessCodeRecord(id, deletedBy) {
  const sql = getSql();
  const [row] = await sql`SELECT id, code, salla_order_number, applicant_name, pdf_url FROM access_codes WHERE id = ${id}`;
  if (!row) return null;

  if (row.pdf_url) {
    try {
      assertBlobConfigured();
      await del(row.pdf_url);
    } catch (err) {
      // Best-effort, same as every other Blob cleanup in this app (see
      // lib/cvArchive.js) — a stuck/misconfigured Blob store must never
      // block the record deletion itself.
      console.error(`Failed to delete archived PDF for code "${row.code}" during record deletion (continuing):`, err);
    }
  }

  await sql`DELETE FROM access_codes WHERE id = ${id}`;
  await sql`
    INSERT INTO deletion_log (record_type, record_id, code, salla_order_number, applicant_name, deleted_by)
    VALUES ('access_code', ${id}, ${row.code}, ${row.salla_order_number}, ${row.applicant_name}, ${deletedBy})
  `;
  return row;
}

/** Same as above for a standalone linkedin_orders row (never has a PDF). */
export async function deleteLinkedinOrderRecord(id, deletedBy) {
  const sql = getSql();
  const [row] = await sql`SELECT id, salla_order_number, applicant_name FROM linkedin_orders WHERE id = ${id}`;
  if (!row) return null;

  await sql`DELETE FROM linkedin_orders WHERE id = ${id}`;
  await sql`
    INSERT INTO deletion_log (record_type, record_id, code, salla_order_number, applicant_name, deleted_by)
    VALUES ('linkedin_order', ${id}, NULL, ${row.salla_order_number}, ${row.applicant_name}, ${deletedBy})
  `;
  return row;
}
