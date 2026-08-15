// Normalizes a Saudi phone number (as typed/stored in any of the formats
// staff enter it in — "+966556955107", "0556955107", "00966556955107", or
// already-bare "966556955107") into the digits-only shape wa.me requires.
// Client-safe (no DB/server imports) — used by components/AdminCodes.jsx
// wherever a customer phone number is displayed.
export function normalizePhoneForWhatsapp(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/[+\s\-()]/g, "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00966")) {
    digits = digits.slice(2);
  } else if (!digits.startsWith("966") && /^0\d{9}$/.test(digits)) {
    digits = "966" + digits.slice(1);
  }

  return digits;
}
