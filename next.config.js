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
    // Externalizing the package stops webpack from mangling its require()
    // paths, but Next.js's own output file tracing still decides which
    // files get copied into the deployed function — and since the binary
    // is loaded via a computed runtime path (not a static import), the
    // tracer misses it entirely unless told explicitly.
    outputFileTracingIncludes: {
      "/api/generate-pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
};

module.exports = nextConfig;
