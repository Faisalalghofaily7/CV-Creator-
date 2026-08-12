import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../lib/adminAuth";

export const runtime = "nodejs";

// Only admin and 'linkedin'-type staff may see this panel — a 'sending'
// staff member never sees LinkedIn-only orders, and a legacy staff-env
// login (no staffType at all) stays unrestricted, matching how every
// other staff-scoped endpoint in this app already treats that case.
function forbiddenForRole(session) {
  return session.role === "staff" && session.staffType === "sending";
}

// GET merges two different tables into one list the LinkedIn panel can
// render as a single queue: standalone linkedin_orders rows (LinkedIn-only
// packages, no CV at all) and access_codes rows carrying a linkedin_status
// (the LinkedIn portion of an Integrated-package order, visible here from
// the moment the code is created — it never waits on the CV being built).
export async function GET(request) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);
  if (forbiddenForRole(session)) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا القسم." }, { status: 403 });
  }

  try {
    const sql = getSql();

    const linkedinOnlyRows = await sql`
      SELECT id, salla_order_number, applicant_name, applicant_phone, requested_package, status,
             generation_source, created_by, created_at
      FROM linkedin_orders
      ORDER BY created_at DESC
    `;
    const integratedRows = await sql`
      SELECT id, code, salla_order_number, applicant_name, applicant_phone, applicant_email, requested_package,
             linkedin_status AS status, lifecycle_status, generation_source, created_by, created_at
      FROM access_codes
      WHERE linkedin_status IS NOT NULL
      ORDER BY created_at DESC
    `;

    const merged = [
      ...linkedinOnlyRows.map((r) => ({
        id: `lo-${r.id}`,
        sourceType: "linkedin_only",
        sallaOrderNumber: r.salla_order_number,
        applicantName: r.applicant_name,
        applicantPhone: r.applicant_phone,
        applicantEmail: null,
        requestedPackage: r.requested_package,
        status: r.status,
        generationSource: r.generation_source,
        createdBy: r.created_by,
        createdAt: r.created_at,
        code: null,
        cvLifecycleStatus: null,
      })),
      ...integratedRows.map((r) => ({
        id: `cv-${r.id}`,
        sourceType: "integrated_cv",
        sallaOrderNumber: r.salla_order_number,
        applicantName: r.applicant_name,
        applicantPhone: r.applicant_phone,
        applicantEmail: r.applicant_email,
        requestedPackage: r.requested_package,
        status: r.status,
        generationSource: r.generation_source,
        createdBy: r.created_by,
        createdAt: r.created_at,
        code: r.code,
        cvLifecycleStatus: r.lifecycle_status,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return NextResponse.json({ orders: merged });
  } catch (err) {
    console.error("Failed to list LinkedIn orders:", err);
    return NextResponse.json({ error: "تعذّر تحميل طلبات لينكدإن. حاول مرة أخرى." }, { status: 500 });
  }
}
