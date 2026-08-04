import { put, del } from "@vercel/blob";
import { getSql } from "./db";
import { assertBlobConfigured } from "./blob";

/**
 * Best-effort: uploads a generated CV PDF to the private Blob store and
 * links it to the access code that unlocked it. Never throws — archival is
 * secondary to the user getting their PDF, so any failure here is logged
 * and swallowed by the caller's perspective (the download must not fail
 * because of this).
 */
export async function archiveGeneratedPdf({ accessCode, pdfBuffer, applicantName, lang }) {
  if (!accessCode) {
    console.warn("Skipping CV archival: no accessCode was sent with this generate-pdf request.");
    return;
  }

  try {
    assertBlobConfigured();
    const sql = getSql();

    // Look up the previous archived blob (if any) so it can be cleaned up
    // after a successful re-generation, instead of leaking storage.
    const [existing] = await sql`SELECT pdf_url FROM access_codes WHERE code = ${accessCode}`;
    if (!existing) {
      console.warn(`Skipping CV archival: no access_codes row found for code "${accessCode}".`);
      return;
    }
    const previousPathname = existing.pdf_url || null;

    const safeName = (applicantName || "cv")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics (e.g. "José" -> "Jose")
      .replace(/[^\w-]+/g, "_") // anything else (incl. Arabic script) -> "_"; this is just a storage path, not shown to users
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "cv";
    const pathname = `cvs/${accessCode}/${Date.now()}-${safeName}.pdf`;

    const blob = await put(pathname, pdfBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: true,
    });

    const [updated] = await sql`
      UPDATE access_codes
      SET pdf_url = ${blob.pathname}, pdf_language = ${lang || null}, applicant_name = ${applicantName || null}, generated_at = now()
      WHERE code = ${accessCode} AND status = 'used'
      RETURNING id
    `;

    if (!updated) {
      // Row exists but wasn't 'used' (shouldn't happen via the normal
      // flow) — don't leave an unlinked file behind.
      console.warn(`Skipping CV archival: access_codes row for "${accessCode}" is not marked 'used'.`);
      del(blob.pathname).catch((err) => console.error("Failed to clean up unlinked archived PDF:", err));
      return;
    }

    if (previousPathname && previousPathname !== blob.pathname) {
      del(previousPathname).catch((err) => console.error("Failed to clean up previous archived PDF:", err));
    }

    console.log(`Archived CV for code "${accessCode}" -> ${blob.pathname}`);
  } catch (err) {
    console.error("CV archival failed (non-fatal, user's download is unaffected):", err);
  }
}
