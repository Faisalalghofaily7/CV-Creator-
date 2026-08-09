import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { createAccessCode } from "../../../../lib/accessCodes";

export const runtime = "nodejs";

export async function GET(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, code, salla_order_number, applicant_phone, requested_package, status, created_at, used_at
      FROM access_codes
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ codes: rows });
  } catch (err) {
    console.error("Failed to list access codes:", err);
    return NextResponse.json({ error: "تعذّر الاتصال بقاعدة البيانات. حاول مرة أخرى." }, { status: 500 });
  }
}

export async function POST(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const sallaOrderNumber = typeof body.sallaOrderNumber === "string" ? body.sallaOrderNumber.trim() : "";
    const applicantPhone = typeof body.applicantPhone === "string" ? body.applicantPhone.trim() : "";
    const requestedPackage = typeof body.requestedPackage === "string" ? body.requestedPackage.trim() || null : null;

    if (!sallaOrderNumber) {
      return NextResponse.json({ error: "رقم طلب سلة مطلوب لتوليد الكود." }, { status: 400 });
    }
    if (!applicantPhone) {
      return NextResponse.json({ error: "رقم جوال العميل مطلوب لتوليد الكود." }, { status: 400 });
    }

    const row = await createAccessCode({ sallaOrderNumber, applicantPhone, requestedPackage });
    return NextResponse.json({ code: row });
  } catch (err) {
    console.error("Failed to create access code:", err);
    return NextResponse.json({ error: "تعذّر إنشاء الكود. حاول مرة أخرى." }, { status: 500 });
  }
}
