import { Resend } from "resend";
import { PACKAGE_LINKEDIN } from "./staffAccounts";

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

// notification.cv-creators.com is now verified with Resend, so all
// notification emails (staff CV notifications, LinkedIn notifications, ...)
// send from an address on it by default. Override RESEND_FROM_EMAIL /
// RESEND_FROM_NAME if the sending address or display name ever needs to
// change without a code deploy.
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "notifications@notification.cv-creators.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "منصة السيرة الذاتية";
const FROM_ADDRESS = `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`;

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

function buildLinkedinNotificationHtml({ applicantName, sallaOrderNumber, city, phone, requestedPackage, createdAt }) {
  const adminUrl = `${APP_URL}/admin`;
  const rows = [
    ["اسم المتقدم", applicantName],
    ["رقم الطلب", sallaOrderNumber],
    ["الخدمة المطلوبة", requestedPackage],
    ["المدينة", city],
    ["رقم الجوال", phone],
    ["التاريخ", formatArabicDate(createdAt)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<li style="margin-bottom:8px;">• <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join("");

  // LinkedIn-only orders never involve a CV at all; an Integrated order
  // carries a CV too (handled separately by the sending-staff email) —
  // the two are worded differently so LinkedIn staff know which case
  // they're looking at at a glance.
  const introLine =
    requestedPackage === PACKAGE_LINKEDIN
      ? "تم استلام طلب إعداد صفحة لينكدإن احترافية (بدون سيرة ذاتية) وهو بانتظار التنفيذ."
      : "تم استلام طلب يشمل إعداد صفحة لينكدإن احترافية (ضمن باقة تشمل أيضاً سيرة ذاتية) وهو بانتظار التنفيذ.";

  return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3a4a5a; max-width: 480px; margin: 0 auto; line-height: 1.8;">
      <p>مرحباً،</p>
      <p>${introLine}</p>
      <ul style="list-style: none; padding: 0; margin: 16px 0;">${rows}</ul>
      <p style="margin-top: 24px;">
        <a href="${adminUrl}" style="display: inline-block; background: #1a3a5c; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 14px;">
          الدخول إلى لوحة التحكم
        </a>
      </p>
      <p style="color: #8a97a5; font-size: 12px; margin-top: 24px;">يرجى الدخول إلى لوحة التحكم لمراجعة الطلب.</p>
    </div>
  `;
}

function buildAdminStatusChangeHtml({ trackLabel, applicantName, code, sallaOrderNumber, requestedPackage, oldStatusLabel, newStatusLabel, changedByLabel, changedAt }) {
  const adminUrl = `${APP_URL}/admin`;
  const rows = [
    ["اسم المتقدم", applicantName],
    ["الكود", code],
    ["رقم الطلب", sallaOrderNumber],
    ["الخدمة المطلوبة", requestedPackage],
    ["المسار", trackLabel],
    ["تم التغيير بواسطة", changedByLabel],
    ["التاريخ", formatArabicDate(changedAt)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<li style="margin-bottom:8px;">• <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
    .join("");

  return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3a4a5a; max-width: 480px; margin: 0 auto; line-height: 1.8;">
      <p>مرحباً،</p>
      <p>تغيّرت حالة أحد الطلبات:</p>
      <p style="font-size: 15px; font-weight: 700; color: #1a3a5c; background: #f5f7fa; border-radius: 8px; padding: 12px 16px;">
        من: ${escapeHtml(oldStatusLabel || "—")}<br/>
        إلى: ${escapeHtml(newStatusLabel)}
      </p>
      <ul style="list-style: none; padding: 0; margin: 16px 0;">${rows}</ul>
      <p style="margin-top: 24px;">
        <a href="${adminUrl}" style="display: inline-block; background: #1a3a5c; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 14px;">
          الدخول إلى لوحة التحكم
        </a>
      </p>
    </div>
  `;
}

/**
 * Notifies one sending-staff recipient by email that a new CV has been
 * archived and is pending sending. Throws on failure — callers that must
 * not let this affect a user-facing flow (CV generation/download) are
 * responsible for catching it, same as any other best-effort background
 * step. `to` is resolved by the caller (active sending-staff accounts'
 * emails, see lib/cvArchive.js) rather than read from an env var here.
 */
export async function sendStaffCvNotification({ to, applicantName, sallaOrderNumber, targetRole, city, createdAt }) {
  if (!to) {
    console.warn("Skipping CV notification email: no recipient given.");
    return;
  }

  const client = getResendClient();
  const result = await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `📄 سيرة ذاتية جديدة بانتظار الإرسال — طلب #${sallaOrderNumber || "—"}`,
    html: buildNotificationHtml({ applicantName, sallaOrderNumber, targetRole, city, createdAt }),
  });

  if (result.error) {
    throw new Error(`Resend API error: ${result.error.message || JSON.stringify(result.error)}`);
  }
}

/**
 * Notifies the single configured admin address that an order's status
 * changed, on either track, at any stage — see lib/adminStatusNotifications.js
 * for the enable flag, per-track stage list, and recipient resolution.
 * Same throw/catch contract as the two functions above: this throws on a
 * genuine Resend failure, and lib/adminStatusNotifications.js is
 * responsible for catching it so a failed admin notification never affects
 * the status change that triggered it.
 */
export async function sendAdminStatusChangeNotification({ to, trackLabel, applicantName, code, sallaOrderNumber, requestedPackage, oldStatusLabel, newStatusLabel, changedByLabel, changedAt }) {
  if (!to) {
    console.warn("Skipping admin status-change notification: no recipient given.");
    return;
  }

  const client = getResendClient();
  const result = await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `🔔 تغيير حالة طلب: ${newStatusLabel}${sallaOrderNumber ? ` — طلب #${sallaOrderNumber}` : code ? ` — ${code}` : ""}`,
    html: buildAdminStatusChangeHtml({ trackLabel, applicantName, code, sallaOrderNumber, requestedPackage, oldStatusLabel, newStatusLabel, changedByLabel, changedAt }),
  });

  if (result.error) {
    throw new Error(`Resend API error: ${result.error.message || JSON.stringify(result.error)}`);
  }
}

/**
 * Notifies one LinkedIn-staff recipient by email that a LinkedIn page
 * order is awaiting work — either standalone (LinkedIn-only package) or
 * alongside a CV (Integrated package). Same throw/catch contract as
 * sendStaffCvNotification above.
 */
export async function sendLinkedinNotification({ to, applicantName, sallaOrderNumber, city, phone, requestedPackage, createdAt }) {
  if (!to) {
    console.warn("Skipping LinkedIn notification email: no recipient given.");
    return;
  }

  const client = getResendClient();
  const result = await client.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `🔗 طلب لينكدإن جديد بانتظار التنفيذ — طلب #${sallaOrderNumber || "—"}`,
    html: buildLinkedinNotificationHtml({ applicantName, sallaOrderNumber, city, phone, requestedPackage, createdAt }),
  });

  if (result.error) {
    throw new Error(`Resend API error: ${result.error.message || JSON.stringify(result.error)}`);
  }
}
