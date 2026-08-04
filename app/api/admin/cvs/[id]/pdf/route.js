import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { getSql } from "../../../../../../lib/db";
import { assertBlobConfigured } from "../../../../../../lib/blob";

export const runtime = "nodejs";

// Streams a private Blob back to the (admin) caller. The Blob URL/pathname
// and the read-write token never reach the browser — only the resulting
// PDF bytes do, through this same-origin route.
export async function GET(request, { params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const [row] = await sql`SELECT code, applicant_name, pdf_url FROM access_codes WHERE id = ${id}`;
    if (!row || !row.pdf_url) {
      return NextResponse.json({ error: "لم يتم العثور على ملف محفوظ لهذا السجل." }, { status: 404 });
    }

    assertBlobConfigured();
    const blob = await get(row.pdf_url, { access: "private" });
    if (!blob || blob.statusCode !== 200) {
      return NextResponse.json({ error: "الملف المحفوظ لم يعد متاحًا." }, { status: 404 });
    }

    const safeName = (row.applicant_name || row.code || "CV").replace(/\s+/g, "_").replace(/[^\w-]/g, "");
    return new NextResponse(blob.stream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}_CV.pdf"`,
      },
    });
  } catch (err) {
    console.error("Failed to fetch archived CV PDF:", err);
    return NextResponse.json({ error: "تعذّر جلب الملف. حاول مرة أخرى." }, { status: 500 });
  }
}
