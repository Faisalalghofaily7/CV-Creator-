import crypto from "crypto";
import { getSql } from "./db";

// Server-only — never import this from a "use client" component. Tracks
// which access code a browser has already validated at the gate, so a page
// refresh mid-form doesn't force the user back to re-enter (and risk
// losing) their single-use code. The code itself is NOT marked 'used' here
// — only a successful PDF export does that (see /api/generate-pdf).

export const SESSION_COOKIE = "cv_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h — plenty of time to fill out the form

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

/** Creates a new session row tying an opaque token to a validated code. */
export async function createUserSession(code) {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await sql`INSERT INTO user_sessions (token, code, expires_at) VALUES (${token}, ${code}, ${expiresAt.toISOString()})`;
  // Piggyback a cheap cleanup so the table doesn't grow unbounded — no cron needed.
  sql`DELETE FROM user_sessions WHERE expires_at <= now()`.catch(() => {});
  return { token, maxAgeSeconds: SESSION_TTL_SECONDS };
}

/**
 * Resolves the code tied to a session token, but only while that code is
 * still 'available' — once it's consumed by a successful export (or the
 * session is missing/expired), there's nothing left to resume and the user
 * must go through the gate again with a new code.
 */
export async function getActiveSessionCode(token) {
  if (!token) return null;
  const sql = getSql();
  const [row] = await sql`
    SELECT ac.code
    FROM user_sessions us
    JOIN access_codes ac ON ac.code = us.code
    WHERE us.token = ${token} AND us.expires_at > now() AND ac.status = 'available'
  `;
  return row ? row.code : null;
}

/** Best-effort cleanup once a code is consumed — its sessions are done. */
export async function destroySessionsForCode(code) {
  const sql = getSql();
  await sql`DELETE FROM user_sessions WHERE code = ${code}`.catch((err) =>
    console.error("Failed to clean up user_sessions for a consumed code:", err)
  );
}

export function setSessionCookie(response, token, maxAgeSeconds) {
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}
