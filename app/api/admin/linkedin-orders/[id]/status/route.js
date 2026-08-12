import { NextResponse } from "next/server";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { isValidLinkedinOrderStatus, parseCompositeOrderId } from "../../../../../../lib/linkedinOrders";
import { logLinkedinStatusChange } from "../../../../../../lib/linkedinOrdersDb";

export const runtime = "nodejs";

// Updates the LinkedIn-work status for either kind of record the merged
// panel shows — a standalone linkedin_orders row, or the linkedin_status
// column on an Integrated-package access_codes row — and appends a
// timestamped history entry, mirroring PATCH /api/admin/cvs/[id]/status
// for the CV-sending track.
export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);
  if (session.role === "staff" && session.staffType === "sending") {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا القسم." }, { status: 403 });
  }

  const parsed = parseCompositeOrderId(params.id);
  if (!parsed) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!isValidLinkedinOrderStatus(status)) {
    return NextResponse.json({ error: "حالة غير صالحة." }, { status: 400 });
  }

  const changedBy =
    session.staffUsername ||
    (session.role === "staff" ? process.env.STAFF_USERNAME : process.env.ADMIN_USERNAME) ||
    null;

  try {
    const sql = getSql();

    if (parsed.sourceType === "linkedin_only") {
      const [row] = await sql`
        UPDATE linkedin_orders SET status = ${status} WHERE id = ${parsed.id} RETURNING id, status
      `;
      if (!row) return NextResponse.json({ error: "السجل غير موجود." }, { status: 404 });
      await logLinkedinStatusChange({ linkedinOrderId: parsed.id, status, changedBy });
      return NextResponse.json({ order: { id: `lo-${row.id}`, status: row.status } });
    }

    const [row] = await sql`
      UPDATE access_codes SET linkedin_status = ${status} WHERE id = ${parsed.id} AND linkedin_status IS NOT NULL
      RETURNING id, linkedin_status
    `;
    if (!row) return NextResponse.json({ error: "السجل غير موجود." }, { status: 404 });
    await logLinkedinStatusChange({ accessCodeId: parsed.id, status, changedBy });
    return NextResponse.json({ order: { id: `cv-${row.id}`, status: row.linkedin_status } });
  } catch (err) {
    console.error("Failed to update LinkedIn order status:", err);
    return NextResponse.json({ error: "تعذّر تحديث الحالة. حاول مرة أخرى." }, { status: 500 });
  }
}
