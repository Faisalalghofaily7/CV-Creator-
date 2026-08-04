import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroyAdminSession, clearSessionCookie } from "../../../../lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  await destroyAdminSession(token).catch((err) => console.error("Failed to destroy admin session:", err));
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
