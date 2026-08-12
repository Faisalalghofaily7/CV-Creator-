import { NextResponse } from "next/server";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { createAccessCode } from "../../../../lib/accessCodes";
import { parseSallaOrdersWorkbook, isTargetStatus, classifyPackage, BulkImportError } from "../../../../lib/sallaBulkImport";
import { createLinkedinOrderAndNotify, sallaOrderNumberExists } from "../../../../lib/linkedinOrdersDb";
import { PACKAGE_LINKEDIN } from "../../../../lib/staffAccounts";

export const runtime = "nodejs";

export async function POST(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "الرجاء اختيار ملف Excel (.xlsx) لرفعه." }, { status: 400 });
    }
    if (!(file.name || "").toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "الملف يجب أن يكون بصيغة .xlsx." }, { status: 400 });
    }

    // Parsed entirely in memory below and discarded once rows are
    // extracted — the raw file is never written to disk or blob storage,
    // only the fields we need per row make it into the database.
    const buffer = Buffer.from(await file.arrayBuffer());

    let rows;
    try {
      rows = await parseSallaOrdersWorkbook(buffer);
    } catch (err) {
      if (err instanceof BulkImportError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let generated = 0;
    let linkedinOnlyCreated = 0;
    let skippedDuplicate = 0;
    let ineligibleStatus = 0;
    let invalidRows = 0;
    let linkedinNotificationIssues = 0;
    const generatedCodes = [];
    const generatedLinkedinOrders = [];
    const unrecognized = [];

    // This route already requires requireRole: "admin" — single shared
    // login per role, not per-person accounts.
    const createdBy = process.env.ADMIN_USERNAME || null;

    // Sequential, not parallel — the same order number can legitimately
    // appear twice in one export (or across two uploads of overlapping
    // files), and only ever gets one record (code OR LinkedIn-only order).
    // That dedupe check has to see the previous row's insert, which
    // parallel execution wouldn't guarantee.
    for (const row of rows) {
      if (!isTargetStatus(row.status)) {
        ineligibleStatus += 1;
        continue;
      }
      const orderNumber = row.order.trim();
      if (!orderNumber) {
        invalidRows += 1;
        continue;
      }

      // Dedup spans both access_codes and linkedin_orders — "one Salla
      // order number = one record ever," regardless of which kind of
      // record it eventually became.
      if (await sallaOrderNumberExists(orderNumber)) {
        skippedDuplicate += 1;
        continue;
      }

      const detectedPackage = classifyPackage(row.rawProduct);
      if (!detectedPackage) {
        // Never guessed, never silently skipped — a paying customer's
        // order always surfaces for manual review instead.
        unrecognized.push({ sallaOrderNumber: orderNumber, applicantName: row.name || null, rawProduct: row.rawProduct || "" });
        continue;
      }

      if (detectedPackage === PACKAGE_LINKEDIN) {
        // LinkedIn-only: no CV, no access code — lands directly in
        // LinkedIn staff's panel at 'awaiting_processing', and emails
        // active LinkedIn staff (see lib/linkedinOrdersDb.js).
        const createdOrder = await createLinkedinOrderAndNotify({
          sallaOrderNumber: orderNumber,
          applicantName: row.name || null,
          applicantPhone: row.phone || null,
          requestedPackage: detectedPackage,
          generationSource: "bulk_excel",
          createdBy,
        });
        linkedinOnlyCreated += 1;
        if (createdOrder.notification_status !== "sent") linkedinNotificationIssues += 1;
        generatedLinkedinOrders.push({
          sallaOrderNumber: orderNumber,
          applicantName: row.name || null,
          notificationStatus: createdOrder.notification_status,
        });
        continue;
      }

      // CV Arabic/English or Integrated — all get an access code the same
      // way. An Integrated code's LinkedIn track does NOT start here —
      // Staff2's work depends on the CV, so linkedin_status stays NULL
      // until the CV is actually generated (see lib/cvArchive.js), at the
      // same moment Staff1's sending track begins.
      const created = await createAccessCode({
        sallaOrderNumber: orderNumber,
        applicantName: row.name || null,
        applicantPhone: row.phone || null,
        sallaOrderStatus: row.status || null,
        requestedPackage: detectedPackage,
        generationSource: "bulk_excel",
        createdBy,
      });
      generated += 1;
      generatedCodes.push({ code: created.code, sallaOrderNumber: orderNumber, applicantName: row.name || null, requestedPackage: detectedPackage });
    }

    return NextResponse.json({
      processed: rows.length,
      generated,
      linkedinOnlyCreated,
      skippedDuplicate,
      ineligibleStatus,
      invalidRows,
      linkedinNotificationIssues,
      unrecognized,
      generatedCodes,
      generatedLinkedinOrders,
    });
  } catch (err) {
    console.error("Failed to process Salla bulk upload:", err);
    return NextResponse.json({ error: "تعذّر معالجة الملف. حاول مرة أخرى." }, { status: 500 });
  }
}
