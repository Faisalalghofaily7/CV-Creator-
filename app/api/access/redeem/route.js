import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getSql } from "../../../../lib/db";
import { createUserSession, setSessionCookie } from "../../../../lib/userSession";
import { notifyAdminStatusChange } from "../../../../lib/adminStatusNotifications";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return NextResponse.json({ error: "الرجاء إدخال الكود." }, { status: 400 });
    }

    const sql = getSql();
    // Just validates the code — it's already linked to its Salla order
    // (set at admin-generation or by the Salla webhook), so there's
    // nothing left for the user to submit here. Does NOT consume the
    // code — it stays redeemable (available/customer_in_progress) until a
    // PDF is actually exported successfully (see /api/generate-pdf), so
    // refreshing the page or backing out before exporting never costs the
    // user their single-use code.
    const [row] = await sql`
      SELECT id, lifecycle_status, applicant_name, salla_order_number, requested_package
      FROM access_codes
      WHERE code = ${code} AND lifecycle_status IN ('available', 'customer_in_progress')
    `;

    if (!row) {
      return NextResponse.json({ error: "الكود غير صحيح أو مستخدم من قبل." }, { status: 400 });
    }

    // First redemption (not a resume) — advance the automatic lifecycle
    // stage and record it in the timeline. The WHERE guard means a repeat
    // redemption (page refresh, re-entering the code to resume) is a no-op
    // here and never inserts a duplicate history row.
    const [advanced] = await sql`
      UPDATE access_codes SET lifecycle_status = 'customer_in_progress'
      WHERE id = ${row.id} AND lifecycle_status = 'available'
      RETURNING id
    `;
    if (advanced) {
      await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${row.id}, 'customer_in_progress', NULL)`;
      waitUntil(
        notifyAdminStatusChange({
          track: "sending",
          code,
          sallaOrderNumber: row.salla_order_number,
          applicantName: row.applicant_name,
          requestedPackage: row.requested_package,
          oldStatus: "available",
          newStatus: "customer_in_progress",
        })
      );
    }

    // Remembers the validated code in a server-side session so a page
    // refresh can resume the same code instead of forcing re-entry.
    const { token, maxAgeSeconds } = await createUserSession(code);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, token, maxAgeSeconds);
    return res;
  } catch (err) {
    console.error("Failed to validate access code:", err);
    return NextResponse.json({ error: "تعذّر الاتصال بالخادم. حاول مرة أخرى." }, { status: 500 });
  }
}
