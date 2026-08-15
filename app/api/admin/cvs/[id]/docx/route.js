import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { getSql } from "../../../../../../lib/db";
import { assertBlobConfigured } from "../../../../../../lib/blob";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { staffCanViewCvPdf } from "../../../../../../lib/staffAccounts";

export const runtime = "nodejs";

// Streams the archived Word (.docx) back to the (admin) caller — same
// pattern as app/api/admin/cvs/[id]/pdf/route.js (duplicated rather than
// shared, so nothing here ever needs to touch the PDF route). Same access
// control: same staff-type/package scoping, same 404 if this record never
// had a .docx generated (Word is optional/best-effort).
export async function GET(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const [row] = await sql`SELECT code, applicant_name, docx_url, requested_package FROM access_codes WHERE id = ${id}`;
    if (!row || !row.docx_url) {
      return NextResponse.json({ error: "لم يتم العثور على ملف Word محفوظ لهذا السجل." }, { status: 404 });
    }
    if (!staffCanViewCvPdf(session?.staffType, row.requested_package)) {
      return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا السجل." }, { status: 403 });
    }

    assertBlobConfigured();
    const blob = await get(row.docx_url, { access: "private" });
    if (!blob || blob.statusCode !== 200) {
      return NextResponse.json({ error: "الملف المحفوظ لم يعد متاحًا." }, { status: 404 });
    }

    const safeName = (row.applicant_name || row.code || "CV").replace(/\s+/g, "_").replace(/[^\w-]/g, "");
    return new NextResponse(blob.stream, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName}_CV.docx"`,
      },
    });
  } catch (err) {
    console.error("Failed to fetch archived CV Word doc:", err);
    return NextResponse.json({ error: "تعذّر جلب الملف. حاول مرة أخرى." }, { status: 500 });
  }
}
