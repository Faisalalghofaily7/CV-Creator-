// Best-effort archival for the generated Word (.docx) file — a deliberately
// MINIMAL, separate counterpart to lib/cvArchive.js (the PDF archiver),
// which also fires staff notifications and starts the Integrated-package
// LinkedIn track. This file does neither: the PDF flow already owns both
// of those (the customer's CV existing at all, in any format, is signaled
// to staff once, by the PDF path), so duplicating them here would double-
// notify. This is purely "upload the file and link it to the record."
import { put, del } from "@vercel/blob";
import { getSql } from "./db";
import { assertBlobConfigured } from "./blob";

/**
 * Uploads a generated .docx to the private Blob store and links it to the
 * access code it belongs to. Never throws — Word is a best-effort, optional
 * extra format, so any failure here is logged and swallowed; the customer
 * already has their downloaded file regardless of whether archival for the
 * admin panel succeeds.
 */
export async function archiveGeneratedDocx({ accessCode, docxBuffer, applicantName, lang }) {
  if (!accessCode) {
    console.warn("Skipping Word archival: no accessCode was sent with this generate-docx request.");
    return;
  }

  try {
    assertBlobConfigured();
    const sql = getSql();

    const [existing] = await sql`SELECT docx_url FROM access_codes WHERE code = ${accessCode}`;
    if (!existing) {
      console.warn(`Skipping Word archival: no access_codes row found for code "${accessCode}".`);
      return;
    }
    const previousPathname = existing.docx_url || null;

    const safeName = (applicantName || "cv")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "cv";
    const pathname = `docx/${accessCode}/${Date.now()}-${safeName}.docx`;

    const blob = await put(pathname, docxBuffer, {
      access: "private",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      addRandomSuffix: true,
    });

    // No lifecycle_status guard here on purpose — unlike the PDF's
    // consumption-tied archival, Word doesn't depend on (or change) the
    // code's redemption state at all; see app/api/generate-docx/route.js.
    const [updated] = await sql`
      UPDATE access_codes
      SET docx_url = ${blob.pathname}, docx_language = ${lang || null}, docx_generated_at = now()
      WHERE code = ${accessCode}
      RETURNING id
    `;

    if (!updated) {
      console.warn(`Skipping Word archival: access_codes row for "${accessCode}" vanished mid-request.`);
      del(blob.pathname).catch((err) => console.error("Failed to clean up unlinked archived docx:", err));
      return;
    }

    if (previousPathname && previousPathname !== blob.pathname) {
      del(previousPathname).catch((err) => console.error("Failed to clean up previous archived docx:", err));
    }

    console.log(`Archived Word doc for code "${accessCode}" -> ${blob.pathname}`);
  } catch (err) {
    console.error("Word archival failed (non-fatal, user's download is unaffected):", err);
  }
}
