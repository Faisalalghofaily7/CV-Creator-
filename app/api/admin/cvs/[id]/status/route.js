import { NextResponse } from "next/server";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { isManualLifecycleStatus } from "../../../../../../lib/lifecycleStatus";

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
    const [row] = await sql`
      UPDATE access_codes
      SET lifecycle_status = ${status}
      WHERE id = ${id} AND pdf_url IS NOT NULL
      RETURNING id, lifecycle_status
    `;
    if (!row) {
      return NextResponse.json({ error: "السجل غير موجود." }, { status: 404 });
    }

    // There's one shared login per role (no per-person accounts), so the
    // session's role uniquely determines which username made this change.
    const changedBy = (session?.role === "staff" ? process.env.STAFF_USERNAME : process.env.ADMIN_USERNAME) || null;
    await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${id}, ${status}, ${changedBy})`;

    return NextResponse.json({ cv: row });
  } catch (err) {
    console.error("Failed to update lifecycle status:", err);
    return NextResponse.json({ error: "تعذّر تحديث الحالة. حاول مرة أخرى." }, { status: 500 });
  }
}
