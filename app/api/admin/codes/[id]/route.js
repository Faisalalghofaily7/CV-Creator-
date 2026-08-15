import { NextResponse } from "next/server";
import { getSql } from "../../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../lib/adminAuth";
import { deleteAccessCodeRecord } from "../../../../../lib/recordDeletion";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const sallaOrderNumber = typeof body.sallaOrderNumber === "string" ? body.sallaOrderNumber.trim() || null : null;

    const sql = getSql();
    const [row] = await sql`
      UPDATE access_codes
      SET salla_order_number = ${sallaOrderNumber}
      WHERE id = ${id}
      RETURNING id, code, salla_order_number, status, created_at, used_at
    `;
    if (!row) {
      return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
    }
    return NextResponse.json({ code: row });
  } catch (err) {
    console.error("Failed to update access code:", err);
    return NextResponse.json({ error: "تعذّر تحديث الكود. حاول مرة أخرى." }, { status: 500 });
  }
}

// Permanent deletion — admin-only (staff sessions never pass requireRole:
// "admin" here, so a staff account can never reach this at all). Removes
// the row, every FK-cascaded history row with it, and its archived Blob
// PDF if any (see lib/recordDeletion.js), and logs who deleted it and when.
export async function DELETE(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const deletedBy = session?.staffUsername || process.env.ADMIN_USERNAME || null;
    const deleted = await deleteAccessCodeRecord(id, deletedBy);
    if (!deleted) {
      return NextResponse.json({ error: "الطلب غير موجود." }, { status: 404 });
    }
    console.log(`[admin-delete] access_code id=${id} code=${deleted.code} deleted by ${deletedBy}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete access code:", err);
    return NextResponse.json({ error: "تعذّر حذف الطلب. حاول مرة أخرى." }, { status: 500 });
  }
}
