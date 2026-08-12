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

// Must exactly match the LinkedIn-page option string in AdminCodes.jsx's
// PACKAGE_OPTIONS — requested_package is free text (see schema.sql), so
// this is a plain string match, not a foreign key/enum.
export const LINKEDIN_PACKAGE_LABEL = "إعداد صفحة على لينكدإن احترافية";

// A 'linkedin' staff member only sees/updates CVs requesting that exact
// package. A 'sending' staff member gets everything else, including
// records with no package set at all (e.g. Salla-webhook-generated codes,
// which never carry a requested_package) — that's the CV-sending queue by
// default. `staffType` of null/undefined (legacy env-var staff login, or
// the admin role) is unrestricted, matching pre-existing behavior.
export function staffCanAccessRecord(staffType, requestedPackage) {
  if (!staffType) return true;
  if (staffType === "linkedin") return requestedPackage === LINKEDIN_PACKAGE_LABEL;
  return requestedPackage !== LINKEDIN_PACKAGE_LABEL;
}
