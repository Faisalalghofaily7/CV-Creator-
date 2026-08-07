import { NextResponse } from "next/server";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi } from "../../../../../../lib/adminAuth";

export const runtime = "nodejs";

// Fetched lazily per-record (when staff expand a card) rather than joined
// into the main archive list, so the everyday list stays light.
export async function GET(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT status, changed_by, changed_at
      FROM sending_status_history
      WHERE access_code_id = ${id}
      ORDER BY changed_at ASC
    `;
    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error("Failed to load sending-status history:", err);
    return NextResponse.json({ error: "تعذّر تحميل السجل. حاول مرة أخرى." }, { status: 500 });
  }
}
