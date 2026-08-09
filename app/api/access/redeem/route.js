import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { createUserSession, setSessionCookie } from "../../../../lib/userSession";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return NextResponse.json({ error: "الرجاء إدخال الكود." }, { status: 400 });
    }

    const sql = getSql();
    // Just validates the code — it's already linked to its Salla order
    // (set at admin-generation or by the Salla webhook), so there's
    // nothing left for the user to submit here. Does NOT consume the
    // code — it stays 'available' until a PDF is actually exported
    // successfully (see /api/generate-pdf), so refreshing the page or
    // backing out before exporting never costs the user their single-use
    // code.
    const [row] = await sql`
      SELECT id
      FROM access_codes
      WHERE code = ${code} AND status = 'available'
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
