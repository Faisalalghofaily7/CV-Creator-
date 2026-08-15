import { NextResponse } from "next/server";
import { Packer } from "docx";
import { waitUntil } from "@vercel/functions";
import { buildCvDocx } from "../../../lib/cvDocxTemplate";
import { archiveGeneratedDocx } from "../../../lib/docxArchive";
import { getSql } from "../../../lib/db";

export const runtime = "nodejs";
// Pure JS document construction — no headless browser involved, so this
// needs nowhere near generate-pdf's budget.
export const maxDuration = 30;

// Independent of /api/generate-pdf on purpose — see lib/cvDocxTemplate.js's
// file-level note. This route never imports from, and is never imported
// by, anything on the PDF path.
export async function POST(request) {
  try {
    const body = await request.json();
    const { form, experiences, education, courses, certifications, customSections, techSkills, softSkills, lang, accessCode } = body;

    const code = typeof accessCode === "string" ? accessCode.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "لا يوجد كود دخول صالح لهذه الجلسة." }, { status: 400 });
    }

    // Same mandatory-field re-check generate-pdf/route.js does — duplicated
    // here rather than shared, so this route can never need to touch
    // anything on the PDF path (see lib/cvDocxTemplate.js's note).
    const missingFields = [];
    if (!form?.name?.trim()) missingFields.push(lang === "en" ? "Full Name" : "الاسم الكامل");
    if (!form?.phone?.trim()) missingFields.push(lang === "en" ? "Phone Number" : "رقم الجوال");
    if (!form?.targetRoles?.trim()) missingFields.push(lang === "en" ? "Target Role(s)" : "الوظيفة/الوظائف المستهدفة");
    if (missingFields.length) {
      const message = lang === "en"
        ? `Cannot export an incomplete CV. Missing required field(s): ${missingFields.join(", ")}.`
        : `لا يمكن تصدير سيرة ذاتية غير مكتملة. الحقول المطلوبة الناقصة: ${missingFields.join("، ")}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const gpaInvalid = Array.isArray(education) && education.some((x) => {
      const value = parseFloat(x?.gpaValue);
      const scale = parseFloat(x?.gpaScale);
      return !isNaN(value) && !isNaN(scale) && value > scale;
    });
    if (gpaInvalid) {
      const message = lang === "en" ? "GPA cannot exceed the selected scale." : "المعدل لا يمكن أن يتجاوز المقياس المختار.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const sql = getSql();
    // Existence check only — Word deliberately does NOT gate on or consume
    // lifecycle_status the way PDF does (see lib/docxArchive.js's note),
    // so it can be downloaded before, after, or without ever exporting the
    // PDF, matching "either or both" — PDF alone remains the single-use
    // trigger, completely unaffected by this route.
    const [existing] = await sql`SELECT id FROM access_codes WHERE code = ${code}`;
    if (!existing) {
      return NextResponse.json({ error: "الكود غير صالح." }, { status: 404 });
    }

    const doc = buildCvDocx({ form, experiences, education, courses, certifications, customSections, techSkills, softSkills, lang });
    const buffer = await Packer.toBuffer(doc);

    // Best-effort archival for the admin panel — never blocks or affects
    // this response, same pattern as the PDF's own background archival.
    waitUntil(archiveGeneratedDocx({ accessCode: code, docxBuffer: buffer, applicantName: form?.name, lang }));

    const safeName = (form?.name || "CV").replace(/\s+/g, "_");
    const fileName = `${safeName}_CV.docx`;
    // Content-Disposition must be a valid HTTP header value (Latin-1 only) —
    // Arabic names need the RFC 5987 filename* form, with an ASCII fallback
    // for older clients that don't understand it (same approach as the PDF route).
    const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (err) {
    console.error("Word (.docx) generation failed:", err);
    return NextResponse.json({ error: "تعذّر إنشاء ملف Word. يمكنك تحميل PDF بدلاً من ذلك." }, { status: 500 });
  }
}
