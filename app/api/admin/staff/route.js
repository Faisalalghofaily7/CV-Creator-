import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSql } from "../../../../lib/db";
import { requireAdminApi } from "../../../../lib/adminAuth";
import { isValidStaffType } from "../../../../lib/staffAccounts";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

export async function GET(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const sql = getSql();
    // password_hash is never selected — there is no "view password"
    // feature, only "set a new one" (see PATCH below).
    const rows = await sql`
      SELECT id, username, display_name, staff_type, active, created_at
      FROM staff_accounts
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ staff: rows });
  } catch (err) {
    console.error("Failed to list staff accounts:", err);
    return NextResponse.json({ error: "تعذّر تحميل قائمة الموظفين." }, { status: 500 });
  }
}

export async function POST(request) {
  const authError = await requireAdminApi(request, { requireRole: "admin" });
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const staffType = body.staffType;

    if (!username) return NextResponse.json({ error: "اسم المستخدم مطلوب." }, { status: 400 });
    if (!displayName) return NextResponse.json({ error: "اسم الموظف مطلوب." }, { status: 400 });
    if (!isValidStaffType(staffType)) return NextResponse.json({ error: "نوع الموظف غير صالح." }, { status: 400 });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل.` }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const sql = getSql();
    const [row] = await sql`
      INSERT INTO staff_accounts (username, password_hash, display_name, staff_type)
      VALUES (${username}, ${passwordHash}, ${displayName}, ${staffType})
      RETURNING id, username, display_name, staff_type, active, created_at
    `;
    return NextResponse.json({ staff: row });
  } catch (err) {
    if (err?.code === "23505") {
      return NextResponse.json({ error: "اسم المستخدم هذا مستخدم بالفعل." }, { status: 409 });
    }
    console.error("Failed to create staff account:", err);
    return NextResponse.json({ error: "تعذّر إنشاء حساب الموظف. حاول مرة أخرى." }, { status: 500 });
  }
}
