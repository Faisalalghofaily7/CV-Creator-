import { Resend } from "resend";

// Server-only. Never import this file from a "use client" component.
let cached;

function getResendClient() {
  if (!cached) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set.");
    }
    cached = new Resend(apiKey);
  }
  return cached;
}

// Resend's shared test/onboarding sender — the only one usable before a
// custom domain is verified with Resend. Override with NOTIFICATION_FROM_EMAIL
// once one is connected; nothing else needs to change.
const FROM_EMAIL = process.env.NOTIFICATION_FROM_EMAIL || "onboarding@resend.dev";

// Vercel sets this automatically to the project's stable production
// domain (unlike VERCEL_URL, which is the current deployment's own,
// changing URL) — falls back to APP_URL for a manual override, then to
// localhost for local dev.
const APP_URL =
  process.env.APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatArabicDate(value) {
  if (!value) return "";
  try {
    // -u-nu-latn forces Western digits, matching the rest of the app's
    // Arabic UI (which never uses Arabic-Indic numerals).
    return new Date(value).toLocaleString("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(value);
  }
}

function buildNotificationHtml({ applicantName, sallaOrderNumber, targetRole, city, createdAt }) {
  const adminUrl = `${APP_URL}/admin`;
  const rows = [
    ["اسم المتقدم", applicantName],
    ["رقم الطلب", sallaOrderNumber],
    ["الوظيفة المستهدفة", targetRole],
    ["المدينة", city],
    ["التاريخ", formatArabicDate(createdAt)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<li style="margin-bottom:8px;">• <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join("");

  return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3a4a5a; max-width: 480px; margin: 0 auto; line-height: 1.8;">
      <p>مرحباً،</p>
      <p>تم إنشاء سيرة ذاتية جديدة وهي بانتظار الإرسال.</p>
      <ul style="list-style: none; padding: 0; margin: 16px 0;">${rows}</ul>
      <p style="margin-top: 24px;">
        <a href="${adminUrl}" style="display: inline-block; background: #1a3a5c; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 14px;">
          الدخول إلى لوحة التحكم
        </a>
      </p>
      <p style="color: #8a97a5; font-size: 12px; margin-top: 24px;">يرجى الدخول إلى لوحة التحكم لمراجعة السيرة وإرسالها.</p>
    </div>
  `;
}

/**
 * Notifies staff by email that a new CV has been archived and is pending
 * sending. Throws on failure — callers that must not let this affect a
 * user-facing flow (CV generation/download) are responsible for catching
 * it, same as any other best-effort background step.
 */
export async function sendStaffCvNotification({ applicantName, sallaOrderNumber, targetRole, city, createdAt }) {
  const to = process.env.STAFF_NOTIFICATION_EMAIL;
  if (!to) {
    console.warn("Skipping staff notification email: STAFF_NOTIFICATION_EMAIL is not set.");
    return;
  }

  const client = getResendClient();
  const result = await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `📄 سيرة ذاتية جديدة بانتظار الإرسال — طلب #${sallaOrderNumber || "—"}`,
    html: buildNotificationHtml({ applicantName, sallaOrderNumber, targetRole, city, createdAt }),
  });

  if (result.error) {
    throw new Error(`Resend API error: ${result.error.message || JSON.stringify(result.error)}`);
  }
}
