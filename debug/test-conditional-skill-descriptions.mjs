// Regression test for the conditional-skill-descriptions feature (see the
// NEW FEATURE comments in lib/cvQualityRules.js and
// app/api/describe-skill/route.js). Covers:
//   1. Experienced candidate (isFreshGraduate: false) -> zero AI calls,
//      description always "" (decided in code, not by the model).
//   2. Fresh graduate with real grounding context -> description retained.
//   3. Fresh graduate with NO grounding context at all -> description "",
//      never a fabricated project/placement/course.
// Plus the pure isFreshGraduate/totalMonthsOfExperience helpers directly.
//
// Part 2/3 need a live server AND a mocked lib/anthropic.js (there's no
// real ANTHROPIC_API_KEY in a plain dev sandbox, and this must never spend
// a real API call on every test run anyway). Usage:
//
//   cp lib/anthropic.js /tmp/anthropic.js.orig            # back up the real one
//   cp debug/mock-anthropic-for-skill-desc-test.js lib/anthropic.js
//   npx next dev -p 3057 &
//   # wait for it to be ready, then:
//   DESCRIBE_SKILL_MOCK_LOG=/tmp/describe-skill-calls.jsonl \
//     node debug/test-conditional-skill-descriptions.mjs
//   # then ALWAYS revert:
//   cp /tmp/anthropic.js.orig lib/anthropic.js
//
// Running with no server up still runs Part 1 (the pure helpers) and fails
// loudly on the fetch calls in Part 2/3, rather than silently skipping them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFreshGraduate, totalMonthsOfExperience } from "../lib/cvQualityRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DESCRIBE_SKILL_TEST_BASE || "http://localhost:3057";
const LOG_PATH = process.env.DESCRIBE_SKILL_MOCK_LOG || path.join(__dirname, "describe-skill-calls.jsonl");

function callCount() {
  if (!fs.existsSync(LOG_PATH)) return 0;
  return fs.readFileSync(LOG_PATH, "utf8").split("\n").filter(Boolean).length;
}

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

// ── Part 1: pure flag computation (no server needed) ──
{
  const eightYearsExp = [{ fromYear: "2016", fromMonth: "1", toYear: "2024", toMonth: "1", current: false }];
  const noExp = [];
  const threeMonthInternship = [{ fromYear: "2024", fromMonth: "1", toYear: "2024", toMonth: "4", current: false }];

  check("totalMonthsOfExperience: 8-year entry = 96 months", totalMonthsOfExperience(eightYearsExp) === 96);
  check("isFreshGraduate: false for 8 years of experience", isFreshGraduate(eightYearsExp) === false);
  check("isFreshGraduate: true for zero experience entries", isFreshGraduate(noExp) === true);
  check("isFreshGraduate: true for a 3-month internship (<12mo)", isFreshGraduate(threeMonthInternship) === true);
}

// ── Part 2: route behavior via the real /api/describe-skill endpoint ──
async function scenario1_experiencedNoDescription() {
  const before = callCount();
  const res = await fetch(`${BASE}/api/describe-skill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "ar",
      skillName: "SAP",
      isFreshGraduate: false,
      experienceSummary: "محلل مالي أول — شركة كبرى — إعداد الموازنات وتحليل الانحرافات",
      jobTitle: "محلل مالي أول",
    }),
  });
  const data = await res.json();
  const after = callCount();
  check("Scenario 1 (8yrs experience): HTTP 200", res.status === 200, `got ${res.status}`);
  check("Scenario 1 (8yrs experience): skills are keywords only (empty description)", data.description === "", `got ${JSON.stringify(data)}`);
  check("Scenario 1 (8yrs experience): zero AI calls made (deterministic short-circuit)", after === before, `calls before=${before} after=${after}`);
}

async function scenario2_freshGraduateWithGrounding() {
  const res = await fetch(`${BASE}/api/describe-skill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "ar",
      skillName: "Excel",
      isFreshGraduate: true,
      gradProjectSummary: "نظام إدارة المخزون — تحليل بيانات المبيعات باستخدام Excel",
      educationSummary: "بكالوريوس نظم معلومات — جامعة الملك سعود",
    }),
  });
  const data = await res.json();
  check("Scenario 2 (no experience, has project context): HTTP 200", res.status === 200, `got ${res.status}`);
  check("Scenario 2 (no experience, has project context): description retained", typeof data.description === "string" && data.description.trim().length > 0, `got ${JSON.stringify(data)}`);
}

async function scenario3_freshGraduateNoContext() {
  const res = await fetch(`${BASE}/api/describe-skill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lang: "ar",
      skillName: "Python",
      isFreshGraduate: true,
      // Deliberately no experienceSummary, gradProjectSummary, or
      // coursesSummary — nothing to ground a description in.
    }),
  });
  const data = await res.json();
  check("Scenario 3 (no experience, no project/training data): HTTP 200", res.status === 200, `got ${res.status}`);
  check(
    "Scenario 3 (no experience, no project/training data): keywords only, no fabricated context",
    data.description === "",
    `got ${JSON.stringify(data)}`
  );
}

await scenario1_experiencedNoDescription();
await scenario2_freshGraduateWithGrounding();
await scenario3_freshGraduateNoContext();

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
