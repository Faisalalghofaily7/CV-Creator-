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
 * Verifies a username/password pair against either the admin credentials
 * (ADMIN_USERNAME / ADMIN_PASSWORD_HASH) or, if configured, the staff
 * credentials (STAFF_USERNAME / STAFF_PASSWORD_HASH) — bcrypt hashes, the
 * plain password is never stored or compared directly. Returns which role
 * matched ("admin" | "staff"), or null if neither did. Staff credentials
 * are optional: a deployment that hasn't set STAFF_USERNAME/
 * STAFF_PASSWORD_HASH simply has no staff login, same as before this role
 * split existed.
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
    return "admin";
  }

  const staffUsername = process.env.STAFF_USERNAME;
  const staffHash = process.env.STAFF_PASSWORD_HASH;
  if (staffUsername && staffHash && username === staffUsername && (await bcrypt.compare(password, staffHash))) {
    return "staff";
  }

  return null;
}

/** Creates a new session row for the given role and returns the opaque token + its expiry. */
export async function createAdminSession(role) {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await sql`INSERT INTO admin_sessions (token, role, expires_at) VALUES (${token}, ${role}, ${expiresAt.toISOString()})`;
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
  const [row] = await sql`SELECT role FROM admin_sessions WHERE token = ${token} AND expires_at > now()`;
  return row ? { token, role: row.role } : null;
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
