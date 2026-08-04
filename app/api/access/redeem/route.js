import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const sallaOrderNumber = typeof body.sallaOrderNumber === "string" ? body.sallaOrderNumber.trim() : "";

    if (!code || !sallaOrderNumber) {
      return NextResponse.json({ error: "الرجاء إدخال الكود ورقم الطلب." }, { status: 400 });
    }

    const sql = getSql();
    // A single conditional UPDATE both checks and consumes the code
    // atomically — if two requests race for the same code, only the first
    // one's WHERE clause still matches "available" and flips it to "used";
    // the second gets back zero rows, exactly like an already-used code.
    const [row] = await sql`
      UPDATE access_codes
      SET status = 'used', used_at = now(), salla_order_number = ${sallaOrderNumber}
      WHERE code = ${code} AND status = 'available'
      RETURNING id
    `;

    if (!row) {
      return NextResponse.json({ error: "الكود غير صحيح أو مستخدم من قبل." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to redeem access code:", err);
    return NextResponse.json({ error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." }, { status: 500 });
  }
}
