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
      SELECT id, code, salla_order_number, status, created_at, used_at
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
    const sallaOrderNumber = typeof body.sallaOrderNumber === "string" ? body.sallaOrderNumber.trim() || null : null;

    const row = await createAccessCode({ sallaOrderNumber });
    return NextResponse.json({ code: row });
  } catch (err) {
    console.error("Failed to create access code:", err);
    return NextResponse.json({ error: "تعذّر إنشاء الكود. حاول مرة أخرى." }, { status: 500 });
  }
}
