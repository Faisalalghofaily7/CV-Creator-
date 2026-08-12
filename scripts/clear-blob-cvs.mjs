// One-off cleanup: deletes every archived CV PDF from Vercel Blob (all
// blobs under the "cvs/" prefix), matching a full access_codes reset.
// Run with: BLOB_READ_WRITE_TOKEN=... node scripts/clear-blob-cvs.mjs
import { list, del } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set.");
  process.exit(1);
}

let cursor;
let total = 0;

do {
  const { blobs, cursor: nextCursor } = await list({ prefix: "cvs/", cursor, limit: 1000 });
  if (blobs.length) {
    await del(blobs.map((b) => b.pathname));
    total += blobs.length;
    console.log(`Deleted ${blobs.length} blob(s) (running total: ${total})`);
  }
  cursor = nextCursor;
} while (cursor);

console.log(`Done. Deleted ${total} archived CV PDF(s) from Vercel Blob.`);
