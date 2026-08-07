import { NextResponse } from "next/server";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi } from "../../../../../../lib/adminAuth";
import { isValidSendingStatus } from "../../../../../../lib/sendingStatus";

export const runtime = "nodejs";

// Updates a CV record's sending status and appends a timestamped row to
// sending_status_history — the two happen together so the history is
// always a complete, gap-free record of every change.
export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const status = body.status;
  if (!isValidSendingStatus(status)) {
    return NextResponse.json({ error: "حالة غير صالحة." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const [row] = await sql`
      UPDATE access_codes
      SET sending_status = ${status}
      WHERE id = ${id} AND pdf_url IS NOT NULL
      RETURNING id, sending_status
    `;
    if (!row) {
      return NextResponse.json({ error: "السجل غير موجود." }, { status: 404 });
    }

    // There's a single shared admin login (no per-admin accounts) — record
    // that shared username as the best-effort "who changed it".
    const changedBy = process.env.ADMIN_USERNAME || null;
    await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${id}, ${status}, ${changedBy})`;

    return NextResponse.json({ cv: row });
  } catch (err) {
    console.error("Failed to update sending status:", err);
    return NextResponse.json({ error: "تعذّر تحديث حالة الإرسال. حاول مرة أخرى." }, { status: 500 });
  }
}
