import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSql } from "../../../../../lib/db";
import { requireAdminApi } from "../../../../../lib/adminAuth";
import { isValidStaffType } from "../../../../../lib/staffAccounts";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

// Partial update: display name, username, staff type, active (deactivate/
// reactivate), and/or a new password — any subset, all optional. A field
// key that's simply absent from the body is left unchanged (COALESCE onto
// the existing column); a key that IS present but invalid (e.g. an empty
// username) is rejected with a 400 rather than silently ignored.
export async function PATCH(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    const hasUsername = typeof body.username === "string";
    const username = hasUsername ? body.username.trim() : null;
    if (hasUsername && !username) {
      return NextResponse.json({ error: "اسم المستخدم لا يمكن أن يكون فارغاً." }, { status: 400 });
    }

    const hasDisplayName = typeof body.displayName === "string";
    const displayName = hasDisplayName ? body.displayName.trim() : null;
    if (hasDisplayName && !displayName) {
      return NextResponse.json({ error: "اسم الموظف لا يمكن أن يكون فارغاً." }, { status: 400 });
    }

    const hasStaffType = body.staffType !== undefined;
    const staffType = hasStaffType ? body.staffType : null;
    if (hasStaffType && !isValidStaffType(staffType)) {
      return NextResponse.json({ error: "نوع الموظف غير صالح." }, { status: 400 });
    }

    const hasActive = typeof body.active === "boolean";
    const active = hasActive ? body.active : null;

    let newPasswordHash = null;
    if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
      if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
        return NextResponse.json({ error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل.` }, { status: 400 });
      }
      newPasswordHash = await bcrypt.hash(body.newPassword, 12);
    }

    const sql = getSql();
    const [row] = await sql`
      UPDATE staff_accounts
      SET username = COALESCE(${username}, username),
          display_name = COALESCE(${displayName}, display_name),
          staff_type = COALESCE(${staffType}, staff_type),
          active = COALESCE(${active}, active),
          password_hash = COALESCE(${newPasswordHash}, password_hash)
      WHERE id = ${id}
      RETURNING id, username, display_name, staff_type, active, created_at
    `;
    if (!row) {
      return NextResponse.json({ error: "الموظف غير موجود." }, { status: 404 });
    }

    // Deactivating (or changing the account out from under an open session)
    // takes effect immediately — loadSession() already re-checks `active`
    // on every request, but dropping the session rows here means a
    // deactivated/edited staff member can't keep using an already-open tab
    // at all, not just be silently blocked on their next API call.
    if (hasActive && active === false) {
      await sql`DELETE FROM admin_sessions WHERE staff_account_id = ${id}`;
    }

    return NextResponse.json({ staff: row });
  } catch (err) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "اسم المستخدم هذا مستخدم بالفعل." }, { status: 409 });
    }
    console.error("Failed to update staff account:", err);
    return NextResponse.json({ error: "تعذّر تحديث حساب الموظف. حاول مرة أخرى." }, { status: 500 });
  }
}

// Deletes a staff account outright. If the account appears anywhere in
// sending_status_history (changed_by is plain text, not a foreign key —
// deleting never breaks it), the caller gets a warning + count instead of
// an immediate delete, unless they pass ?force=true to confirm — mirrors
// the UI's "prefer deactivation, but allow deletion if you insist" flow.
export async function DELETE(request, { params }) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "معرّف غير صالح." }, { status: 400 });
  }

  const force = new URL(request.url).searchParams.get("force") === "true";

  try {
    const sql = getSql();
    const [account] = await sql`SELECT username FROM staff_accounts WHERE id = ${id}`;
    if (!account) {
      return NextResponse.json({ error: "الموظف غير موجود." }, { status: 404 });
    }

    if (!force) {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM sending_status_history WHERE changed_by = ${account.username}
      `;
      if (count > 0) {
        return NextResponse.json(
          {
            warning: true,
            historyCount: count,
            error: `هذا الموظف موجود في ${count} سجل من سجلات تغيير الحالة. يُفضّل تعطيل الحساب بدلاً من حذفه للحفاظ على السجل الزمني. إن كنت متأكداً من الحذف، أعد المحاولة مع التأكيد.`,
          },
          { status: 409 }
        );
      }
    }

    // Historical rows (sending_status_history.changed_by) are plain text —
    // deleting the account never touches or breaks them; their name simply
    // stays in the history as-is, exactly as before the account existed.
    await sql`DELETE FROM admin_sessions WHERE staff_account_id = ${id}`;
    await sql`DELETE FROM staff_accounts WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete staff account:", err);
    return NextResponse.json({ error: "تعذّر حذف حساب الموظف. حاول مرة أخرى." }, { status: 500 });
  }
}
