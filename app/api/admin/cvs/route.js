import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { isValidSendingStatus } from "../../../../lib/sendingStatus";

export const runtime = "nodejs";

export async function GET(request) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  try {
    const sql = getSql();
    const statusFilter = new URL(request.url).searchParams.get("status");

    const rows =
      statusFilter && isValidSendingStatus(statusFilter)
        ? await sql`
            SELECT id, code, salla_order_number, applicant_name, applicant_email, applicant_phone,
                   applicant_city, applicant_target_role, pdf_language, sending_status, generated_at
            FROM access_codes
            WHERE pdf_url IS NOT NULL AND sending_status = ${statusFilter}
            ORDER BY generated_at DESC
          `
        : await sql`
            SELECT id, code, salla_order_number, applicant_name, applicant_email, applicant_phone,
                   applicant_city, applicant_target_role, pdf_language, sending_status, generated_at
            FROM access_codes
            WHERE pdf_url IS NOT NULL
            ORDER BY generated_at DESC
          `;
    return NextResponse.json({ cvs: rows });
  } catch (err) {
    console.error("Failed to list archived CVs:", err);
    return NextResponse.json({ error: "تعذّر تحميل الأرشيف. حاول مرة أخرى." }, { status: 500 });
  }
}
