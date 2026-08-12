// Shared staff-account constants + permission logic — imported by both the
// admin API routes (server) and AdminCodes.jsx (client UI), so the type
// list/labels and the package-scoping rule only ever live in one place.

export const STAFF_TYPES = ["sending", "linkedin"];

export const STAFF_TYPE_LABELS = {
  sending: "إرسال السير الذاتية",
  linkedin: "صفحات لينكدإن",
};

export function isValidStaffType(v) {
  return STAFF_TYPES.includes(v);
}

// The full set of requested-package strings — requested_package is free
// text (see schema.sql), not a foreign key/enum, so every place that needs
// to recognize a specific package (the admin "generate code" dropdown, the
// staff view-scoping rule below, and the notification routing rule in
// lib/cvArchive.js) shares these exact same string constants rather than
// each hard-coding its own copy that could drift out of sync.
export const PACKAGE_INTEGRATED = "باقة الوصول المتكاملة";
export const PACKAGE_CV_ENGLISH = "إعداد سيرة ذاتية باللغة الإنجليزية";
export const PACKAGE_CV_ARABIC = "إعداد سيرة ذاتية باللغة العربية";
export const PACKAGE_LINKEDIN = "إعداد صفحة على لينكدإن احترافية";
export const PACKAGE_OPTIONS = [PACKAGE_INTEGRATED, PACKAGE_CV_ENGLISH, PACKAGE_CV_ARABIC, PACKAGE_LINKEDIN];

// Kept as an alias of PACKAGE_LINKEDIN — pre-existing name, still used by
// staffCanAccessRecord below; not worth renaming every call site for.
export const LINKEDIN_PACKAGE_LABEL = PACKAGE_LINKEDIN;

// A 'linkedin' staff member only sees/updates CVs requesting that exact
// package. A 'sending' staff member gets everything else, including
// records with no package set at all (e.g. Salla-webhook-generated codes,
// which never carry a requested_package) — that's the CV-sending queue by
// default. `staffType` of null/undefined (legacy env-var staff login, or
// the admin role) is unrestricted, matching pre-existing behavior.
export function staffCanAccessRecord(staffType, requestedPackage) {
  if (!staffType) return true;
  if (staffType === "linkedin") return requestedPackage === PACKAGE_LINKEDIN;
  return requestedPackage !== PACKAGE_LINKEDIN;
}

// Notification routing (lib/cvArchive.js): which staff type(s) should be
// emailed when a CV/order for a given package is archived. The Integrated
// package covers both a CV and a LinkedIn page, so both types are
// notified; an unset/unrecognized package (e.g. a Salla-webhook order that
// never carries a package) defaults to the sending queue, same default as
// staffCanAccessRecord above.
export function packageNotifiesSending(requestedPackage) {
  return requestedPackage !== PACKAGE_LINKEDIN;
}
export function packageNotifiesLinkedin(requestedPackage) {
  return requestedPackage === PACKAGE_LINKEDIN || requestedPackage === PACKAGE_INTEGRATED;
}

// Same rule already used by the CV builder's own applicant-email field
// (components/AtsCvBuilder.jsx) — kept identical so "a valid email" means
// the same thing everywhere in the app.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
export function isValidStaffEmail(v) {
  return EMAIL_RE.test(String(v || "").trim());
}
