// One-time setup: creates the access_codes table if it doesn't exist yet.
//
// Usage:
//   1. vercel env pull .env.development.local   (pulls DATABASE_URL locally)
//   2. node --env-file=.env.development.local scripts/init-db.mjs
//
// Safe to re-run — CREATE TABLE IF NOT EXISTS makes it a no-op if the
// table already exists.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Run `vercel env pull .env.development.local` first, then re-run this script with:\n" +
      "  node --env-file=.env.development.local scripts/init-db.mjs"
  );
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf8");

try {
  await sql.query(schema);
  console.log("✓ access_codes table is ready.");
} catch (err) {
  console.error("Failed to run schema.sql:", err.message);
  process.exit(1);
}
