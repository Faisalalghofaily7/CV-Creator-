import { NextResponse } from "next/server";
import { requireAdminApi, getAdminSessionFromRequest } from "../../../../../lib/adminAuth";
import { parseCompositeOrderId } from "../../../../../lib/linkedinOrders";
import { deleteAccessCodeRecord, deleteLinkedinOrderRecord } from "../../../../../lib/recordDeletion";

export const runtime = "nodejs";

// Permanent deletion for either kind of record the merged LinkedIn panel
// shows — a standalone linkedin_orders row, or the whole access_codes row
// behind an Integrated-package "cv-N" entry (there's no separate
// "LinkedIn order" for that case; it's the same underlying record already
// deletable from the codes/archive tabs, see app/api/admin/codes/[id]/route.js).
// Admin-only, same as every other delete in this app.
export async function DELETE(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;
  const session = await getAdminSessionFromRequest(request);

  const parsed = parseCompositeOrderId(params.id);
  if (!parsed) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const deletedBy = session?.staffUsername || process.env.ADMIN_USERNAME || null;
    const deleted =
      parsed.sourceType === "linkedin_only"
        ? await deleteLinkedinOrderRecord(parsed.id, deletedBy)
        : await deleteAccessCodeRecord(parsed.id, deletedBy);
    if (!deleted) {
      return NextResponse.json({ error: "الطلب غير موجود." }, { status: 404 });
    }
    console.log(`[admin-delete] ${parsed.sourceType} id=${parsed.id} deleted by ${deletedBy}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete LinkedIn order:", err);
    return NextResponse.json({ error: "تعذّر حذف الطلب. حاول مرة أخرى." }, { status: 500 });
  }
}
