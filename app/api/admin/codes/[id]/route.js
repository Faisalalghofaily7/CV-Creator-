import { NextResponse } from "next/server";
import { getSql } from "../../../../../lib/db";
import { requireAdminApi } from "../../../../../lib/adminAuth";

export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request);
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
