import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../lib/adminAuth";
import { isValidLifecycleStatus } from "../../../../lib/lifecycleStatus";
import { staffCanAccessRecord } from "../../../../lib/staffAccounts";
import { buildWhatsappMessage } from "../../../../lib/whatsappTemplates";

export const runtime = "nodejs";

export async function GET(request) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  try {
    const sql = getSql();
    const statusFilter = new URL(request.url).searchParams.get("status");

    const rows =
      statusFilter && isValidLifecycleStatus(statusFilter)
        ? await sql`
            SELECT id, code, salla_order_number, applicant_name, applicant_email, applicant_phone,
                   applicant_city, applicant_target_role, applicant_target_cities, applicant_internal_notes,
                   requested_package, generation_source, created_by,
                   pdf_language, lifecycle_status, generated_at, renewed_at,
                   (docx_url IS NOT NULL) AS has_docx
            FROM access_codes
            WHERE pdf_url IS NOT NULL AND lifecycle_status = ${statusFilter}
            ORDER BY generated_at DESC
          `
        : await sql`
            SELECT id, code, salla_order_number, applicant_name, applicant_email, applicant_phone,
                   applicant_city, applicant_target_role, applicant_target_cities, applicant_internal_notes,
                   requested_package, generation_source, created_by,
                   pdf_language, lifecycle_status, generated_at, renewed_at,
                   (docx_url IS NOT NULL) AS has_docx
            FROM access_codes
            WHERE pdf_url IS NOT NULL
            ORDER BY generated_at DESC
          `;
    // A 'linkedin'/'sending'-typed staff account (session.staffType set)
    // only sees the slice of the archive their type covers — a legacy
    // staff-env login or the admin role has no staffType and sees
    // everything, unchanged from before this feature existed.
    const visible = rows
      .filter((r) => staffCanAccessRecord(session?.staffType, r.requested_package))
      .map((r) => ({
        ...r,
        whatsapp_message: buildWhatsappMessage({ name: r.applicant_name, code: r.code, requestedPackage: r.requested_package }),
      }));
    return NextResponse.json({ cvs: visible });
  } catch (err) {
    console.error("Failed to list archived CVs:", err);
    return NextResponse.json({ error: "تعذّر تحميل الأرشيف. حاول مرة أخرى." }, { status: 500 });
  }
}
