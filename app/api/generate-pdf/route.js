import fs from "fs";
import { NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
import { buildCvHtml } from "../../../lib/cvHtmlTemplate";
import { archiveGeneratedPdf } from "../../../lib/cvArchive";
import { getSql } from "../../../lib/db";
import { destroySessionsForCode, clearSessionCookie } from "../../../lib/userSession";

export const runtime = "nodejs";
export const maxDuration = 30;

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

export async function POST(request) {
  let browser;
  try {
    const body = await request.json();
    const { form, experiences, education, techSkills, softSkills, lang, accessCode } = body;

    const code = typeof accessCode === "string" ? accessCode.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "لا يوجد كود دخول صالح لهذه الجلسة." }, { status: 400 });
    }

    const sql = getSql();
    // Read-only pre-check: fails fast on an already-used/unknown code
    // before spending time launching Chromium. The code isn't consumed
    // here — only after the PDF below is actually generated.
    const [existing] = await sql`SELECT status FROM access_codes WHERE code = ${code}`;
    if (!existing || existing.status !== "available") {
      return NextResponse.json({ error: "الكود غير صالح أو تم استخدامه من قبل." }, { status: 409 });
    }

    const splitLines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
    const splitList = (t) => t.split(/[،,\n]/).map((l) => l.trim()).filter(Boolean);

    const html = buildCvHtml({ form, experiences, education, techSkills, softSkills, splitLines, splitList, lang });

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
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

    // Only now — after the PDF has actually been generated — is the code
    // consumed. A single conditional UPDATE both re-checks and consumes it
    // atomically (so a concurrent request for the same code can't double-
    // spend it); if PDF generation had thrown above, we'd never reach here
    // and the code would stay 'available' for the user to retry.
    const [consumed] = await sql`
      UPDATE access_codes
      SET status = 'used', used_at = now()
      WHERE code = ${code} AND status = 'available'
      RETURNING id
    `;
    if (!consumed) {
      return NextResponse.json({ error: "الكود غير صالح أو تم استخدامه من قبل." }, { status: 409 });
    }
    // The code's session (used to survive page refreshes before export) is
    // done its job now that the code itself is consumed.
    destroySessionsForCode(code);

    // Best-effort archival for the admin panel — awaited so it actually runs
    // to completion in this serverless invocation, but it never throws, so
    // a Blob/DB failure here can't stop the user from getting their PDF.
    await archiveGeneratedPdf({ accessCode: code, pdfBuffer, applicantName: form?.name, lang });

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
    return NextResponse.json({ error: err.message || "PDF generation failed" }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}
