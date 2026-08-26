// Reproduction script for the Arabic PDF text-corruption investigation
// (see the LIGATURE-SCRAMBLING FIX comment at the top of
// lib/cvHtmlTemplate.js). Renders a sample CV through the exact same
// buildCvHtml() + puppeteer-core page.pdf() call app/api/generate-pdf/
// route.js uses, so the reproduction is faithful to production's actual
// PDF-generation path — only the Chromium binary differs (a local build
// here vs. @sparticuz/chromium on Vercel), which doesn't matter for this
// class of bug since it's a Chromium/PDFium PDF-text-layer issue, not a
// font/environment one.
//
// Usage (needs a loader hook because this project's lib/*.js files use
// extensionless imports, which Next.js's bundler resolves but Node's
// native ESM loader doesn't):
//   PUPPETEER_EXECUTABLE_PATH=/path/to/chromium \
//     node --experimental-loader=./debug/resolve-extensionless.mjs debug/generate-test-cv.mjs
//
// Then verify with: node debug/extract-text.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";
import { buildCvHtml } from "../lib/cvHtmlTemplate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_STRINGS = {
  name: "فيصل عبدالله الغفيلي",
  jobTitle: "مدقق مالي",
  email: "faisalalghofaily7@gmail.com",
  sectionHeading: "التعليم", // rendered automatically as the Education section header
  lamAlefLine: "متابعة الانحرافات بين الأداء الفعلي والمخطط",
};

const form = {
  name: TEST_STRINGS.name,
  email: TEST_STRINGS.email,
  phone: "0556163232",
  city: "الرياض",
  linkedin: "",
  summary: "",
};

const experiences = [
  {
    title: TEST_STRINGS.jobTitle,
    employer: "شركة علم",
    period: "2019 - 2024",
    bullets: TEST_STRINGS.lamAlefLine,
  },
];

const education = [
  {
    degree: "بكالوريوس محاسبة",
    school: "جامعة الملك سعود",
    year: "2018",
    gpaValue: "4.5",
    gpaScale: "5",
    gradProject: "",
  },
];

const splitLines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const splitList = (t) => t.split(/[،,\n]/).map((l) => l.trim()).filter(Boolean);

const html = buildCvHtml({
  form,
  experiences,
  education,
  courses: [],
  certifications: [],
  customSections: [],
  techSkills: "",
  softSkills: "",
  skillDetails: { tech: [], soft: [] },
  splitLines,
  splitList,
  lang: "ar",
});

const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

if (!executablePath) {
  console.error("No Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH.");
  process.exit(1);
}

console.log("Using Chromium at:", executablePath);

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });

// Same font-readiness wait as app/api/generate-pdf/route.js's ensureFontsReady.
await Promise.race([
  page.evaluate(() => document.fonts.ready),
  new Promise((resolve) => setTimeout(resolve, 5000)),
]);
await page.evaluate(async () => {
  const sample = "أA";
  await Promise.all([
    document.fonts.load("400 13px Tajawal", sample).catch(() => {}),
    document.fonts.load("700 13px Tajawal", sample).catch(() => {}),
  ]);
});

const pdfBuffer = await page.pdf({
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
  tagged: false,
});

await browser.close();

const outDir = path.join(__dirname);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "test-cv.pdf");
fs.writeFileSync(outPath, pdfBuffer);
console.log("Wrote", outPath, `(${pdfBuffer.length} bytes)`);

console.log("\n=== TEST STRINGS (expected) ===");
for (const [k, v] of Object.entries(TEST_STRINGS)) {
  console.log(`${k}: ${v}`);
}
