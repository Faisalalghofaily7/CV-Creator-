import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSql } from "../../../lib/db";
import { createAccessCode, findAccessCodeBySallaOrder } from "../../../lib/accessCodes";

export const runtime = "nodejs";

// Salla's stable, machine-readable slug for "تحت المراجعة" / "under
// review" — the first real stage after an order is placed. Display names
// (Arabic label, "customized" overrides) vary and are merchant-editable,
// so the slug is the only reliable thing to match on.
const UNDER_REVIEW_SLUG = "under_review";

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a || "", "utf8");
  const bufB = Buffer.from(b || "", "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Salla supports two webhook auth strategies depending on how the merchant
// configured it: an HMAC-SHA256 of the raw body in `x-salla-signature`, or
// a plain shared secret sent verbatim in `Authorization` (no hashing —
// a dashboard-created webhook's "Custom Header" is this second kind).
// Supporting both means this endpoint works regardless of which the
// merchant's dashboard actually exposes.
function verifySallaWebhook(request, rawBody) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[salla-webhook] rejected: SALLA_WEBHOOK_SECRET is not set.");
    return false;
  }

  const signatureHeader = request.headers.get("x-salla-signature");
  if (signatureHeader) {
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    return timingSafeEqualStrings(expected, signatureHeader);
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token) {
    return timingSafeEqualStrings(token, secret);
  }

  return false;
}

// mobile is a bare number (no leading "0", no country code) in both
// order.created's data.customer and order.status.updated's data.order.customer
// — has to be combined with mobile_code to be a usable phone number.
function extractCustomerFields(customer = {}) {
  const applicantName = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null;
  const applicantPhone = customer.mobile ? `${customer.mobile_code || ""}${customer.mobile}` : null;
  return { applicantName, applicantEmail: customer.email || null, applicantPhone };
}

/**
 * The single place code generation happens, regardless of which event
 * delivered the "under_review" status (an order can already be under
 * review in its very first order.created delivery, or reach it later via
 * order.status.updated). Idempotent: one order never gets a second code,
 * whether from a genuine re-review or a redelivered/duplicate event.
 */
async function generateCodeIfUnderReview({ sallaOrderNumber, statusSlug, customer }) {
  if (statusSlug !== UNDER_REVIEW_SLUG || !sallaOrderNumber) {
    return { generated: false };
  }

  const existing = await findAccessCodeBySallaOrder(sallaOrderNumber);
  if (existing) {
    console.log(`[salla-webhook] order ${sallaOrderNumber} already has code ${existing.code} — skipping (already generated).`);
    return { generated: false, code: existing.code };
  }

  const { applicantName, applicantEmail, applicantPhone } = extractCustomerFields(customer);
  const row = await createAccessCode({
    sallaOrderNumber,
    applicantName,
    applicantEmail,
    applicantPhone,
    sallaOrderStatus: statusSlug,
  });
  console.log(`[salla-webhook] order ${sallaOrderNumber} reached under_review — generated code ${row.code} (phone: ${applicantPhone || "—"})`);
  return { generated: true, code: row.code };
}

export async function POST(request) {
  const rawBody = await request.text();

  if (!verifySallaWebhook(request, rawBody)) {
    console.warn("[salla-webhook] rejected: invalid or missing signature/token.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[salla-webhook] failed to parse JSON body:", err);
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const event = payload?.event;
  // Logged in full so the exact Salla payload shape can be inspected during
  // setup — Salla's own docs are inconsistent about field placement between
  // event types, so seeing a real delivery is the reliable way to confirm it.
  console.log(`[salla-webhook] received "${event}":`, JSON.stringify(payload));

  try {
    if (event === "order.created") {
      const data = payload.data || {};
      const sallaOrderNumber = data.reference_id != null ? String(data.reference_id) : data.id != null ? String(data.id) : null;
      const statusSlug = data.status?.slug || null;

      if (!sallaOrderNumber) {
        console.warn("[salla-webhook] order.created has no reference_id/id — skipping.");
        return NextResponse.json({ ok: true, skipped: true });
      }

      const result = await generateCodeIfUnderReview({ sallaOrderNumber, statusSlug, customer: data.customer });
      if (result.generated) return NextResponse.json({ ok: true, code: result.code });
      if (result.code) return NextResponse.json({ ok: true, code: result.code, duplicate: true });

      // A brand-new order not yet under review (e.g. still payment_pending)
      // — nothing to do until a later order.status.updated reaches it.
      console.log(`[salla-webhook] order ${sallaOrderNumber} created with status "${statusSlug}" — not under_review yet, no code generated.`);
      return NextResponse.json({ ok: true, skipped: true });
    }

    if (event === "order.status.updated") {
      // Different shape from order.created: the order itself is nested
      // under data.order, not at the top of data — data.id here is the
      // status-change record's own id, not the order's.
      const order = payload.data?.order || {};
      const sallaOrderNumber = order.reference_id != null ? String(order.reference_id) : order.id != null ? String(order.id) : null;
      const statusSlug = order.status?.slug || null;

      if (!sallaOrderNumber) {
        console.warn("[salla-webhook] order.status.updated has no order reference — skipping.");
        return NextResponse.json({ ok: true, skipped: true });
      }

      const result = await generateCodeIfUnderReview({ sallaOrderNumber, statusSlug, customer: order.customer });
      if (result.generated) {
        return NextResponse.json({ ok: true, code: result.code });
      }

      // Not a fresh under_review generation (already had a code, or this
      // particular status isn't under_review) — keep the informational
      // status column current either way. Never touches `status` (code
      // redemption) or `sending_status` (staff CV-sending progress), which
      // mean something entirely different from Salla's order lifecycle.
      const sql = getSql();
      const [updated] = await sql`
        UPDATE access_codes
        SET salla_order_status = ${statusSlug}
        WHERE salla_order_number = ${sallaOrderNumber}
        RETURNING id
      `;

      if (!updated) {
        console.warn(`[salla-webhook] order.status.updated for ${sallaOrderNumber} (${statusSlug}) — no matching access_codes row.`);
        return NextResponse.json({ ok: true, skipped: true });
      }

      console.log(`[salla-webhook] order ${sallaOrderNumber} status -> ${statusSlug}`);
      return NextResponse.json({ ok: true });
    }

    // Any other event this endpoint might receive — acknowledge without
    // retrying forever, since Salla treats anything but 200/201 as failed.
    console.log(`[salla-webhook] unhandled event "${event}" — acknowledged, no action taken.`);
    return NextResponse.json({ ok: true, ignored: true });
  } catch (err) {
    console.error("[salla-webhook] handler failed:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
