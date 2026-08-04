// Server-only guard, mirroring lib/db.js's pattern — @vercel/blob's
// functions already read BLOB_READ_WRITE_TOKEN from the environment
// automatically, this just turns a missing token into a clear error
// instead of an opaque failure deep inside the SDK.
export function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull .env.development.local` (or set it in your environment) before using Blob storage."
    );
  }
}
