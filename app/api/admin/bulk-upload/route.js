import { NextResponse } from "next/server";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { createAccessCode, findAccessCodeBySallaOrder } from "../../../../lib/accessCodes";
import { parseSallaOrdersWorkbook, isTargetStatus, BulkImportError } from "../../../../lib/sallaBulkImport";

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
    // only the four fields we need per row make it into the database.
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
    let skippedDuplicate = 0;
    let ineligibleStatus = 0;
    let invalidRows = 0;
    const generatedCodes = [];

    // Sequential, not parallel — the same order number can legitimately
    // appear twice in one export (or across two uploads of overlapping
    // files), and only ever gets one code. That dedupe check has to see
    // the previous row's insert, which parallel execution wouldn't
    // guarantee.
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
      const existing = await findAccessCodeBySallaOrder(orderNumber);
      if (existing) {
        skippedDuplicate += 1;
        continue;
      }
      const created = await createAccessCode({
        sallaOrderNumber: orderNumber,
        applicantName: row.name || null,
        applicantPhone: row.phone || null,
        sallaOrderStatus: row.status || null,
        // This route already requires requireRole: "admin" — single
        // shared login per role, not per-person accounts.
        generationSource: "bulk_excel",
        createdBy: process.env.ADMIN_USERNAME || null,
      });
      generated += 1;
      generatedCodes.push({ code: created.code, sallaOrderNumber: orderNumber, applicantName: row.name || null });
    }

    return NextResponse.json({
      processed: rows.length,
      generated,
      skippedDuplicate,
      ineligibleStatus,
      invalidRows,
      generatedCodes,
    });
  } catch (err) {
    console.error("Failed to process Salla bulk upload:", err);
    return NextResponse.json({ error: "تعذّر معالجة الملف. حاول مرة أخرى." }, { status: 500 });
  }
}
