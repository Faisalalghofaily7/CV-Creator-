// Server-only DB access for the LinkedIn-work track. Never import this
// from a "use client" component — see lib/linkedinOrders.js for the
// client-safe constants/labels/composite-id parsing instead.
import { getSql } from "./db";

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
