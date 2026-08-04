import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { createUserSession, setSessionCookie } from "../../../../lib/userSession";

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
    // Validates the code and records the order number, but does NOT
    // consume it — the code stays 'available' until a PDF is actually
    // exported successfully (see /api/generate-pdf), so refreshing the
    // page or backing out before exporting never costs the user their
    // single-use code.
    const [row] = await sql`
      UPDATE access_codes
      SET salla_order_number = ${sallaOrderNumber}
      WHERE code = ${code} AND status = 'available'
      RETURNING id
    `;

    if (!row) {
      return NextResponse.json({ error: "الكود غير صحيح أو مستخدم من قبل." }, { status: 400 });
    }

    // Remembers the validated code in a server-side session so a page
    // refresh can resume the same code instead of forcing re-entry.
    const { token, maxAgeSeconds } = await createUserSession(code);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, token, maxAgeSeconds);
    return res;
  } catch (err) {
    console.error("Failed to validate access code:", err);
    return NextResponse.json({ error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." }, { status: 500 });
  }
}
