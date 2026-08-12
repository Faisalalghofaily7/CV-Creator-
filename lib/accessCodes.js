import { getSql } from "./db";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode() {
  const seg = (n) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  return `CV-${seg(4)}-${seg(4)}`;
}

/**
 * Inserts a new access code, retrying a few times on the rare code
 * collision. Shared by the admin "generate code" action and the Salla
 * webhook so both paths create identical rows through identical logic —
 * a webhook-generated code works exactly like an admin-generated one.
 */
export async function createAccessCode({
  sallaOrderNumber = null,
  applicantName = null,
  applicantEmail = null,
  applicantPhone = null,
  sallaOrderStatus = null,
  requestedPackage = null,
  generationSource = "unknown",
  createdBy = null,
  // Set to 'awaiting_processing' for an Integrated-package code so its
  // LinkedIn portion starts showing in LinkedIn staff's panel immediately
  // at creation — independent of whether/when the customer ever generates
  // the CV itself. Left null for every other package (no LinkedIn work
  // attached to this code at all).
  linkedinStatus = null,
} = {}) {
  const sql = getSql();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const [row] = await sql`
        INSERT INTO access_codes (code, salla_order_number, status, applicant_name, applicant_email, applicant_phone, salla_order_status, requested_package, generation_source, created_by, linkedin_status)
        VALUES (${code}, ${sallaOrderNumber}, 'available', ${applicantName}, ${applicantEmail}, ${applicantPhone}, ${sallaOrderStatus}, ${requestedPackage}, ${generationSource}, ${createdBy}, ${linkedinStatus})
        RETURNING id, code, salla_order_number, status, lifecycle_status, applicant_name, applicant_phone, requested_package, generation_source, created_by, created_at, used_at, linkedin_status
      `;
      return row;
    } catch (err) {
      if (err?.code === "23505" && attempt < 4) continue; // unique_violation on code — retry
      throw err;
    }
  }
  throw new Error("Could not generate a unique code after several attempts.");
}

/** Most recent access code linked to a given Salla order number, if any. */
export async function findAccessCodeBySallaOrder(sallaOrderNumber) {
  if (!sallaOrderNumber) return null;
  const sql = getSql();
  const [row] = await sql`
    SELECT id, code, status
    FROM access_codes
    WHERE salla_order_number = ${sallaOrderNumber}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row || null;
}
