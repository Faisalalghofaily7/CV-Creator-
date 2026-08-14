import fs from "fs";
import { NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
import { waitUntil } from "@vercel/functions";
import { buildCvHtml } from "../../../lib/cvHtmlTemplate";
import { archiveGeneratedPdf } from "../../../lib/cvArchive";
import { getSql } from "../../../lib/db";
import { destroySessionsForCode, clearSessionCookie } from "../../../lib/userSession";

export const runtime = "nodejs";
export const maxDuration = 30;

// Reused across warm invocations of the same serverless instance — Chromium
// cold start (extracting/launching the @sparticuz/chromium binary) is the
// single biggest cost in this route, so paying it once per warm container
// instead of once per request cuts most requests' latency dramatically.
// Only the browser is cached; each request still gets its own fresh page.
let cachedBrowser = null;

async function launchBrowser() {
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    // @sparticuz/chromium ships a Chromium binary built for AWS/Vercel's
    // serverless Linux runtime — only import it there, since it can't run
    // (and isn't installed as a normal binary) on a regular dev machine.
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  const localExecutablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(
      (p) => fs.existsSync(p)
    );

  if (!localExecutablePath) {
    throw new Error(
      "No local Chrome/Chromium found for PDF generation. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to your browser's executable."
    );
  }

  // --no-sandbox is standard practice for a short-lived headless instance
  // rendering only our own generated HTML (never arbitrary/untrusted pages);
  // it's also required when the dev process itself runs as root.
  return puppeteer.launch({ executablePath: localExecutablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
}

// Returns a live, reusable browser instance, relaunching only if there's no
// cached one yet or the cached one died (crashed, or the container recycled
// it) — `.connected` is the cheap health check for the latter.
async function getBrowser() {
  if (cachedBrowser && cachedBrowser.connected) return cachedBrowser;
  cachedBrowser = await launchBrowser();
  return cachedBrowser;
}

// page.setContent(..., {waitUntil:"load"}) does NOT guarantee the embedded
// @font-face fonts (Tajawal, base64 data: URIs, split into separate
// Arabic-range/Latin-range/regular/bold faces — see cvHtmlTemplate.js) have
// actually finished loading by the time it resolves: font decoding runs on
// its own schedule, off the "load" event. Calling page.pdf() before that
// finishes can print text in a not-yet-ready face as completely invisible
// instead of falling back to a visible font — reproduced directly (~1 in 9
// local renders raced blank). document.fonts.ready is the standard fix,
// but as belt-and-suspenders: (1) it's raced against a short timeout so a
// pathological hang here can never block the whole request past
// maxDuration, and (2) every declared face is explicitly told to load by
// name afterward — document.fonts.ready only resolves for fonts already
// requested by layout at the time it's read, so a face the initial layout
// didn't happen to touch yet could still be missed by (1) alone.
const FONT_READY_TIMEOUT_MS = 5000;
async function ensureFontsReady(page) {
  await Promise.race([
    page.evaluate(() => document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, FONT_READY_TIMEOUT_MS)),
  ]);

  // Explicitly (re-)request every weight, with a sample string covering
  // both the Arabic-range and Latin-range faces, so all four @font-face
  // variants are force-loaded regardless of what the initial layout pass
  // happened to touch.
  const allLoaded = await page.evaluate(async () => {
    const sample = "أA"; // one Arabic + one Latin codepoint
    await Promise.all([
      document.fonts.load("400 13px Tajawal", sample).catch(() => {}),
      document.fonts.load("700 13px Tajawal", sample).catch(() => {}),
    ]);
    return document.fonts.status === "loaded";
  });

  if (!allLoaded) {
    // Never seen in testing, but if it ever happens, this is exactly the
    // condition that used to ship a blank CV — worth knowing about even
    // though we still proceed (a slightly-late font beats blocking the
    // customer's download indefinitely).
    console.warn("[PDF-FONTS] fonts not fully loaded after the wait — printing anyway.");
  }
}

export async function POST(request) {
  const t0 = Date.now();
  const timings = {};
  let page;
  try {
    const body = await request.json();
    const { form, experiences, education, courses, certifications, customSections, techSkills, softSkills, lang, accessCode } = body;

    const code = typeof accessCode === "string" ? accessCode.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "لا يوجد كود دخول صالح لهذه الجلسة." }, { status: 400 });
    }

    // Server-side re-check of the same mandatory fields the client already
    // gates at Preview/Export (see findMissingRequiredFields in
    // AtsCvBuilder.jsx) — never trust the browser alone for something a
    // direct API call could otherwise bypass entirely. Only the fields
    // that are unconditionally mandatory regardless of which step they
    // live on are checked here (name/phone/target role); the date-range
    // and education "Other" checks are pure form-completeness rules with
    // no server-side consequence — an incomplete date or education entry
    // still produces a coherent PDF, so they're left to the client gate.
    const missingFields = [];
    if (!form?.name?.trim()) missingFields.push(lang === "en" ? "Full Name" : "الاسم الكامل");
    if (!form?.phone?.trim()) missingFields.push(lang === "en" ? "Phone Number" : "رقم الجوال");
    if (!form?.targetRoles?.trim()) missingFields.push(lang === "en" ? "Target Role(s)" : "الوظيفة/الوظائف المستهدفة");
    if (missingFields.length) {
      const message = lang === "en"
        ? `Cannot export an incomplete CV. Missing required field(s): ${missingFields.join(", ")}.`
        : `لا يمكن تصدير سيرة ذاتية غير مكتملة. الحقول المطلوبة الناقصة: ${missingFields.join("، ")}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Re-validate GPA against its selected scale server-side too (see
    // gpaExceedsScale in AtsCvBuilder.jsx / cvHtmlTemplate.js) — a direct
    // API call could otherwise ship a PDF with an out-of-range GPA.
    const gpaInvalid = Array.isArray(education) && education.some((x) => {
      const value = parseFloat(x?.gpaValue);
      const scale = parseFloat(x?.gpaScale);
      return !isNaN(value) && !isNaN(scale) && value > scale;
    });
    if (gpaInvalid) {
      const message = lang === "en"
        ? "GPA cannot exceed the selected scale."
        : "المعدل لا يمكن أن يتجاوز المقياس المختار.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const sql = getSql();
    // Read-only pre-check: fails fast on an already-used/unknown code
    // before spending time launching Chromium. The code isn't consumed
    // here — only after the PDF below is actually generated.
    const [existing] = await sql`SELECT lifecycle_status FROM access_codes WHERE code = ${code}`;
    timings.precheck = Date.now() - t0;
    if (!existing || !["available", "customer_in_progress"].includes(existing.lifecycle_status)) {
      return NextResponse.json({ error: "الكود غير صالح أو تم استخدامه من قبل." }, { status: 409 });
    }

    const splitLines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
    const splitList = (t) => t.split(/[،,\n]/).map((l) => l.trim()).filter(Boolean);

    const html = buildCvHtml({ form, experiences, education, courses, certifications, customSections, techSkills, softSkills, splitLines, splitList, lang });

    let tMark = Date.now();
    const browser = await getBrowser();
    timings.browserLaunch = Date.now() - tMark;

    tMark = Date.now();
    page = await browser.newPage();
    // The HTML is fully self-contained (fonts are embedded as base64 data:
    // URIs, no external requests at all), so "networkidle0" — which waits
    // out a 500ms quiet window on the network — buys nothing here and only
    // adds latency. "load" fires as soon as the document itself (including
    // those inline resources) has finished parsing.
    await page.setContent(html, { waitUntil: "load" });
    timings.render = Date.now() - tMark;

    tMark = Date.now();
    await ensureFontsReady(page);
    timings.fontsReady = Date.now() - tMark;

    tMark = Date.now();
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
      // Tagged (accessible) PDF adds an extra layer of structure/marked-content
      // nesting on top of Chromium's own per-run ActualText mapping for RTL
      // text. It isn't needed here and some PDF readers' text-selection
      // handles the resulting nested marked content poorly for Arabic.
      tagged: false,
    });
    timings.pdf = Date.now() - tMark;

    // Only now — after the PDF has actually been generated — is the code
    // consumed. A single conditional UPDATE both re-checks and consumes it
    // atomically (so a concurrent request for the same code can't double-
    // spend it); if PDF generation had thrown above, we'd never reach here
    // and the code would stay available/customer_in_progress for the user
    // to retry. This stays synchronous (unlike archival below) — it's the
    // single-use guarantee, it's one cheap query, and it isn't what makes
    // this route slow. Reaching 'awaiting_sending' IS what makes the code
    // single-use from here on — the WHERE guard is the only gate.
    tMark = Date.now();
    const [consumed] = await sql`
      UPDATE access_codes
      SET status = 'used', used_at = now(), lifecycle_status = 'awaiting_sending'
      WHERE code = ${code} AND lifecycle_status IN ('available', 'customer_in_progress')
      RETURNING id
    `;
    timings.markUsed = Date.now() - tMark;
    if (!consumed) {
      return NextResponse.json({ error: "الكود غير صالح أو تم استخدامه من قبل." }, { status: 409 });
    }
    await sql`INSERT INTO sending_status_history (access_code_id, status, changed_by) VALUES (${consumed.id}, 'awaiting_sending', NULL)`;
    // The code's session (used to survive page refreshes before export) is
    // done its job now that the code itself is consumed.
    destroySessionsForCode(code);

    timings.total = Date.now() - t0;
    console.log(`[generate-pdf] ${JSON.stringify(timings)}`);

    // Best-effort archival for the admin panel: uploads to Blob storage and
    // records the PDF link. It never throws (see cvArchive.js) and has no
    // bearing on whether the user gets their download, so it runs in the
    // background via waitUntil instead of blocking the response on a Blob
    // upload + extra DB round trips the user has no reason to wait for.
    const archiveStart = Date.now();
    waitUntil(
      archiveGeneratedPdf({
        accessCode: code,
        pdfBuffer,
        applicantName: form?.name,
        applicantEmail: form?.email,
        applicantPhone: form?.phone,
        applicantCity: form?.city,
        applicantTargetRole: form?.targetRoles,
        applicantTargetCities: form?.targetCities,
        applicantInternalNotes: form?.internalNotes,
        lang,
      }).then(() => {
        console.log(`[generate-pdf] archive took ${Date.now() - archiveStart}ms (background)`);
      })
    );

    const safeName = (form?.name || "CV").replace(/\s+/g, "_");
    const fileName = `${safeName}_CV.pdf`;
    // Content-Disposition must be a valid HTTP header value (Latin-1 only) —
    // Arabic names need the RFC 5987 filename* form, with an ASCII fallback
    // for older clients that don't understand it.
    const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_");
    const res = new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
    // The code is consumed — nothing left to resume, so the session cookie
    // no longer resolves to anything and can be cleared.
    clearSessionCookie(res);
    return res;
  } catch (err) {
    console.error("PDF generation failed:", err);
    // Only discard the cached browser if this request actually got as far
    // as opening a page in it (`page` is set) — that's the signal the
    // failure may be a crashed/broken browser rather than an unrelated
    // error (bad request body, a DB hiccup on the pre-check, etc.), which
    // shouldn't cost the next request its warm-reuse speedup for nothing.
    if (cachedBrowser && page) {
      cachedBrowser.close().catch(() => {});
      cachedBrowser = null;
    }
    return NextResponse.json({ error: err.message || "PDF generation failed" }, { status: 500 });
  } finally {
    // Only the per-request page is closed — the browser itself stays alive
    // for the next request on this warm instance (see getBrowser above).
    if (page) await page.close().catch(() => {});
  }
}
