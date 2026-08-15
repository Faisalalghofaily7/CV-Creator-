import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { createAccessCode } from "../../../../lib/accessCodes";
import { createLinkedinOrderAndNotify, sallaOrderNumberExists } from "../../../../lib/linkedinOrdersDb";
import { PACKAGE_LINKEDIN } from "../../../../lib/staffAccounts";
import { buildWhatsappMessage } from "../../../../lib/whatsappTemplates";

export const runtime = "nodejs";

export async function GET(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, code, salla_order_number, applicant_name, applicant_phone, requested_package,
             lifecycle_status, generation_source, created_by, created_at, used_at, renewed_at
      FROM access_codes
      ORDER BY created_at DESC
    `;
    const codes = rows.map((r) => ({
      ...r,
      whatsapp_message: buildWhatsappMessage({ name: r.applicant_name, code: r.code, requestedPackage: r.requested_package }),
    }));
    return NextResponse.json({ codes });
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
    const applicantName = typeof body.applicantName === "string" ? body.applicantName.trim() : "";
    const requestedPackage = typeof body.requestedPackage === "string" ? body.requestedPackage.trim() || null : null;

    if (!sallaOrderNumber) {
      return NextResponse.json({ error: "رقم طلب سلة مطلوب لتوليد الكود." }, { status: 400 });
    }
    if (!applicantPhone) {
      return NextResponse.json({ error: "رقم جوال العميل مطلوب لتوليد الكود." }, { status: 400 });
    }
    if (!applicantName) {
      return NextResponse.json({ error: "اسم العميل مطلوب لتوليد الكود." }, { status: 400 });
    }

    // This route already requires requireRole: "admin", so the acting
    // username is always the admin one — there's a single shared login per
    // role, not per-person accounts.
    const createdBy = process.env.ADMIN_USERNAME || null;

    // Same package-aware routing the Excel bulk-upload path already uses
    // (app/api/admin/bulk-upload/route.js) — a LinkedIn-only package must
    // never get an access code/CV, an Integrated package gets a code AND
    // starts the LinkedIn track immediately, and a plain CV package just
    // gets a code, exactly as before.
    if (requestedPackage === PACKAGE_LINKEDIN) {
      if (await sallaOrderNumberExists(sallaOrderNumber)) {
        return NextResponse.json({ error: "رقم طلب سلة هذا مستخدم بالفعل." }, { status: 409 });
      }
      const linkedinOrder = await createLinkedinOrderAndNotify({
        sallaOrderNumber,
        applicantName,
        applicantPhone,
        requestedPackage,
        generationSource: "manual",
        createdBy,
      });
      return NextResponse.json({
        linkedinOrder: {
          ...linkedinOrder,
          whatsapp_message: buildWhatsappMessage({ name: linkedinOrder.applicant_name, requestedPackage: linkedinOrder.requested_package }),
        },
      });
    }

    // An Integrated code's LinkedIn track does NOT start here — Staff2's
    // work depends on the CV, so linkedin_status stays NULL until the CV is
    // actually generated (see lib/cvArchive.js), at the same moment
    // Staff1's sending track begins. LinkedIn-only orders (handled above)
    // have no CV at all, so they're the only package that starts its
    // LinkedIn track immediately at creation.
    const row = await createAccessCode({
      sallaOrderNumber,
      applicantPhone,
      applicantName,
      requestedPackage,
      generationSource: "manual",
      createdBy,
    });
    return NextResponse.json({
      code: {
        ...row,
        whatsapp_message: buildWhatsappMessage({ name: row.applicant_name, code: row.code, requestedPackage: row.requested_package }),
      },
    });
  } catch (err) {
    console.error("Failed to create access code:", err);
    return NextResponse.json({ error: "تعذّر إنشاء الكود. حاول مرة أخرى." }, { status: 500 });
  }
}
