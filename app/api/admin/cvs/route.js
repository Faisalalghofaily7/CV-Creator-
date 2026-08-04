import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi } from "../../../../lib/adminAuth";

export const runtime = "nodejs";

export async function GET(request) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, code, salla_order_number, applicant_name, pdf_language, generated_at
      FROM access_codes
      WHERE pdf_url IS NOT NULL
      ORDER BY generated_at DESC
    `;
    return NextResponse.json({ cvs: rows });
  } catch (err) {
    console.error("Failed to list archived CVs:", err);
    return NextResponse.json({ error: "تعذّر تحميل الأرشيف. حاول مرة أخرى." }, { status: 500 });
  }
}
