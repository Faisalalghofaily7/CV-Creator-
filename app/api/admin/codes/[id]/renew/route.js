import { NextResponse } from "next/server";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { renewAccessCode } from "../../../../../../lib/adminRenewal";

export const runtime = "nodejs";

// Admin-only — resets a used code back to redeemable while keeping its
// existing PDF, per lib/adminRenewal.js. Staff sessions never pass
// requireRole: "admin" here, so this deliberately overrides single-use
// protection only ever at an admin's explicit action, never a staff one.
export async function POST(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const renewedBy = session?.staffUsername || process.env.ADMIN_USERNAME || null;
    const result = await renewAccessCode(id, renewedBy);
    if (result.error === "not_found") {
      return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
    }
    if (result.error === "not_used") {
      return NextResponse.json({ error: "هذا الكود لم يُستخدم بعد — التجديد يخص الأكواد المستخدمة فقط." }, { status: 400 });
    }
    console.log(`[admin-renew] access_code id=${id} code=${result.record.code} renewed by ${renewedBy}`);
    return NextResponse.json({ code: result.record });
  } catch (err) {
    console.error("Failed to renew access code:", err);
    return NextResponse.json({ error: "تعذّر تجديد الكود. حاول مرة أخرى." }, { status: 500 });
  }
}
