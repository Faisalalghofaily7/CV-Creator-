// Extracts text from debug/test-cv.pdf (see generate-test-cv.mjs) via
// pdftotext (Poppler, spawned as a subprocess — full Unicode BiDi
// algorithm) and compares each expected substring against it. This is the
// reference-quality extractor; see the comment in generate-test-cv.mjs
// for why pdf-parse (pdf.js) is a separate, noisier signal not used for
// pass/fail here.
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, "test-cv.pdf");

const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });

const expected = {
  name: "فيصل عبدالله الغفيلي",
  jobTitle: "مدقق مالي",
  email: "faisalalghofaily7@gmail.com",
  sectionHeading: "التعليم",
  lamAlefLine: "متابعة الانحرافات بين الأداء الفعلي والمخطط",
};

console.log("=== pdftotext output ===");
console.log(text);
console.log("=== comparison ===");

let allPass = true;
for (const [key, value] of Object.entries(expected)) {
  const pass = text.includes(value);
  if (!pass) allPass = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${key}: "${value}"`);
}

console.log(allPass ? "\nAll strings extracted correctly." : "\nSome strings did NOT extract correctly — corruption present.");
process.exit(allPass ? 0 : 1);
