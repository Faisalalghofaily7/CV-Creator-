import { NextResponse } from "next/server";
import { verifyAdminCredentials, createAdminSession, setSessionCookie } from "../../../../lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json({ error: "الرجاء إدخال اسم المستخدم وكلمة المرور." }, { status: 400 });
    }

    const role = await verifyAdminCredentials(username, password);
    if (!role) {
      return NextResponse.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." }, { status: 401 });
    }

    const { token, maxAgeSeconds } = await createAdminSession(role);
    const res = NextResponse.json({ ok: true, role });
    setSessionCookie(res, token, maxAgeSeconds);
    return res;
  } catch (err) {
    console.error("Admin login failed:", err);
    return NextResponse.json({ error: "تعذّر تسجيل الدخول. حاول مرة أخرى." }, { status: 500 });
  }
}
