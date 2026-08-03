/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @sparticuz/chromium ships its Chromium binary as files it locates
  // relative to its own package directory at runtime. Next.js's default
  // serverless bundling relocates/traces dependencies and breaks that
  // lookup ("input directory .../bin does not exist"). Marking these
  // packages external keeps them untouched in node_modules instead.
  experimental: {
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  },
};

module.exports = nextConfig;
