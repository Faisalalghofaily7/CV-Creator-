import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";

export const runtime = "nodejs";

// NOTE: the admin login gating the /admin page is still the client-side
// mock (hardcoded demo credentials, no session/token). These endpoints are
// not yet protected by real server-side auth — that's a follow-up step,
// not something this change covers.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode() {
  const seg = (n) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  return `CV-${seg(4)}-${seg(4)}`;
}

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT id, code, salla_order_number, status, created_at, used_at
      FROM access_codes
      ORDER BY created_at DESC
    `;
    return NextResponse.json({ codes: rows });
  } catch (err) {
    console.error("Failed to list access codes:", err);
    return NextResponse.json({ error: "تعذّر الاتصال بقاعدة البيانات. حاول مرة أخرى." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sallaOrderNumber = typeof body.sallaOrderNumber === "string" ? body.sallaOrderNumber.trim() || null : null;

    const sql = getSql();
    // Codes are short and random collisions are rare but not impossible —
    // retry a few times on a unique-constraint violation instead of
    // failing the whole request.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        const [row] = await sql`
          INSERT INTO access_codes (code, salla_order_number, status)
          VALUES (${code}, ${sallaOrderNumber}, 'available')
          RETURNING id, code, salla_order_number, status, created_at, used_at
        `;
        return NextResponse.json({ code: row });
      } catch (err) {
        if (err?.code === "23505" && attempt < 4) continue; // unique_violation on code — retry
        throw err;
      }
    }
    throw new Error("Could not generate a unique code after several attempts.");
  } catch (err) {
    console.error("Failed to create access code:", err);
    return NextResponse.json({ error: "تعذّر إنشاء الكود. حاول مرة أخرى." }, { status: 500 });
  }
}
