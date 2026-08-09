import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSql } from "../../../lib/db";
import { createAccessCode, findAccessCodeBySallaOrder } from "../../../lib/accessCodes";

export const runtime = "nodejs";

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

// order.created's customer fields live directly under data.customer —
// mobile is a bare number (no leading "0", no country code) so it has to
// be combined with mobile_code to be a usable phone number.
function extractOrderCreatedFields(data) {
  const customer = data.customer || {};
  const applicantName = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() || null;
  const applicantPhone = customer.mobile ? `${customer.mobile_code || ""}${customer.mobile}` : null;
  const sallaOrderNumber = data.reference_id != null ? String(data.reference_id) : data.id != null ? String(data.id) : null;
  return { sallaOrderNumber, applicantName, applicantEmail: customer.email || null, applicantPhone };
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
      const { sallaOrderNumber, applicantName, applicantEmail, applicantPhone } = extractOrderCreatedFields(data);

      if (!sallaOrderNumber) {
        console.warn("[salla-webhook] order.created has no reference_id/id — skipping.");
        return NextResponse.json({ ok: true, skipped: true });
      }

      // Salla redelivers on a non-2xx response and can send duplicates
      // outright — never create a second code for the same order.
      const existing = await findAccessCodeBySallaOrder(sallaOrderNumber);
      if (existing) {
        console.log(`[salla-webhook] order ${sallaOrderNumber} already has code ${existing.code} — duplicate delivery, skipping.`);
        return NextResponse.json({ ok: true, code: existing.code, duplicate: true });
      }

      const row = await createAccessCode({ sallaOrderNumber, applicantName, applicantEmail, applicantPhone });
      console.log(`[salla-webhook] created code ${row.code} for Salla order ${sallaOrderNumber}`);
      return NextResponse.json({ ok: true, code: row.code });
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

      const sql = getSql();
      // Informational only — does not touch `status` (code redemption) or
      // `sending_status` (staff CV-sending progress), which mean something
      // entirely different and must never be driven by Salla's order state.
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
