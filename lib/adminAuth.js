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
 * Verifies a username/password pair against ADMIN_USERNAME and
 * ADMIN_PASSWORD_HASH (a bcrypt hash — the plain password is never stored
 * or compared directly).
 */
export async function verifyAdminCredentials(username, password) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedUsername || !passwordHash) {
    throw new Error(
      "ADMIN_USERNAME / ADMIN_PASSWORD_HASH are not configured. See scripts/hash-password.mjs and the README."
    );
  }
  if (username !== expectedUsername) return false;
  return bcrypt.compare(password, passwordHash);
}

/** Creates a new session row and returns the opaque token + its expiry. */
export async function createAdminSession() {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await sql`INSERT INTO admin_sessions (token, expires_at) VALUES (${token}, ${expiresAt.toISOString()})`;
  // Piggyback a cheap cleanup so the table doesn't grow unbounded — no cron needed.
  sql`DELETE FROM admin_sessions WHERE expires_at <= now()`.catch(() => {});
  return { token, expiresAt, maxAgeSeconds: SESSION_TTL_SECONDS };
}

export async function destroyAdminSession(token) {
  if (!token) return;
  const sql = getSql();
  await sql`DELETE FROM admin_sessions WHERE token = ${token}`;
}

async function isSessionValid(token) {
  if (!token) return false;
  const sql = getSql();
  const [row] = await sql`SELECT token FROM admin_sessions WHERE token = ${token} AND expires_at > now()`;
  return !!row;
}

/** For Server Components / the /admin page — reads the cookie via next/headers. */
export async function getAdminSession(cookieStore) {
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!(await isSessionValid(token))) return null;
  return { token };
}

/** For Route Handlers — reads the cookie off the NextRequest. */
export async function getAdminSessionFromRequest(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!(await isSessionValid(token))) return null;
  return { token };
}

/**
 * Guard for admin API routes: returns a 401 NextResponse to return
 * immediately if there's no valid session, or null if the caller is
 * authenticated and the route should proceed.
 */
export async function requireAdminApi(request) {
  const session = await getAdminSessionFromRequest(request).catch((err) => {
    console.error("Admin session check failed:", err);
    return null;
  });
  if (!session) {
    return NextResponse.json({ error: "يجب تسجيل الدخول كمشرف." }, { status: 401 });
  }
  return null;
}

export function setSessionCookie(response, token, maxAgeSeconds) {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}
