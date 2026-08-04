import { neon } from "@neondatabase/serverless";

// Server-only: never import this file from a "use client" component. All
// database access must go through API routes so DATABASE_URL and raw
// queries never reach the browser.
let cached;

export function getSql() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Run `vercel env pull .env.development.local` (or set it in your environment) before using the database."
      );
    }
    cached = neon(url);
  }
  return cached;
}
