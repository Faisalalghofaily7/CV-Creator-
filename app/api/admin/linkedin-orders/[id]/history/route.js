import { NextResponse } from "next/server";
import { getSql } from "../../../../../../lib/db";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../../lib/adminAuth";
import { parseCompositeOrderId } from "../../../../../../lib/linkedinOrders";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);
  if (session.role === "staff" && session.staffType === "sending") {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا القسم." }, { status: 403 });
  }

  const parsed = parseCompositeOrderId(params.id);
  if (!parsed) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const rows =
      parsed.sourceType === "linkedin_only"
        ? await sql`
            SELECT status, changed_by, changed_at FROM linkedin_status_history
            WHERE linkedin_order_id = ${parsed.id} ORDER BY changed_at ASC
          `
        : await sql`
            SELECT status, changed_by, changed_at FROM linkedin_status_history
            WHERE access_code_id = ${parsed.id} ORDER BY changed_at ASC
          `;
    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error("Failed to load LinkedIn order history:", err);
    return NextResponse.json({ error: "تعذّر تحميل السجل. حاول مرة أخرى." }, { status: 500 });
  }
}
