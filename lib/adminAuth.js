import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getSql } from "./db";

// Server-only. Never import this from a "use client" component.

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 4; // 4 hours

function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    // Cookies marked Secure are dropped by browsers over plain HTTP, which
    // is exactly what local `next dev` uses — only require it in production.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Verifies a username/password pair against the admin credentials
 * (ADMIN_USERNAME / ADMIN_PASSWORD_HASH), the staff_accounts table (real
 * per-person staff accounts managed by the admin), or — for backward
 * compatibility with deployments that haven't migrated yet — the legacy
 * single-shared-account STAFF_USERNAME / STAFF_PASSWORD_HASH env vars.
 * bcrypt hashes throughout; the plain password is never stored or compared
 * directly. Returns `{ role, staffAccountId, staffType }` on success
 * (staffAccountId/staffType are null for admin and for a legacy staff-env
 * login — only a staff_accounts row carries a type), or null if nothing
 * matched. A deactivated staff_accounts row (active = false) never matches.
 */
export async function verifyAdminCredentials(username, password) {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminUsername || !adminHash) {
    throw new Error(
      "ADMIN_USERNAME / ADMIN_PASSWORD_HASH are not configured. See scripts/hash-password.mjs and the README."
    );
  }
  if (username === adminUsername && (await bcrypt.compare(password, adminHash))) {
    return { role: "admin", staffAccountId: null, staffType: null };
  }

  const sql = getSql();
  const [staffAccount] = await sql`
    SELECT id, password_hash, staff_type FROM staff_accounts WHERE username = ${username} AND active = true
  `;
  if (staffAccount && (await bcrypt.compare(password, staffAccount.password_hash))) {
    return { role: "staff", staffAccountId: staffAccount.id, staffType: staffAccount.staff_type };
  }

  const legacyStaffUsername = process.env.STAFF_USERNAME;
  const legacyStaffHash = process.env.STAFF_PASSWORD_HASH;
  if (
    legacyStaffUsername &&
    legacyStaffHash &&
    username === legacyStaffUsername &&
    (await bcrypt.compare(password, legacyStaffHash))
  ) {
    return { role: "staff", staffAccountId: null, staffType: null };
  }

  return null;
}

/** Creates a new session row for the given role (+ staff account, if any) and returns the opaque token + its expiry. */
export async function createAdminSession(role, staffAccountId = null) {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await sql`INSERT INTO admin_sessions (token, role, staff_account_id, expires_at) VALUES (${token}, ${role}, ${staffAccountId}, ${expiresAt.toISOString()})`;
  // Piggyback a cheap cleanup so the table doesn't grow unbounded — no cron needed.
  sql`DELETE FROM admin_sessions WHERE expires_at <= now()`.catch(() => {});
  return { token, expiresAt, maxAgeSeconds: SESSION_TTL_SECONDS };
}

export async function destroyAdminSession(token) {
  if (!token) return;
  const sql = getSql();
  await sql`DELETE FROM admin_sessions WHERE token = ${token}`;
}

async function loadSession(token) {
  if (!token) return null;
  const sql = getSql();
  // LEFT JOIN so an admin session (staff_account_id NULL) and a legacy
  // staff-env session (also NULL) both still resolve — only a session tied
  // to a real staff_accounts row depends on that row. `sa.active` is
  // re-checked on every request, not just at login: deactivating a staff
  // member takes effect immediately, even mid-session, rather than only
  // blocking their *next* login.
  const [row] = await sql`
    SELECT s.role, s.staff_account_id, sa.staff_type, sa.active AS staff_active, sa.username AS staff_username
    FROM admin_sessions s
    LEFT JOIN staff_accounts sa ON sa.id = s.staff_account_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `;
  if (!row) return null;
  if (row.staff_account_id && !row.staff_active) return null;
  return {
    token,
    role: row.role,
    staffAccountId: row.staff_account_id,
    staffType: row.staff_type,
    staffUsername: row.staff_username,
  };
}

/** For Server Components / the /admin page — reads the cookie via next/headers. */
export async function getAdminSession(cookieStore) {
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return loadSession(token);
}

/** For Route Handlers — reads the cookie off the NextRequest. */
export async function getAdminSessionFromRequest(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return loadSession(token);
}

/**
 * Guard for admin API routes: returns an error NextResponse to return
 * immediately if the caller shouldn't proceed, or null if they should.
 * - No valid session at all -> 401.
 * - `requireRole` given and the session's role doesn't match -> 403. Used
 *   to keep the codes endpoints (generating/listing/editing access codes)
 *   admin-only — staff sessions can reach the CV archive routes but not
 *   these, and that boundary is enforced here, not just hidden in the UI.
 */
export async function requireAdminApi(request, { requireRole } = {}) {
  const session = await getAdminSessionFromRequest(request).catch((err) => {
    console.error("Admin session check failed:", err);
    return null;
  });
  if (!session) {
    return NextResponse.json({ error: "يجب تسجيل الدخول كمشرف." }, { status: 401 });
  }
  if (requireRole && session.role !== requireRole) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول إلى هذا القسم." }, { status: 403 });
  }
  return null;
}

export function setSessionCookie(response, token, maxAgeSeconds) {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}
