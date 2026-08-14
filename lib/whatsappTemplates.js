// Auto-generated, copy-ready WhatsApp message shown per order in the admin
// panel — built server-side (see every app/api/admin/* route that returns
// an order/code record) from that record's name/code/package, so the
// client only ever displays what the server already computed.
//
// Every wording tweak belongs in ONE of the three template strings below —
// nothing else in the codebase needs to change to edit what customers see.
import { PACKAGE_LINKEDIN, PACKAGE_INTEGRATED } from "./staffAccounts";

// Public URL of the CV-builder platform, shown to the customer so they can
// open it and enter their code. A single configurable constant/env var, so
// it's easy to change without a code deploy — falls back to the existing
// APP_URL convention already used for staff notification emails (see
// lib/email.js) so a deployment that only set that one still works, then
// to a placeholder as a last resort (never throws — a best-effort message
// beats no message).
export const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || process.env.APP_URL || "https://your-domain.example";

const CV_ONLY_TEMPLATE = `مرحبًا {name} 👋
شكرًا لطلبك خدمة إعداد السيرة الذاتية الاحترافية.
للبدء:
🔗 الرابط: {link}
🔑 الكود: {code}
اختر اللغة، وارفع سيرتك أو ابدأ من الصفر، ثم صدّر سيرتك الاحترافية.
بعدها سنرسلها للشركات المستهدفة ونوافيك بالتقرير خلال 72 ساعة عبر واتساب.
في خدمتك لأي استفسار 🤝`;

const INTEGRATED_TEMPLATE = `مرحبًا {name} 👋
شكرًا لطلبك خدمة إعداد السيرة الذاتية الاحترافية.
للبدء:
🔗 الرابط: {link}
🔑 الكود: {code}
اختر اللغة، وارفع سيرتك أو ابدأ من الصفر، ثم صدّر سيرتك الاحترافية.
بعدها سنرسلها للشركات المستهدفة ونوافيك بالتقرير خلال 72 ساعة عبر واتساب.
وبعد إصدار سيرتك، سيتواصل معك ممثل خدمة العملاء لتجهيز ملفك على لينكدإن 💼
في خدمتك لأي استفسار 🤝`;

const LINKEDIN_ONLY_TEMPLATE = `مرحبًا {name} 👋
شكرًا لطلبك خدمة تجهيز ملف لينكدإن الاحترافي.
سيتواصل معك ممثل خدمة العملاء قريبًا عبر واتساب لتجهيز ملفك على لينكدإن وأخذ التفاصيل اللازمة 💼
في خدمتك لأي استفسار 🤝`;

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Picks the right template by requestedPackage and fills in {name}/{code}/
 * {link}. requestedPackage === PACKAGE_LINKEDIN is the only case with no
 * code/link (a LinkedIn-only order never uses the platform); everything
 * else — CV Arabic, CV English, Integrated, or no package set at all
 * (e.g. a Salla-webhook order) — gets the CV template, matching how the
 * rest of the app already treats an unset package as the default
 * CV/sending case (see packageNotifiesSending in lib/staffAccounts.js).
 */
export function buildWhatsappMessage({ name, code, requestedPackage }) {
  const safeName = String(name || "").trim() || "عميلنا العزيز";

  if (requestedPackage === PACKAGE_LINKEDIN) {
    return fill(LINKEDIN_ONLY_TEMPLATE, { name: safeName });
  }

  const template = requestedPackage === PACKAGE_INTEGRATED ? INTEGRATED_TEMPLATE : CV_ONLY_TEMPLATE;
  return fill(template, { name: safeName, code: code || "", link: APP_PUBLIC_URL });
}
