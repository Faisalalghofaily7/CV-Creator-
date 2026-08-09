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
} = {}) {
  const sql = getSql();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const [row] = await sql`
        INSERT INTO access_codes (code, salla_order_number, status, applicant_name, applicant_email, applicant_phone, salla_order_status)
        VALUES (${code}, ${sallaOrderNumber}, 'available', ${applicantName}, ${applicantEmail}, ${applicantPhone}, ${sallaOrderStatus})
        RETURNING id, code, salla_order_number, status, created_at, used_at
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
