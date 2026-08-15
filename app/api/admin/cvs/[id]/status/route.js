import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { isManualLifecycleStatus } from "../../../../../../lib/lifecycleStatus";
import { staffCanAccessRecord } from "../../../../../../lib/staffAccounts";
import { notifyAdminStatusChange } from "../../../../../../lib/adminStatusNotifications";

export const runtime = "nodejs";

// Updates a CV record's lifecycle status and appends a timestamped row to
// sending_status_history — the two happen together so the history is
// always a complete, gap-free record of every change. Only the manual
// stages (awaiting_sending/staff_processing/on_hold/sent) are settable
// here — the automatic early stages are system-driven (see
// /api/access/redeem and /api/generate-pdf) and never reachable through
// this route.
export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!isManualLifecycleStatus(status)) {
    return NextResponse.json({ error: "حالة غير صالحة." }, { status: 400 });
  }

  try {
    const sql = getSql();

    const [existing] = await sql`SELECT requested_package, lifecycle_status, code, applicant_name, salla_order_number FROM access_codes WHERE id = ${id} AND pdf_url IS NOT NULL`;
    if (!existing) {
      return NextResponse.json({ error: "السجل غير موجود." }, { status: 404 });
    }
    if (!staffCanAccessRecord(session?.staffType, existing.requested_package)) {
      return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا السجل." }, { status: 403 });
    }

    const [row] = await sql`
      UPDATE access_codes
      SET lifecycle_status = ${status}
      WHERE id = ${id} AND pdf_url IS NOT NULL
      RETURNING id, lifecycle_status
    `;

    // A staff_accounts-backed session records its real per-person username;
    // a legacy staff-env or admin login still falls back to the single
    // shared env-var username, exactly as before this feature existed.
    const changedBy =
      session?.staffUsername ||
      (session?.role === "staff" ? process.env.STAFF_USERNAME : process.env.ADMIN_USERNAME) ||
      null;
    await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${id}, ${status}, ${changedBy})`;
    waitUntil(
      notifyAdminStatusChange({
        track: "sending",
        code: existing.code,
        sallaOrderNumber: existing.salla_order_number,
        applicantName: existing.applicant_name,
        requestedPackage: existing.requested_package,
        oldStatus: existing.lifecycle_status,
        newStatus: status,
        changedBy,
      })
    );

    return NextResponse.json({ cv: row });
  } catch (err) {
    console.error("Failed to update lifecycle status:", err);
    return NextResponse.json({ error: "تعذّر تحديث الحالة. حاول مرة أخرى." }, { status: 500 });
  }
}
