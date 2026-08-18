"use client";

import React, { useState, useEffect, useRef } from "react";
import { FileText, Download, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Trash2, User, Briefcase, GraduationCap, Wrench, CheckCircle2, Loader2, Languages as LanguagesIcon, Layers, Upload } from "lucide-react";
import { CV_LABELS } from "../lib/cvLabels";
import { getCvQualityIssues, isValidNamePartCount, isExperienceEntryComplete, isCourseEntryComplete, isSparseCv, SPARSE_SKILLS_MINIMUM } from "../lib/cvQualityRules";

// Persists in-progress form data across page refreshes. Keyed to the
// access code so a *different* code (a new session) never inherits a
// previous, unrelated session's leftover data — only sessionStorage (not
// localStorage) so it naturally disappears when the tab/browser closes.
const PROGRESS_KEY = "cvBuilderProgress";

function loadProgress(accessCode) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.accessCode === accessCode ? parsed : null;
  } catch {
    return null;
  }
}

function clearProgress() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PROGRESS_KEY);
  } catch {}
}

// Matches Arabic script (incl. supplement/extended blocks and presentation
// forms) — used to reject Arabic in the name field when the chosen CV
// output language is English (see guardLangInput). Two variants: a
// non-global one for `.test()` (a global regex's `lastIndex` state would
// make repeated `.test()` calls on the same object unreliable), and a
// global one for `.replace()` so multi-character input — e.g. a pasted or
// autofilled name, not just single keystrokes — is stripped completely
// rather than just its first Arabic character.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_RE_G = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

// Mirror of ARABIC_RE/ARABIC_RE_G above, used to reject English prose in
// Arabic-mode "must be single-language" fields (see guardLangInput) —
// plain Latin letters only, so digits/punctuation/Arabic are never matched.
const LATIN_RE = /[A-Za-z]/;
const LATIN_RE_G = /[A-Za-z]/g;

// Converts Eastern Arabic-Indic digits (٠-٩) to Western digits (0-9) —
// matches the rest of the app's established convention (see
// formatArabicDate in lib/email.js) of never using Arabic-Indic numerals,
// regardless of CV language. Applied to every guarded field so a year,
// GPA, or count typed on an Arabic keyboard always comes out as normal
// Western digits.
const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (d) => String(EASTERN_DIGITS.indexOf(d)));
}

// Latin tokens legitimately used within Arabic-CV prose — tool/software
// names and professional certifications/acronyms commonly written in Latin
// script even in otherwise-Arabic text (the same convention already used
// by AR_TECH_SKILLS below, which keeps entries like "Excel"/"Power BI"/
// "SQL" in Latin even in the Arabic list). Checked case-insensitively.
// Deliberately generous: this list only keeps common single-word terms
// from ever counting toward the "English prose" run in
// hasEnglishProseRun/stripEnglishProseRuns below — a term NOT on this list
// still isn't blocked on its own, since the block only fires on a run of
// two or more consecutive non-Arabic-separated Latin words either way.
const LATIN_PROSE_ALLOWLIST = new Set([
  "excel", "word", "powerpoint", "sap", "oracle", "erp", "quickbooks", "power", "bi", "sql",
  "python", "photoshop", "autocad", "primavera", "java", "html", "css", "php", "aws", "ios",
  "android", "linkedin", "pmp", "pmi", "cfa", "cma", "cpa", "socpa", "mba", "hr", "it", "kpi",
  "roi", "crm", "gpa", "vs", "llc", "sa", "ksa", "b2b", "b2c", "api", "seo", "sem", "ui", "ux",
]);

// Arabic-mode mirror of the English-mode "must be single-language" guard
// below: a lone Latin word/acronym/tool-name is normal even in Arabic
// prose (see the allowlist above), but two or more of them IN A ROW
// (nothing but whitespace/punctuation between — an Arabic word in between
// resets the count) reads as an actual English sentence, which is what
// actually needs catching. Returns the token match objects that make up
// each qualifying run, in source order.
function findEnglishProseRuns(value) {
  // Same Arabic ranges as ARABIC_RE/ARABIC_RE_G above (incl.
  // supplement/extended blocks and presentation forms) — an Arabic word
  // from any of those ranges resets the run, same as a plain one would.
  const tokenRe = /[A-Za-z]+|[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g;
  const tokens = [...String(value ?? "").matchAll(tokenRe)];
  const runs = [];
  let current = [];
  const flush = () => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  for (const tok of tokens) {
    if (ARABIC_RE.test(tok[0])) {
      flush();
      continue;
    }
    const isCandidate = tok[0].length >= 3 && !LATIN_PROSE_ALLOWLIST.has(tok[0].toLowerCase());
    if (isCandidate) current.push(tok);
    else flush();
  }
  flush();
  return runs;
}

// Removes exactly the word-runs findEnglishProseRuns flagged, leaving
// single terms/acronyms, Arabic content, digits, and punctuation untouched
// — same "strip only the offending part" spirit as ARABIC_RE_G's stripping
// above, just scoped to genuine multi-word runs instead of every character.
function stripEnglishProseRuns(value) {
  const runs = findEnglishProseRuns(value);
  if (!runs.length) return value;
  const removals = runs.flat().sort((a, b) => b.index - a.index);
  let result = String(value ?? "");
  removals.forEach((m) => {
    result = result.slice(0, m.index) + result.slice(m.index + m[0].length);
  });
  return result;
}

const PHONE_RE = /^(\+9665\d{8}|05\d{8})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

// Sentinel stored in a "with other" dropdown's choice field when the user
// picks the free-text option instead of one of the fixed choices.
const OTHER = "__other__";

const CURRENT_YEAR = new Date().getFullYear();

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const AR_CITIES = ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران", "القصيم/بريدة", "عنيزة", "الطائف", "تبوك", "أبها", "خميس مشيط", "حائل", "نجران", "جازان", "الأحساء", "الجبيل", "ينبع", "الخرج"];
const EN_CITIES = ["Riyadh", "Jeddah", "Makkah", "Madinah", "Dammam", "Khobar", "Dhahran", "Buraidah (Qassim)", "Unaizah", "Taif", "Tabuk", "Abha", "Khamis Mushait", "Hail", "Najran", "Jazan", "Al-Ahsa", "Jubail", "Yanbu", "Al-Kharj"];

// Separate list for the "target cities" multi-select (Change 1) — a
// deliberately different, staff-specified set from AR_CITIES/EN_CITIES
// above (which is only for the single "resides in" field and already has
// its own tested extraction-matching behavior); keeping them independent
// avoids touching that unrelated field's option list.
const AR_TARGET_CITIES = ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الخبر", "الظهران", "القصيم (بريدة/عنيزة)", "الطائف", "تبوك", "أبها", "خميس مشيط", "حائل", "نجران", "جازان", "الجبيل", "ينبع", "الأحساء (الهفوف)", "عرعر", "سكاكا", "الباحة"];
const EN_TARGET_CITIES = ["Riyadh", "Jeddah", "Makkah", "Madinah", "Dammam", "Khobar", "Dhahran", "Qassim (Buraidah/Unaizah)", "Taif", "Tabuk", "Abha", "Khamis Mushait", "Hail", "Najran", "Jazan", "Jubail", "Yanbu", "Al-Ahsa (Hofuf)", "Arar", "Sakaka", "Al-Baha"];

const AR_DEGREES = ["الثانوية العامة", "دبلوم", "بكالوريوس", "ماجستير", "دكتوراه", "زمالة"];
const EN_DEGREES = ["High School", "Diploma", "Bachelor's", "Master's", "PhD", "Fellowship"];

const AR_UNIVERSITIES = ["جامعة الملك سعود", "جامعة الملك عبدالعزيز", "جامعة الملك فهد للبترول والمعادن", "جامعة الإمام محمد بن سعود", "جامعة القصيم", "جامعة الملك خالد", "جامعة أم القرى", "جامعة الملك فيصل", "جامعة طيبة", "جامعة الطائف", "جامعة حائل", "جامعة تبوك", "جامعة نجران", "جامعة جازان", "جامعة الأميرة نورة", "جامعة الملك سعود للعلوم الصحية"];
const EN_UNIVERSITIES = ["King Saud University", "King Abdulaziz University", "KFUPM", "Al-Imam Muhammad Ibn Saud Islamic University", "Qassim University", "King Khalid University", "Umm Al-Qura University", "King Faisal University", "Taibah University", "Taif University", "University of Hail", "University of Tabuk", "Najran University", "Jazan University", "Princess Nourah University", "King Saud bin Abdulaziz University for Health Sciences"];

const AR_MAJORS = ["المحاسبة", "إدارة الأعمال", "التمويل", "الاقتصاد", "نظم المعلومات الإدارية", "علوم الحاسب", "هندسة البرمجيات", "الهندسة الصناعية", "الهندسة المدنية", "الهندسة الكهربائية", "الهندسة الميكانيكية", "علوم البيانات", "الأمن السيبراني", "القانون", "التسويق", "الموارد البشرية", "الطب", "التمريض", "الصيدلة", "العلوم", "الرياضيات", "اللغة الإنجليزية", "الإعلام", "العلاقات العامة", "التصميم الجرافيكي", "السياحة والفندقة", "التربية", "علم الاجتماع"];
const EN_MAJORS = ["Accounting", "Business Administration", "Finance", "Economics", "Management Information Systems", "Computer Science", "Software Engineering", "Industrial Engineering", "Civil Engineering", "Electrical Engineering", "Mechanical Engineering", "Data Science", "Cybersecurity", "Law", "Marketing", "Human Resources", "Medicine", "Nursing", "Pharmacy", "Science", "Mathematics", "English Language", "Media", "Public Relations", "Graphic Design", "Tourism & Hospitality", "Education", "Sociology"];

const AR_LEVELS = ["مبتدئ", "متوسط", "متقدم", "متمكّن", "لغة أم"];
const EN_LEVELS = ["Beginner", "Intermediate", "Advanced", "Proficient", "Native"];

const AR_LANGUAGE_OPTIONS = ["العربية", "الإنجليزية"];
const EN_LANGUAGE_OPTIONS = ["Arabic", "English"];

const AR_TECH_SKILLS = ["Excel", "Word", "PowerPoint", "SAP", "Oracle ERP", "QuickBooks", "Power BI", "SQL", "Python", "تحليل البيانات", "إدارة قواعد البيانات", "الشبكات", "الأمن السيبراني", "Photoshop", "AutoCAD", "إدارة المشاريع (Primavera)", "Java", "تطوير المواقع"];
const EN_TECH_SKILLS = ["Excel", "Word", "PowerPoint", "SAP", "Oracle ERP", "QuickBooks", "Power BI", "SQL", "Python", "Data Analysis", "Database Management", "Networking", "Cybersecurity", "Photoshop", "AutoCAD", "Project Management (Primavera)", "Java", "Web Development"];

const AR_SOFT_SKILLS = ["العمل الجماعي", "القيادة", "التواصل الفعّال", "حل المشكلات", "إدارة الوقت", "التفكير النقدي", "العمل تحت الضغط", "خدمة العملاء", "التفاوض", "الإبداع", "التخطيط الاستراتيجي", "إدارة الفريق"];
const EN_SOFT_SKILLS = ["Teamwork", "Leadership", "Effective Communication", "Problem Solving", "Time Management", "Critical Thinking", "Working Under Pressure", "Customer Service", "Negotiation", "Creativity", "Strategic Planning", "Team Management"];

const AR_ROLES = ["محاسب", "محلل مالي", "مراقب مالي", "مدير مالي", "مدقق حسابات", "محلل بيانات", "مطور برمجيات", "مهندس", "أخصائي موارد بشرية", "مدير مشروع", "أخصائي تسويق", "مندوب مبيعات", "مدير عمليات", "أخصائي مشتريات", "مدير تنفيذي", "مستشار", "محامٍ", "مصمم جرافيك", "أخصائي دعم فني", "مدير مبيعات", "أخصائي علاقات عامة", "مدير مكتب", "سكرتير تنفيذي", "مهندس شبكات", "محلل أنظمة", "أخصائي أمن سيبراني", "مدرب", "معلم"];
const EN_ROLES = ["Accountant", "Financial Analyst", "Financial Controller", "Finance Manager", "Auditor", "Data Analyst", "Software Developer", "Engineer", "HR Specialist", "Project Manager", "Marketing Specialist", "Sales Representative", "Operations Manager", "Procurement Specialist", "Executive Manager", "Consultant", "Lawyer", "Graphic Designer", "IT Support Specialist", "Sales Manager", "Public Relations Specialist", "Office Manager", "Executive Secretary", "Network Engineer", "Systems Analyst", "Cybersecurity Specialist", "Trainer", "Teacher"];

function yearRange(from, to) {
  const years = [];
  for (let y = to; y >= from; y--) years.push(String(y));
  return years;
}

function formatMonthYear(month, year, lang) {
  if (!month || !year) return "";
  const names = lang === "en" ? EN_MONTHS : AR_MONTHS;
  const name = names[parseInt(month, 10) - 1] || "";
  return `${name} ${year}`.trim();
}

function formatPeriod(x, lang) {
  const from = formatMonthYear(x.fromMonth, x.fromYear, lang);
  const to = x.current ? (lang === "en" ? "Present" : "حتى الآن") : formatMonthYear(x.toMonth, x.toYear, lang);
  if (!from && !to) return "";
  if (from && !to) return from;
  return `${from} - ${to}`;
}

// True when both dates are fully filled in and the end date is strictly
// before the start date. Incomplete dates and "still working here" entries
// (no end date to compare) are never flagged.
function dateRangeInvalid(x) {
  if (x.current) return false;
  if (!x.fromYear || !x.fromMonth || !x.toYear || !x.toMonth) return false;
  const from = Number(x.fromYear) * 12 + Number(x.fromMonth);
  const to = Number(x.toYear) * 12 + Number(x.toMonth);
  return to < from;
}

// Ranks an experience by recency for sorting the generated CV: an ongoing
// role ("current") always ranks most recent, then whichever end date is
// latest, falling back to the start date for entries with no end date yet.
function experienceSortKey(x) {
  if (x.current) return Infinity;
  if (x.toYear && x.toMonth) return Number(x.toYear) * 12 + Number(x.toMonth);
  if (x.fromYear && x.fromMonth) return Number(x.fromYear) * 12 + Number(x.fromMonth);
  return -Infinity;
}

function sortExperiencesDesc(list) {
  return [...list].sort((a, b) => experienceSortKey(b) - experienceSortKey(a));
}

// Null when either range is incomplete (nothing to compare) — an ongoing
// role's end is treated as "now" (Infinity) for overlap purposes.
function experienceRange(x) {
  if (!x.fromYear || !x.fromMonth) return null;
  const start = Number(x.fromYear) * 12 + Number(x.fromMonth);
  const end = x.current ? Infinity : (x.toYear && x.toMonth ? Number(x.toYear) * 12 + Number(x.toMonth) : null);
  if (end == null) return null;
  return { start, end };
}

// Gentle, non-blocking signal only — concurrent roles are a legitimate
// real-world case, so overlapping dates should warn, never block proceeding.
function anyExperiencesOverlap(list) {
  const ranges = list.map(experienceRange).filter(Boolean);
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].start <= ranges[j].end && ranges[j].start <= ranges[i].end) return true;
    }
  }
  return false;
}

// ── Uploaded-CV extraction → form-state helpers ──────────────────────
// The server returns plain best-guess strings (e.g. a bare city name), not
// the form's internal choice/custom split — matching that against the
// known option lists is simpler and more reliable done here, deterministically,
// than asking the model to know the exact internal option values. Tries
// both language lists so e.g. an Arabic CV's city still maps correctly onto
// an English-mode form's option list (translation-by-lookup, not by AI).
// The mismatch popup and the post-translation review card are shown in
// BOTH English and Arabic together, always — unlike the rest of the
// platform UI (the L object below, which switches per cvLang) — so the
// message is unambiguous no matter which language the applicant actually
// reads. langNameInEnglish/langNameInArabic give each language's own name
// as it should appear inside an English vs. an Arabic sentence.
function langNameInEnglish(code) {
  return code === "en" ? "English" : "Arabic";
}
function langNameInArabic(code) {
  return code === "en" ? "الإنجليزية" : "العربية";
}

function langMismatchBodyBilingual(selectedCode, uploadedCode) {
  return {
    en: `You chose ${langNameInEnglish(selectedCode)} but uploaded a CV written in ${langNameInEnglish(uploadedCode)}. We'll do our best to translate it, but please review the result carefully — especially names and technical terms.`,
    ar: `لقد اخترت اللغة ${langNameInArabic(selectedCode)} بينما السيرة المرفوعة باللغة ${langNameInArabic(uploadedCode)}. سنبذل قصارى جهدنا في الترجمة، لكن يُرجى مراجعة النتيجة بعناية — خاصة الأسماء والمصطلحات التقنية.`,
  };
}

const TRANSLATION_REVIEW_NOTICE_BILINGUAL = {
  en: "We automatically translated your CV — please carefully review names, terms, and organizations and make sure they're correct before continuing.",
  ar: "قمنا بترجمة سيرتك تلقائيًا — يُرجى مراجعة الأسماء والمصطلحات والجهات بعناية والتأكد من صحتها قبل المتابعة.",
};

// Shown once, right after a successful export — always in BOTH languages
// together (same convention as the mismatch popup/review notice above),
// since it's the very last thing the applicant sees regardless of which
// CV language they picked.
const THANK_YOU_MESSAGE_BILINGUAL = {
  ar: "شكرًا لاستخدامك خدمتنا. سنعمل الآن على إرسال سيرتك الذاتية إلى الشركات، وسنشاركك التقرير عبر واتساب خلال 72 ساعة. يعتمد عدد الشركات على المدن والوظائف المستهدفة التي حددتها.",
  en: "Thank you for using our service. We'll now work on sending your CV to companies, and we'll share the report with you via WhatsApp within 72 hours. The number of companies depends on the target cities and jobs you selected.",
};

// Total months of an experience entry's date range, or null if the entry
// doesn't have enough to compute one (incomplete dates — by the time this
// matters for export, findMissingRequiredFields has already required every
// started entry to have full dates; this stays defensive for the live-
// typing preview, where an in-progress entry is normal). "current" uses
// today as the effective end date.
function experienceMonthsRange(x) {
  if (!x.fromYear || !x.fromMonth) return null;
  const fromM = Number(x.fromYear) * 12 + Number(x.fromMonth);
  let toM;
  if (x.current) {
    const now = new Date();
    toM = now.getFullYear() * 12 + (now.getMonth() + 1);
  } else {
    if (!x.toYear || !x.toMonth) return null;
    toM = Number(x.toYear) * 12 + Number(x.toMonth);
  }
  if (toM < fromM) return null; // invalid range — already flagged by dateRangeInvalid
  return [fromM, toM];
}

// Total months of REAL experience across all entries, merging overlapping/
// concurrent ranges (classic interval union) so two simultaneous jobs are
// never double-counted, and gaps between jobs are never counted at all.
function calculateTotalExperienceMonths(experiences) {
  const ranges = experiences.map(experienceMonthsRange).filter(Boolean).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [start, end] of ranges) {
    if (curStart === null) {
      curStart = start;
      curEnd = end;
    } else if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total;
}

// Arabic cardinal-number/noun agreement for "years": 1 = "سنة", 2 =
// "سنتان" (dual), 3-10 = "N سنوات" (plural), 11+ = "N سنة" (singular after
// the number, standard Arabic grammar for compound numbers).
function arabicYearsWord(n) {
  if (n === 1) return "سنة";
  if (n === 2) return "سنتان";
  if (n >= 3 && n <= 10) return `${n} سنوات`;
  return `${n} سنة`;
}

// The auto-calculated years-of-experience line shown in the header/contact
// line: a whole number of years is stated directly; a partial year rounds
// to the nearest whole year and is prefixed "about"/"تقريبًا" (a rounded
// figure is inherently approximate). Rounds to 0 (and is omitted, same as
// no experience at all) below 6 months.
function formatYearsOfExperiencePhrase(totalMonths, lang) {
  if (!totalMonths || totalMonths < 6) return "";
  const wholeYears = Math.floor(totalMonths / 12);
  const remainder = totalMonths % 12;
  const isApprox = remainder > 0;
  const years = isApprox && remainder >= 6 ? wholeYears + 1 : wholeYears;
  if (years <= 0) return "";
  if (lang === "en") {
    const unit = years === 1 ? "year" : "years";
    return isApprox ? `about ${years} ${unit} experience` : `${years} ${unit} experience`;
  }
  const word = arabicYearsWord(years);
  return isApprox ? `تقريبًا ${word} خبرة` : `${word} خبرة`;
}

// Keeps a GPA input to digits and at most one decimal point — no letters,
// no second "." (a stray extra one is just dropped rather than rejecting
// the whole keystroke, so typing "4..5" quietly becomes "4.5").
function normalizeGpaInput(raw) {
  const digitsAndDot = normalizeDigits(raw).replace(/[^\d.]/g, "");
  const firstDot = digitsAndDot.indexOf(".");
  if (firstDot === -1) return digitsAndDot;
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, "");
}

// True only once BOTH a value and a scale are present and the value
// numerically exceeds it — an empty value or an unselected scale is not
// an error on its own (GPA stays optional), just not yet renderable (see
// formatGpaValue).
function gpaExceedsScale(value, scale) {
  if (!value || !scale) return false;
  const num = parseFloat(value);
  const max = parseFloat(scale);
  return !isNaN(num) && !isNaN(max) && num > max;
}

// "4.5 / 5" (English) or "4.5 من 5" (Arabic) — exactly the two output
// formats requested. Renders nothing until both a value and a scale are
// set (GPA is optional; an incomplete pair just doesn't show up on the
// CV rather than rendering a half-formed line).
function formatGpaValue(value, scale, lang) {
  if (!value || !scale || gpaExceedsScale(value, scale)) return "";
  return lang === "en" ? `${value} / ${scale}` : `${value} من ${scale}`;
}

// Best-effort parse of a free-text GPA string extracted from an uploaded
// CV (e.g. "4.5/5", "4.5 من 5", "3.8 out of 4") into the new
// {gpaValue, gpaScale} shape. Only recognizes a 4 or 5 scale, matching
// the two options the form itself offers — anything else (an unusual
// scale, or just a bare number with no stated scale) leaves gpaScale
// blank rather than guessing, so the applicant picks it themselves; a
// value with no confidently-parsed scale is still kept so they don't
// have to retype the number, just choose the scale.
function parseGpaScale(raw) {
  const s = String(raw || "").trim();
  if (!s) return { gpaValue: "", gpaScale: "" };
  const scaled = s.match(/(\d+(?:\.\d+)?)\s*(?:\/|من|out of|of)\s*(\d+(?:\.\d+)?)/i);
  if (scaled) {
    const scale = scaled[2];
    if (scale === "4" || scale === "5") return { gpaValue: scaled[1], gpaScale: scale };
  }
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return { gpaValue: bare[1], gpaScale: "" };
  return { gpaValue: "", gpaScale: "" };
}

// Defense-in-depth against a summary that was cut off mid-word by the API
// (see generate-summary/route.js's max_tokens guards) ever getting stuck
// permanently: the input-snapshot check alone only catches a CHANGE in
// input, so a summary that was already broken when it was generated (or
// cached from before those server-side guards existed) would otherwise be
// treated as "not stale" forever and never get another chance to
// regenerate. A real, complete summary — in any language this app
// supports — always ends on real sentence-final punctuation; anything
// else is treated as incomplete and worth retrying on the next Preview.
function looksTruncated(text) {
  const t = (text || "").trim();
  if (!t) return false;
  return !/[.!?؟]$/.test(t);
}

function matchOption(value, arList, enList, activeList) {
  const v = String(value || "").trim();
  if (!v) return { choice: "", custom: "" };
  const lower = v.toLowerCase();
  let idx = arList.findIndex((o) => o.toLowerCase() === lower);
  if (idx === -1) idx = enList.findIndex((o) => o.toLowerCase() === lower);
  if (idx !== -1 && activeList[idx]) return { choice: activeList[idx], custom: "" };
  return { choice: OTHER, custom: v };
}

// Same idea, but for plain (non-"other") dropdowns like language
// proficiency level, which have no free-text fallback in the UI — an
// unmatched value is simply left blank for the user to pick themselves.
function matchExact(value, arList, enList, activeList) {
  const v = String(value || "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  let idx = arList.findIndex((o) => o.toLowerCase() === lower);
  if (idx === -1) idx = enList.findIndex((o) => o.toLowerCase() === lower);
  return idx !== -1 && activeList[idx] ? activeList[idx] : "";
}

function normalizeMonth(v) {
  const n = parseInt(v, 10);
  return n >= 1 && n <= 12 ? String(n) : "";
}

function normalizeYear(v) {
  const s = String(v ?? "").trim();
  return /^\d{4}$/.test(s) ? s : "";
}

// Best-effort only — an unrecognizable phone number is simply left blank
// for the applicant to enter themselves, same as any other unmatched field.
function normalizePhone(v) {
  let digits = String(v || "").replace(/[\s-]/g, "");
  digits = digits.replace(/^00/, "+");
  if (/^5\d{8}$/.test(digits)) digits = "0" + digits;
  return PHONE_RE.test(digits) ? digits : "";
}

function dedupeTrim(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((x) => {
    const v = String(x ?? "").trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  });
  return out;
}

// ── Design tokens ──────────────────────────────────────────────
// "Official HR file" identity: formal black & white / grayscale.
const C = {
  ink: "#000000",
  paper: "#ffffff",
  paperCard: "#ffffff",
  brass: "#000000",
  brassSoft: "#555555",
  slate: "#333333",
  line: "#d0d0d0",
  ok: "#000000",
};

// Petrol-navy brand palette — used everywhere in this component EXCEPT the
// CV preview screen and print output above, which stay on the original
// black/white identity `C` so the on-screen preview keeps matching the
// generated PDF exactly.
const THEME = {
  primary: "#1a3a5c",
  primaryDark: "#12293f",
  secondary: "#2d5578",
  soft: "#e8eef4",
  pageBg: "#f5f7fa",
  card: "#ffffff",
  text: "#3a4a5a",
  border: "#dde4ec",
};

const STEPS = [
  { key: "personal", label: "البيانات الشخصية", icon: User },
  { key: "experience", label: "الخبرات", icon: Briefcase },
  { key: "education", label: "التعليم", icon: GraduationCap },
  { key: "skills", label: "المهارات", icon: Wrench },
  // Achievements, Training Courses, Certifications & Memberships, and any
  // custom sections all live together in this final step, each keeping its
  // own heading — grouping the optional/extra content into one step rather
  // than splitting Certifications off into its own separate tab.
  { key: "extra", label: "أقسام إضافية", icon: Layers },
];

export default function AtsCvBuilder({ accessCode }) {
  // Read once at mount — captures whatever this access code's session had
  // saved before a refresh, if any. A different (or absent) code yields
  // null, so a fresh session always starts blank.
  const [saved] = useState(() => loadProgress(accessCode));

  const [step, setStep] = useState(saved?.step ?? 0);
  const [preview, setPreview] = useState(saved?.preview ?? false);
  const [downloading, setDownloading] = useState(false);
  const [cvLang, setCvLang] = useState(saved?.cvLang ?? "ar");
  const [langConfirmed, setLangConfirmed] = useState(saved?.langConfirmed ?? false);
  // Snapshot of the language that was actually confirmed/active before the
  // user started picking a new one on the language screen — cvLang itself
  // changes live as soon as the "العربية"/"English" option button is
  // clicked (before "متابعة" is pressed), so confirmLanguage can't compare
  // the target language against cvLang to detect a real change; it compares
  // against this snapshot instead (see requestChangeLanguage below).
  const [priorConfirmedLang, setPriorConfirmedLang] = useState(saved?.cvLang ?? "ar");
  // Gate shown right after the language screen: upload an existing CV (AI
  // pre-fills the form below) or start from a blank one. Once true, the
  // applicant is into the normal step wizard either way — this is a
  // one-time fork, not a separate flow.
  const [sourceChosen, setSourceChosen] = useState(saved?.sourceChosen ?? false);
  // Additive back/change navigation for the language + method choices made
  // before the form itself (see requestChangeMethod/confirmChangeMethod
  // below) — purely UI state, never touches the form/experiences/etc. data
  // itself, so nothing here can affect the existing filling logic.
  const [showMethodChangeWarning, setShowMethodChangeWarning] = useState(false);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [cvFile, setCvFile] = useState(null);
  const [uploadingCv, setUploadingCv] = useState(false);
  const [uploadCvError, setUploadCvError] = useState("");
  const [blockedField, setBlockedField] = useState(null);
  // Detected/selected-language mismatch popup state — additive, only
  // engaged when the uploaded CV's dominant language (reported by
  // /api/extract-cv as detectedLanguage) differs from the CV language the
  // applicant already chose. Matching-language uploads never touch any of
  // this and keep using applyExtractedData exactly as before.
  const [showLangMismatchModal, setShowLangMismatchModal] = useState(false);
  const [pendingExtractedData, setPendingExtractedData] = useState(null);
  const [detectedCvLang, setDetectedCvLang] = useState(null);
  const [translatingCv, setTranslatingCv] = useState(false);
  // Drives the single review-notice card near "Next" — set once a
  // mismatch-triggered translation was applied, regardless of whether the
  // translation call itself ultimately succeeded or fell back to the
  // original text, so the applicant is always told to double-check names/
  // terms/entities after an automatic translation.
  const [translationApplied, setTranslationApplied] = useState(saved?.translationApplied ?? false);
  // Export confirmation flow: the access code is single-use, so exporting
  // must be an explicit, confirmed action. `exportCompleted` only flips to
  // true after a PDF has actually finished downloading successfully — a
  // failed attempt (network/server error) must leave it false so the user
  // can retry without losing their code.
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportCompleted, setExportCompleted] = useState(false);
  const [exportError, setExportError] = useState("");
  // A single confirm exports BOTH the PDF and a Word (.docx) copy. Only the
  // PDF's success gates completion (see downloadCvFiles) — if Word fails
  // afterward, the order is still complete and the applicant is just told
  // the Word copy wasn't available, on the thank-you screen below.
  const [wordUnavailable, setWordUnavailable] = useState(false);
  // AI-generated professional summary: only auto-generated once per session
  // (aiSummaryGenerated guards against silently overwriting a manual edit
  // the next time the user revisits the preview).
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState("");
  const [aiSummaryGenerated, setAiSummaryGenerated] = useState(saved?.aiSummaryGenerated ?? false);
  // Snapshot of the exact input the summary was last generated FROM (see
  // buildSummaryInputSnapshot/generateAiSummary) — compared against the
  // CURRENT input every time Preview is opened so that going back and
  // editing anything the summary depends on (target role, years of
  // experience, an experience/education entry, skills) re-runs the AI,
  // while leaving unrelated fields untouched never triggers a needless
  // re-call. aiSummaryGenerated alone only tracked "has this run at
  // least once," not "is it still current."
  const [summaryInputSnapshot, setSummaryInputSnapshot] = useState(saved?.summaryInputSnapshot ?? null);
  // True the moment the user types into the summary box themselves, false
  // again once a fresh AI generation lands. Lets the truncation safety net
  // below (looksTruncated, in proceedToPreview) tell "this still-broken
  // text is the AI's own unedited output — safe to silently replace" apart
  // from "the user deliberately wrote something here that happens not to
  // end in punctuation" — the latter must never be silently overwritten.
  const [summaryEdited, setSummaryEdited] = useState(saved?.summaryEdited ?? false);
  // Blocking overlay shown on the preview screen for as long as the
  // summary/enhancement generation triggered by "معاينة السيرة الذاتية" is
  // still in flight — covers both the slow-retry case and the fast/normal
  // success case equally, since it's driven by proceedToPreview awaiting
  // the actual generation calls rather than by any retry-specific signal.
  const [previewGenerating, setPreviewGenerating] = useState(false);
  // AI-enhanced experience bullets / achievements / graduation projects.
  // Keyed by a stable item key (e.g. "exp-0-bullet-1", "achievement-2",
  // "eduGradProject-0"). Each entry holds both the original user text and
  // the AI version so the preview's original/AI toggle is lossless, plus
  // `current` (whichever the CV should actually use) and `edited` (guards
  // a manual edit made while the AI call is still in flight from being
  // clobbered when the response lands).
  const [aiItemsLoading, setAiItemsLoading] = useState(false);
  const [aiItemsError, setAiItemsError] = useState("");
  const [itemsEnhanced, setItemsEnhanced] = useState(saved?.itemsEnhanced ?? false);
  const [enhancedItems, setEnhancedItems] = useState(saved?.enhancedItems ?? {});
  // Which items currently have their "original text" panel expanded —
  // purely ephemeral UI state, not persisted.
  const [originalToggles, setOriginalToggles] = useState({});
  // Shared UI state for every searchable dropdown / skill-suggestion list
  // on the form — only one can be open at a time, keyed by field id.
  const [openDropdown, setOpenDropdown] = useState(null);
  const [dropdownQuery, setDropdownQuery] = useState({});
  // Non-blocking per-section check: shown when the applicant clicks "Next"
  // off a section that's still empty — purely a nudge, never prevents
  // proceeding (see goToNextStep / the section-warning modal below).
  const [showSectionWarningModal, setShowSectionWarningModal] = useState(false);
  const [sectionWarningLabel, setSectionWarningLabel] = useState("");
  const [pendingStepAdvance, setPendingStepAdvance] = useState(null);
  // BLOCKING (unlike the section-warning nudge above): every mandatory
  // field, checked across ALL steps regardless of which one the applicant
  // is currently on — closes the bypass where jumping straight to another
  // section via the step menu skips whatever canProceed() would have
  // caught on "Next". See findMissingRequiredFields.
  const [showMissingFieldsModal, setShowMissingFieldsModal] = useState(false);
  const [missingFieldIssues, setMissingFieldIssues] = useState([]);
  // "Suggest for me" AI helper for points-style fields (experience bullets,
  // achievements) — purely optional, never replaces manual typing. Keyed by
  // the same field id as the list itself, holding whatever suggestions were
  // last generated for it plus loading/error state.
  const [suggestions, setSuggestions] = useState({});
  const cvDir = cvLang === "ar" ? "rtl" : "ltr";
  const t = CV_LABELS[cvLang];

  // The AI-generated summary and the polished experience/achievement/
  // custom-section bullets are DERIVED output — always a function of the
  // CURRENT raw experiences/achievements/customSections plus the CURRENT
  // cvLang, never something to keep around once either one changes out
  // from under it. Resetting only the aiSummaryGenerated/itemsEnhanced
  // guard flags (an earlier attempt at this) turned out to be
  // insufficient: it correctly re-triggers generation, but the STALE
  // content underneath — form.summary, and each enhancedItems[key]'s
  // original/ai/current slots plus its originalToggles[key] open/closed
  // state — was still sitting there. Since enhancedItems is keyed
  // positionally (e.g. "exp-0-bullet-1") and those same keys reappear
  // after a re-upload of the same (or a similarly-shaped) CV, the
  // regeneration's own seed step (`if (!next[k]) ...`) sees an entry
  // already there and skips reseeding it, and any timing hiccup in the
  // apply step can leave a leftover previous value in one slot while the
  // new value lands in the other. Called on every event that replaces
  // the underlying CV content — a language switch (confirmLanguage), a
  // fresh upload (applyExtractedData), or a mismatch-triggered re-upload
  // (applyExtractedDataWithTranslation) — not just a language change, so
  // re-uploading the same CV after a failed/fallback translation without
  // ever touching the language screen still gets a clean regeneration
  // instead of silently reusing the previous attempt's result.
  function resetDerivedAiOutput() {
    setAiSummaryGenerated(false);
    setAiSummaryError("");
    setForm((f) => ({ ...f, summary: "" }));
    setSummaryInputSnapshot(null);
    setSummaryEdited(false);
    setItemsEnhanced(false);
    setAiItemsError("");
    setEnhancedItems({});
    setOriginalToggles({});
    // Also back out of an already-open preview (if any) rather than
    // silently leaving the stale one on screen — the applicant has to
    // hit "Preview" again, which is exactly what re-triggers correct
    // regeneration against the current data/language.
    setPreview(false);
  }

  function confirmLanguage(lang) {
    // Only remap when the language is actually changing versus what was
    // last CONFIRMED — comparing against cvLang itself would never detect
    // a change, since the "العربية"/"English" option buttons on the
    // language screen already call setCvLang live as the user clicks
    // between them, before "متابعة" ever runs this function.
    if (lang !== priorConfirmedLang) {
      remapStructuredFieldsForLanguage(lang);
      resetDerivedAiOutput();
    }
    setCvLang(lang);
    setLangConfirmed(true);
  }

  // Additive back/change navigation (language + filling method), reachable
  // from within the form itself. Deliberately does not touch any existing
  // form state — going back to the language screen just re-shows it while
  // every already-entered field stays exactly as it is; confirmLanguage
  // above never clears anything either, so re-confirming (same or a
  // different language) is lossless by construction.
  function requestChangeLanguage() {
    setPriorConfirmedLang(cvLang);
    setLangConfirmed(false);
  }

  // Cheap, deliberately broad "is there anything to lose" check — used only
  // to decide whether the method-change warning needs to show at all, not
  // to gate anything else. A false negative just means the modal is skipped
  // for what turns out to be non-empty data, so it leans inclusive.
  function hasEnteredData() {
    const hasPersonal = !!(
      form.name?.trim() || form.phone?.trim() || form.email?.trim() ||
      form.cityChoice || form.cityCustom?.trim() || form.linkedin?.trim() ||
      form.summary?.trim()
    );
    const hasExperiences = experiences.some((x) => x.title?.trim() || x.employer?.trim() || (x.bullets || []).some((b) => b.trim()));
    const hasEducation = education.some((x) => x.degreeChoice || x.schoolChoice || x.specializationChoice || x.year?.trim());
    const hasSkills = techSkillTags.length > 0 || softSkillTags.length > 0;
    const hasLanguages = languageEntries.some((l) => l.langChoice || l.langCustom?.trim());
    const hasExtras =
      achievements.some((a) => a.trim()) ||
      courses.some((c) => c.name?.trim()) ||
      certifications.some((c) => c.name?.trim()) ||
      customSections.some((s) => s.title?.trim() || (s.points || []).some((p) => p.trim()));
    return hasPersonal || hasExperiences || hasEducation || hasSkills || hasLanguages || hasExtras;
  }

  // Going back to the upload/blank-form choice screen isn't itself
  // destructive (sourceChosen=false just re-shows that screen — none of the
  // form state below is touched by this alone). The only actually
  // destructive path is picking "upload a CV" again from there, since that
  // re-runs the existing extraction mapping and can overwrite fields it
  // maps — so warn up front whenever there's something to lose, rather than
  // threading a warning into that screen's existing button handlers.
  function requestChangeMethod() {
    if (hasEnteredData()) {
      setShowMethodChangeWarning(true);
    } else {
      setSourceChosen(false);
    }
  }

  function confirmChangeMethod() {
    setShowMethodChangeWarning(false);
    setSourceChosen(false);
  }

  // Fields with no dropdown-backed mapping AND no AI translation step
  // behind them — a name is never transliterated, an "Other" custom value
  // has no fixed list to map through, and job title/employer are free text
  // with no AI polish pass over them at all (only bullets/achievements/
  // gradProject/custom-section points go through enhance-items). All of
  // these follow the same "must actually already be in the CV's language"
  // rule, blocked outright in BOTH directions — see guardLangInput below.
  // Every other field (summary, bullets, achievements, gradProject,
  // custom-section points, course/certification names, skills/roles tags)
  // stays fully open in both directions: English mode already relies on
  // generateAiSummary/generateAiEnhancements to translate Arabic input, and
  // those same two routes translate just as faithfully in the other
  // direction (their prompts are language-agnostic — "translate ... into
  // ${languageName}", not hardcoded to English), so Arabic mode gets the
  // same AI safety net English mode always has.
  function isStrictLangFieldId(id) {
    if (id === "name" || id === "city") return true;
    if (id.startsWith("customSectionTitle-")) return true;
    if (/^edu-\d+-(degree|specialization|school)$/.test(id)) return true;
    if (/^lang-\d+-name$/.test(id)) return true;
    if (/^exp-\d+-(title|employer)$/.test(id)) return true;
    return false;
  }

  // Fields where a language guard would be actively wrong to apply:
  // inherently-Latin fields (email/links/phone), fields never rendered
  // into the PDF at all (target roles/cities, internal notes — platform-
  // only, per the earlier "Change 1" work), and skills/tools tags, which
  // legitimately mix scripts freely (see LATIN_PROSE_ALLOWLIST) and are
  // never AI-translated either way — same "not part of this guard" as
  // course/certification names, which are proper nouns as often as not.
  function isExemptFromLangGuard(id) {
    return (
      id === "email" || id === "linkedin" || id === "phone" ||
      id === "techSkills" || id === "softSkills" || id === "targetRoles" || id === "targetCities" ||
      id === "internalNotes" ||
      id.startsWith("course-") || id.startsWith("cert-")
    );
  }

  function flashBlockedField(id) {
    setBlockedField(id);
    window.clearTimeout(guardLangInput._t);
    guardLangInput._t = window.setTimeout(() => setBlockedField((cur) => (cur === id ? null : cur)), 2000);
  }

  // Shared warning row for every guarded field (field/fieldArea/
  // selectWithOther/multiSelectWithOther/searchableSelect/listInput) —
  // direction-aware by construction: cvLang alone tells us which guard
  // fired, since guardLangInput only ever blocks the OTHER script.
  function langGuardNotice(id) {
    if (blockedField !== id) return null;
    return <div style={warnStyle}>{cvLang === "en" ? L.arabicBlockedNotice : L.englishBlockedNotice}</div>;
  }

  // Strips Arabic (English mode) or English (Arabic mode) out of a
  // keystroke and flashes an inline warning near the offending field —
  // this is what keeps a CV's output language from ending up with the
  // wrong script mixed into fields that have no AI translation fallback.
  // Digits are normalized to Western numerals first, in both languages,
  // regardless of what else this call does (see normalizeDigits above).
  function guardLangInput(id, rawValue) {
    const value = normalizeDigits(rawValue);
    if (isExemptFromLangGuard(id)) return value;

    if (cvLang === "en" && ARABIC_RE.test(value)) {
      if (!isStrictLangFieldId(id)) return value;
      flashBlockedField(id);
      return value.replace(ARABIC_RE_G, "");
    }

    if (cvLang === "ar" && LATIN_RE.test(value)) {
      if (isStrictLangFieldId(id)) {
        flashBlockedField(id);
        return value.replace(LATIN_RE_G, "");
      }
      // Tier-2 prose fields: detect and flash the notice live, but don't
      // mutate the value on every keystroke — see stripProseOnBlur below
      // for why the actual strip waits until the field is left.
      if (findEnglishProseRuns(value).length) flashBlockedField(id);
      return value;
    }

    return value;
  }

  // Companion to guardLangInput's Tier-2 Arabic-mode branch above. Word-run
  // detection is inherently context-dependent — whether an earlier word is
  // part of a "run" can change retroactively once a later word completes
  // it — so stripping live, keystroke by keystroke, can remove text from
  // earlier in the field while the user is still typing later words,
  // sometimes leaving stray fragments behind rather than a clean result.
  // Evaluating the complete, final text in one pass on blur avoids that
  // entirely and always produces a clean strip.
  function stripProseOnBlur(id, value) {
    if (cvLang !== "ar" || isStrictLangFieldId(id) || isExemptFromLangGuard(id)) return value;
    const stripped = stripEnglishProseRuns(value);
    if (stripped !== value) flashBlockedField(id);
    return stripped;
  }

  // Deterministic, no-AI remap of every dropdown-backed field's ALREADY-
  // STORED value to its exact equivalent in the new language's list —
  // reuses the same matchOption/matchExact helpers the CV-upload
  // extraction path already relies on (see applyExtractedData below), just
  // run here on a language switch instead of on freshly-extracted data.
  // Without this, a value picked from one language's list (e.g. "الرياض")
  // would become an orphaned string once the option list switches to the
  // other language — and since these fields are never AI-translated, an
  // unmapped leftover would render directly into the PDF in the wrong
  // language. "Other" custom text has no list to map through, so it
  // follows the same block-don't-translate rule as isStrictLangFieldId —
  // blanked out if it's now in the wrong script, left alone otherwise.
  function remapStructuredFieldsForLanguage(newLang) {
    const wrongScriptRe = newLang === "en" ? ARABIC_RE : LATIN_RE;
    const newCityOptions = newLang === "en" ? EN_CITIES : AR_CITIES;
    const newDegreeOptions = newLang === "en" ? EN_DEGREES : AR_DEGREES;
    const newMajorOptions = newLang === "en" ? EN_MAJORS : AR_MAJORS;
    const newUniversityOptions = newLang === "en" ? EN_UNIVERSITIES : AR_UNIVERSITIES;
    const newLanguageOptions = newLang === "en" ? EN_LANGUAGE_OPTIONS : AR_LANGUAGE_OPTIONS;
    const newLevelOptions = newLang === "en" ? EN_LEVELS : AR_LEVELS;

    const remapChoice = (choice, custom, arList, enList, newOptions) => {
      if (choice === OTHER) return { choice, custom: wrongScriptRe.test(custom || "") ? "" : custom };
      if (!choice) return { choice, custom };
      // matchOption returns { choice: OTHER, custom: value } when it can't
      // find a match — a valid pre-existing choice always came from one of
      // arList/enList in the first place, so this shouldn't happen, but
      // leaving the original choice untouched is the safe fallback either
      // way (never silently turn a real selection into an empty "Other").
      const m = matchOption(choice, arList, enList, newOptions);
      return m.choice && m.choice !== OTHER ? { choice: m.choice, custom: "" } : { choice, custom };
    };

    setForm((f) => {
      const city = remapChoice(f.cityChoice, f.cityCustom, AR_CITIES, EN_CITIES, newCityOptions);
      return {
        ...f,
        cityChoice: city.choice, cityCustom: city.custom,
        name: wrongScriptRe.test(f.name || "") ? "" : f.name,
      };
    });

    setEducation((prev) => prev.map((x) => {
      const degree = remapChoice(x.degreeChoice, x.degreeCustom, AR_DEGREES, EN_DEGREES, newDegreeOptions);
      const major = remapChoice(x.specializationChoice, x.specializationCustom, AR_MAJORS, EN_MAJORS, newMajorOptions);
      const school = remapChoice(x.schoolChoice, x.schoolCustom, AR_UNIVERSITIES, EN_UNIVERSITIES, newUniversityOptions);
      return {
        ...x,
        degreeChoice: degree.choice, degreeCustom: degree.custom,
        specializationChoice: major.choice, specializationCustom: major.custom,
        schoolChoice: school.choice, schoolCustom: school.custom,
      };
    }));

    setLanguageEntries((prev) => prev.map((l) => {
      const lang = remapChoice(l.langChoice, l.langCustom, AR_LANGUAGE_OPTIONS, EN_LANGUAGE_OPTIONS, newLanguageOptions);
      const level = l.level ? (matchExact(l.level, AR_LEVELS, EN_LEVELS, newLevelOptions) || l.level) : l.level;
      return { ...l, langChoice: lang.choice, langCustom: lang.custom, level };
    }));

    // Job title / employer have no dropdown to remap through either — same
    // block-don't-translate rule as an Other-custom field above.
    setExperiences((prev) => prev.map((x) => ({
      ...x,
      title: wrongScriptRe.test(x.title || "") ? "" : x.title,
      employer: wrongScriptRe.test(x.employer || "") ? "" : x.employer,
    })));

    setCustomSections((prev) => prev.map((s) => ({
      ...s,
      title: wrongScriptRe.test(s.title || "") ? "" : s.title,
    })));
  }

  function field(id, label, val, onChange, opts = {}) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <input
          value={val}
          onChange={(e) => {
            // Normalize Eastern Arabic-Indic digits BEFORE stripping
            // non-digits — otherwise a year/count typed on an Arabic
            // keyboard (e.g. "٢٠٢٤") would have every digit silently
            // deleted (none of them match \d) instead of converted.
            const raw = opts.numeric ? normalizeDigits(e.target.value).replace(/[^\d]/g, "") : e.target.value;
            onChange({ target: { value: guardLangInput(id, raw) } });
          }}
          onBlur={(e) => onChange({ target: { value: stripProseOnBlur(id, e.target.value) } })}
          placeholder={opts.ph}
          style={inputStyle}
          inputMode={opts.numeric ? "numeric" : undefined}
        />
        {langGuardNotice(id)}
        {opts.error && <div style={warnStyle}>{opts.error}</div>}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  function fieldArea(id, label, val, onChange, opts = {}) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <textarea
          value={val}
          onChange={(e) => onChange({ target: { value: guardLangInput(id, e.target.value) } })}
          onBlur={(e) => onChange({ target: { value: stripProseOnBlur(id, e.target.value) } })}
          placeholder={opts.ph}
          rows={opts.rows || 4}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.8 }}
        />
        {langGuardNotice(id)}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Plain dropdown, no free-text escape hatch.
  function selectField(id, label, val, onChange, options, opts = {}) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <select value={val} onChange={onChange} style={inputStyle}>
          <option value="">{opts.ph || (cvLang === "en" ? "Select..." : "اختر...")}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Dropdown with a trailing "Other" option that reveals a guarded
  // free-text field bound to a separate `custom` value. When
  // opts.otherRequired is set, an inline warning shows while that field is
  // empty (actual blocking of "Next" happens in canProceed()).
  function selectWithOther(id, label, choice, custom, onChoiceChange, onCustomChange, options, opts = {}) {
    const isOther = choice === OTHER;
    const missingRequired = isOther && opts.otherRequired && !custom.trim();
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <select value={choice} onChange={(e) => onChoiceChange(e.target.value)} style={inputStyle}>
          <option value="">{cvLang === "en" ? "Select..." : "اختر..."}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={OTHER}>{cvLang === "en" ? "Other" : "أخرى"}</option>
        </select>
        {isOther && (
          <input
            value={custom}
            onChange={(e) => onCustomChange(guardLangInput(id, e.target.value))}
            placeholder={cvLang === "en" ? "Type here" : "اكتب هنا"}
            style={{ ...inputStyle, marginTop: 8 }}
          />
        )}
        {isOther && langGuardNotice(id)}
        {missingRequired && opts.otherRequiredMsg && <div style={warnStyle}>{opts.otherRequiredMsg}</div>}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Multi-select dropdown: checkbox per option, selections shown as
  // removable chips, plus an "Other/أخرى" checkbox that reveals a single
  // free-text field (same OTHER-reveal pattern as selectWithOther above,
  // just for more than one selection at once).
  function multiSelectWithOther(id, label, selected, setSelected, custom, onCustomChange, options, opts = {}) {
    const isOpen = openDropdown === id;
    const hasOther = selected.includes(OTHER);
    const toggle = (value) => setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
    return (
      <div style={{ marginBottom: 14, position: "relative" }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <div
          tabIndex={0}
          onClick={() => setOpenDropdown((cur) => (cur === id ? null : id))}
          onBlur={() => setTimeout(() => setOpenDropdown((cur) => (cur === id ? null : cur)), 150)}
          style={{ ...inputStyle, display: "flex", flexWrap: "wrap", gap: 6, minHeight: 44, alignItems: "center", cursor: "pointer" }}
        >
          {selected.length === 0 && <span style={{ color: "#8a97a5", fontSize: 13.5 }}>{opts.ph || (cvLang === "en" ? "Select..." : "اختر...")}</span>}
          {selected.map((v) => (
            <span key={v} style={chipStyle}>
              {v === OTHER ? (cvLang === "en" ? "Other" : "أخرى") : v}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); toggle(v); }} style={chipRemoveStyle} aria-label="remove">×</button>
            </span>
          ))}
        </div>
        {isOpen && (
          <div style={dropdownListStyle}>
            {options.map((o) => (
              <div key={o} onMouseDown={(e) => { e.preventDefault(); toggle(o); }} style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={selected.includes(o)} readOnly style={{ pointerEvents: "none", accentColor: THEME.primary }} />
                {o}
              </div>
            ))}
            <div onMouseDown={(e) => { e.preventDefault(); toggle(OTHER); }} style={{ ...dropdownItemStyle, display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: THEME.primary, borderBottom: "none" }}>
              <input type="checkbox" checked={hasOther} readOnly style={{ pointerEvents: "none", accentColor: THEME.primary }} />
              {cvLang === "en" ? "Other" : "أخرى"}
            </div>
          </div>
        )}
        {hasOther && (
          <input
            value={custom}
            onChange={(e) => onCustomChange(guardLangInput(id, e.target.value))}
            placeholder={cvLang === "en" ? "Type here" : "اكتب هنا"}
            style={{ ...inputStyle, marginTop: 8 }}
          />
        )}
        {hasOther && langGuardNotice(id)}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Text input with a filterable dropdown of suggestions, plus the same
  // "Other" free-text fallback as selectWithOther — used where the option
  // list is too long to scroll comfortably as a plain <select> (e.g.
  // university majors).
  function searchableSelect(id, label, choice, custom, onChoiceChange, onCustomChange, options, opts = {}) {
    const isOther = choice === OTHER;
    const isOpen = openDropdown === id;
    const query = dropdownQuery[id] || "";
    const filtered = query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options;
    const displayValue = isOpen ? query : (choice && !isOther ? choice : "");
    const selectItem = (value) => {
      onChoiceChange(value);
      setOpenDropdown(null);
      setDropdownQuery((d) => ({ ...d, [id]: "" }));
    };
    return (
      <div style={{ marginBottom: 14, position: "relative" }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <input
          value={displayValue}
          onChange={(e) => { setDropdownQuery((d) => ({ ...d, [id]: e.target.value })); setOpenDropdown(id); }}
          onFocus={() => { setOpenDropdown(id); setDropdownQuery((d) => ({ ...d, [id]: "" })); }}
          onBlur={() => setTimeout(() => setOpenDropdown((cur) => (cur === id ? null : cur)), 150)}
          placeholder={opts.ph || (cvLang === "en" ? "Search or select..." : "ابحث أو اختر...")}
          style={inputStyle}
        />
        {isOpen && (
          <div style={dropdownListStyle}>
            {filtered.map((o) => (
              <div key={o} onMouseDown={(e) => { e.preventDefault(); selectItem(o); }} style={dropdownItemStyle}>{o}</div>
            ))}
            {filtered.length === 0 && <div style={{ ...dropdownItemStyle, color: "#999", cursor: "default" }}>{cvLang === "en" ? "No matches" : "لا توجد نتائج"}</div>}
            <div onMouseDown={(e) => { e.preventDefault(); selectItem(OTHER); }} style={{ ...dropdownItemStyle, fontWeight: 700, color: THEME.primary, borderBottom: "none" }}>
              {cvLang === "en" ? "Other" : "أخرى"}
            </div>
          </div>
        )}
        {isOther && (
          <input
            value={custom}
            onChange={(e) => onCustomChange(guardLangInput(id, e.target.value))}
            placeholder={cvLang === "en" ? "Type here" : "اكتب هنا"}
            style={{ ...inputStyle, marginTop: 8 }}
          />
        )}
        {isOther && langGuardNotice(id)}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Chip/tag input: Enter or comma commits the draft as a new tag. When
  // opts.suggestions is given, typing (or focusing) shows a filtered
  // dropdown of predefined options — clicking one adds it directly, on top
  // of still being able to type any custom value.
  function tagsInput(id, label, tags, setTags, opts = {}) {
    const draft = tagDrafts[id] || "";
    const setDraft = (v) => setTagDrafts((d) => ({ ...d, [id]: v }));
    const commitValue = (raw) => {
      const parts = guardLangInput(id, raw).split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) setTags((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
    };
    const commit = () => { commitValue(draft); setDraft(""); };
    const addSuggestion = (s) => {
      if (!tags.includes(s)) setTags((prev) => [...prev, s]);
      setDraft("");
    };
    const handleKeyDown = (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && !draft && tags.length) {
        setTags(tags.slice(0, -1));
      }
    };
    // Named distinctly from the component-level `suggestions` AI-results
    // state (read below, in the opts.suggest block) — this is only the
    // static dropdown-list filtering, an unrelated, older feature.
    const dropdownSuggestions = opts.suggestions
      ? opts.suggestions.filter((s) => !tags.includes(s) && (!draft || s.toLowerCase().includes(draft.toLowerCase()))).slice(0, 8)
      : [];
    const isOpen = openDropdown === id && dropdownSuggestions.length > 0;
    return (
      <div style={{ marginBottom: 14, position: "relative" }}>
        <label style={labelStyle}>{label}</label>
        <div style={{ ...inputStyle, display: "flex", flexWrap: "wrap", gap: 6, padding: 8, minHeight: 44, alignItems: "center" }}>
          {tags.map((tg, i) => (
            <span key={i} style={chipStyle}>
              {tg}
              <button type="button" onClick={() => setTags(tags.filter((_, x) => x !== i))} style={chipRemoveStyle} aria-label="remove">×</button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => { setDraft(guardLangInput(id, e.target.value)); if (opts.suggestions) setOpenDropdown(id); }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (opts.suggestions) setOpenDropdown(id); }}
            onBlur={() => { setTimeout(() => setOpenDropdown((cur) => (cur === id ? null : cur)), 150); commit(); }}
            placeholder={tags.length ? "" : opts.ph}
            style={{ border: "none", outline: "none", flex: "1 1 120px", minWidth: 100, fontSize: 13.5, fontFamily: "inherit", background: "transparent", color: THEME.text }}
          />
        </div>
        {isOpen && (
          <div style={dropdownListStyle}>
            {dropdownSuggestions.map((s) => (
              <div key={s} onMouseDown={(e) => { e.preventDefault(); addSuggestion(s); }} style={dropdownItemStyle}>{s}</div>
            ))}
          </div>
        )}
        {langGuardNotice(id)}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
        {opts.suggest && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => suggestSkillsForField(id, opts.suggest.kind, opts.suggest.context)}
              disabled={suggestions[id]?.loading}
              style={{ ...suggestBtnStyle, opacity: suggestions[id]?.loading ? 0.7 : 1 }}
            >
              {suggestions[id]?.loading ? <><Loader2 size={14} className="spin" /> {t.suggestLoading}</> : t.suggestSkills}
            </button>
            {suggestions[id]?.error && <div style={warnStyle}>{suggestions[id].error}</div>}
            {!!suggestions[id]?.items?.length && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestions[id].items.filter((s) => !tags.includes(s)).map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => addSuggestion(s)}
                    style={{ ...btnIcon, background: THEME.soft, border: `1px solid ${THEME.border}`, borderRadius: 16, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: THEME.text, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Plus size={12} /> {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Fetches AI-generated, generic starting-point suggestions for a
  // points-style field (job-title/experience/major-based, never claimed as
  // the applicant's real achievements — see the honesty note shown with
  // the results). Purely additive: never overwrites what's already typed.
  async function suggestForField(id, kind, context) {
    setSuggestions((prev) => ({ ...prev, [id]: { loading: true, error: "", items: prev[id]?.items || [] } }));
    try {
      const res = await fetch("/api/suggest-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: cvLang, kind, ...context }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.error || "suggest failed");
      setSuggestions((prev) => ({ ...prev, [id]: { loading: false, error: "", items: data.suggestions } }));
    } catch {
      setSuggestions((prev) => ({ ...prev, [id]: { loading: false, error: t.suggestError, items: prev[id]?.items || [] } }));
    }
  }

  // Same shape as suggestForField above, but hits /api/suggest-skills (a
  // short skill-name list, not full sentences) and — unlike bullets/
  // achievements — a tapped suggestion is added directly as a tag (see the
  // tagsInput opts.suggest block above), not appended to a review list.
  async function suggestSkillsForField(id, kind, context) {
    setSuggestions((prev) => ({ ...prev, [id]: { loading: true, error: "", items: prev[id]?.items || [] } }));
    try {
      const res = await fetch("/api/suggest-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: cvLang, kind, ...context }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.error || "suggest failed");
      setSuggestions((prev) => ({ ...prev, [id]: { loading: false, error: "", items: data.suggestions } }));
    } catch {
      setSuggestions((prev) => ({ ...prev, [id]: { loading: false, error: t.suggestError, items: prev[id]?.items || [] } }));
    }
  }

  // Repeatable single-line list (each item = one discrete point), with
  // per-item remove and reorder — used for experience bullets and
  // achievements so each entry is its own item instead of one free-text
  // blob the user has to format manually.
  function listInput(id, label, items, setItems, opts = {}) {
    const move = (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= items.length) return;
      const copy = [...items];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      setItems(copy);
    };
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label}</label>
        {items.map((val, i) => {
          const itemId = `${id}-${i}`;
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={val}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[i] = guardLangInput(itemId, e.target.value);
                    setItems(copy);
                  }}
                  onBlur={(e) => {
                    const copy = [...items];
                    copy[i] = stripProseOnBlur(itemId, e.target.value);
                    setItems(copy);
                  }}
                  placeholder={opts.ph}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btnIcon, opacity: i === 0 ? 0.3 : 1 }} aria-label="up"><ChevronUp size={15} color={THEME.text} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} style={{ ...btnIcon, opacity: i === items.length - 1 ? 0.3 : 1 }} aria-label="down"><ChevronDown size={15} color={THEME.text} /></button>
                <button type="button" onClick={() => setItems(items.filter((_, x) => x !== i))} style={btnIcon} aria-label="remove"><Trash2 size={15} color="#b3261e" /></button>
              </div>
              {langGuardNotice(itemId)}
            </div>
          );
        })}
        <button type="button" onClick={() => setItems([...items, ""])} style={btnAdd}><Plus size={16} /> {opts.addLabel}</button>
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}

        {opts.suggest && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => suggestForField(id, opts.suggest.kind, opts.suggest.context)}
              disabled={suggestions[id]?.loading}
              style={{ ...suggestBtnStyle, opacity: suggestions[id]?.loading ? 0.7 : 1 }}
            >
              {suggestions[id]?.loading ? <><Loader2 size={14} className="spin" /> {t.suggestLoading}</> : t.suggestForMe}
            </button>
            {suggestions[id]?.error && <div style={warnStyle}>{suggestions[id].error}</div>}
            {!!suggestions[id]?.items?.length && (
              <div style={{ marginTop: 8, border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 12, background: THEME.soft }}>
                <div style={{ ...hintStyle, marginTop: 0, marginBottom: 8 }}>{t.suggestGenericNote}</div>
                {suggestions[id].items.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 6, padding: "8px 10px" }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: THEME.text }}>{s}</span>
                    <button
                      type="button"
                      onClick={() => setItems([...items, s])}
                      style={{ ...btnIcon, background: THEME.primary, color: "#fff", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}
                      title={t.suggestUse}
                    >
                      <Plus size={13} /> {t.suggestUse}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const [form, setForm] = useState(saved?.form ?? {
    name: "",
    email: "",
    phone: "",
    cityChoice: "",
    cityCustom: "",
    linkedin: "",
    displayPhone: "",
    summary: "",
  });
  // Whether a phone number different from the main contact number should
  // be shown on the CV — off by default, so there's only one visible phone
  // field unless the user explicitly asks for a separate one.
  const [useAltCvPhone, setUseAltCvPhone] = useState(saved?.useAltCvPhone ?? false);
  // Target role(s) — collected/stored for future matching features but,
  // per product decision, never rendered into the generated CV/PDF.
  const [targetRoles, setTargetRoles] = useState(saved?.targetRoles ?? []);
  // Target cities — same "never rendered into the PDF" rule as target
  // roles: purely for staff to know how many companies/where to reach on
  // the applicant's behalf. targetCitiesOther only matters when the
  // "أخرى/Other" entry is included in targetCities.
  const [targetCities, setTargetCities] = useState(saved?.targetCities ?? []);
  const [targetCitiesOther, setTargetCitiesOther] = useState(saved?.targetCitiesOther ?? "");
  // Free-text internal instructions for staff (e.g. "don't send my CV to
  // company X") — never sent through AI, never rendered into the PDF,
  // visible only in the admin/Staff1 panels.
  const [internalNotes, setInternalNotes] = useState(saved?.internalNotes ?? "");

  const [experiences, setExperiences] = useState(saved?.experiences ?? [
    { title: "", employer: "", fromMonth: "", fromYear: "", toMonth: "", toYear: "", current: false, bullets: [] },
  ]);
  const [education, setEducation] = useState(saved?.education ?? [
    { degreeChoice: "", degreeCustom: "", specializationChoice: "", specializationCustom: "", schoolChoice: "", schoolCustom: "", year: "", gpaValue: "", gpaScale: "", gradProject: "" },
  ]);
  const [techSkillTags, setTechSkillTags] = useState(saved?.techSkillTags ?? []);
  const [softSkillTags, setSoftSkillTags] = useState(saved?.softSkillTags ?? []);
  // Only ever read/required when the CV is sparse (no experience) — see
  // isSparseCv/SPARSE_SKILLS_MINIMUM. Keyed by skill name rather than
  // folded into the tag arrays themselves, so every existing skill-related
  // code path (tagsInput, extraction mapping, non-sparse rendering) stays
  // completely untouched for the common case.
  const [techSkillDescriptions, setTechSkillDescriptions] = useState(saved?.techSkillDescriptions ?? {});
  const [softSkillDescriptions, setSoftSkillDescriptions] = useState(saved?.softSkillDescriptions ?? {});
  const [languageEntries, setLanguageEntries] = useState(saved?.languageEntries ?? [{ langChoice: "", langCustom: "", level: "" }]);
  const [tagDrafts, setTagDrafts] = useState({});

  // ── Optional sections — plain repeatable lists like Experience, empty
  // by default so nothing shows until the user adds an entry. ──
  const [courses, setCourses] = useState(saved?.courses ?? []);
  const [achievements, setAchievements] = useState(saved?.achievements ?? []);
  const [certifications, setCertifications] = useState(saved?.certifications ?? []);
  // Fully user-defined sections (a title + bullet points) for anything the
  // fixed section list doesn't cover — e.g. Volunteering, Publications.
  // Empty by default like the other optional sections; the applicant can
  // add as many as they want.
  const [customSections, setCustomSections] = useState(saved?.customSections ?? []);

  // Persists the current step and all form data on every change, keyed to
  // this access code, so refreshing the page — on ANY step, including the
  // preview — restores exactly where the user left off instead of
  // bouncing them back to the language screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
        accessCode, step, preview, cvLang, langConfirmed, sourceChosen,
        form, useAltCvPhone, targetRoles, targetCities, targetCitiesOther, internalNotes, experiences, education, techSkillTags, softSkillTags, techSkillDescriptions, softSkillDescriptions, languageEntries,
        courses, achievements, certifications, customSections, aiSummaryGenerated, itemsEnhanced, enhancedItems, translationApplied, summaryInputSnapshot, summaryEdited,
      }));
    } catch {}
  }, [accessCode, step, preview, cvLang, langConfirmed, sourceChosen, form, useAltCvPhone, targetRoles, targetCities, targetCitiesOther, internalNotes, experiences, education, techSkillTags, softSkillTags, techSkillDescriptions, softSkillDescriptions, languageEntries, courses, achievements, certifications, customSections, aiSummaryGenerated, itemsEnhanced, enhancedItems, translationApplied, summaryInputSnapshot, summaryEdited]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // ── Experience helpers ──
  const addExp = () => setExperiences([...experiences, { title: "", employer: "", fromMonth: "", fromYear: "", toMonth: "", toYear: "", current: false, bullets: [] }]);
  const rmExp = (i) => setExperiences(experiences.filter((_, x) => x !== i));
  const setExp = (i, k) => (e) => {
    const copy = [...experiences];
    copy[i][k] = e.target.value;
    setExperiences(copy);
  };

  // ── Education helpers ──
  const addEdu = () => setEducation([...education, { degreeChoice: "", degreeCustom: "", specializationChoice: "", specializationCustom: "", schoolChoice: "", schoolCustom: "", year: "", gpaValue: "", gpaScale: "", gradProject: "" }]);
  const rmEdu = (i) => setEducation(education.filter((_, x) => x !== i));
  const setEdu = (i, k) => (e) => {
    const copy = [...education];
    copy[i][k] = e.target.value;
    setEducation(copy);
  };

  // ── Training courses helpers (optional section) ──
  const addCourse = () => setCourses([...courses, { name: "", hours: "", provider: "", date: "", hasLicense: false, licenseNumber: "" }]);
  const rmCourse = (i) => setCourses(courses.filter((_, x) => x !== i));
  const setCourse = (i, k) => (e) => {
    const copy = [...courses];
    copy[i][k] = e.target.value;
    setCourses(copy);
  };

  // ── Certifications & Memberships helpers (optional section — standalone
  // credentials without hours/provider, distinct from Training Courses) ──
  const addCert = () => setCertifications([...certifications, { name: "", issuingBody: "", date: "" }]);
  const rmCert = (i) => setCertifications(certifications.filter((_, x) => x !== i));
  const setCert = (i, k) => (e) => {
    const copy = [...certifications];
    copy[i][k] = e.target.value;
    setCertifications(copy);
  };

  // ── Custom-section helpers (optional, user-defined title + points) ──
  const addCustomSection = () => setCustomSections([...customSections, { title: "", points: [] }]);
  const rmCustomSection = (i) => setCustomSections(customSections.filter((_, x) => x !== i));
  const setCustomSectionTitle = (i, value) => {
    const copy = [...customSections];
    copy[i] = { ...copy[i], title: guardLangInput(`customSectionTitle-${i}`, value) };
    setCustomSections(copy);
  };
  const setCustomSectionPoints = (i, points) => {
    const copy = [...customSections];
    copy[i] = { ...copy[i], points };
    setCustomSections(copy);
  };

  // ── Language helpers ──
  const addLang = () => setLanguageEntries([...languageEntries, { langChoice: "", langCustom: "", level: "" }]);
  const rmLang = (i) => setLanguageEntries(languageEntries.filter((_, x) => x !== i));
  const setLang = (i, k) => (e) => {
    const copy = [...languageEntries];
    copy[i][k] = e.target.value;
    setLanguageEntries(copy);
  };

  const canProceed = () => {
    if (step === 0) return !!(form.name && form.phone && targetRoles.length > 0) && isValidNamePartCount(form.name);
    if (step === 1) return !experiences.some(dateRangeInvalid) && experiences.every(isExperienceEntryComplete);
    if (step === 2) {
      return education.every((x) => x.schoolChoice !== OTHER || x.schoolCustom.trim())
        && !education.some((x) => gpaExceedsScale(x.gpaValue, x.gpaScale));
    }
    if (step === 3 && isSparseCv(experiences)) {
      const techOk = techSkillTags.length >= SPARSE_SKILLS_MINIMUM && techSkillTags.every((s) => techSkillDescriptions[s]?.trim());
      const softOk = softSkillTags.length >= SPARSE_SKILLS_MINIMUM && softSkillTags.every((s) => softSkillDescriptions[s]?.trim());
      return techOk && softOk;
    }
    if (step === 4) return courses.every(isCourseEntryComplete);
    return true;
  };

  // The same requirements canProceed() enforces per-step, but checked all
  // at once regardless of which step is currently active — canProceed()
  // alone only blocks "Next" on the step you happen to be on, so jumping
  // straight to a later section via the step menu (never touching "Next"
  // on step 0) bypassed it entirely, letting an applicant reach Preview/
  // Export with e.g. no name at all. Called at Preview and Export time
  // (see proceedToPreview / downloadCvFiles) so the same requirements hold
  // regardless of navigation path.
  function findMissingRequiredFields() {
    const issues = [];
    if (!form.name?.trim()) issues.push({ step: 0, message: L.nameLabel });
    else if (!isValidNamePartCount(form.name)) issues.push({ step: 0, message: t.nameThreePartsError });
    if (!form.phone?.trim()) issues.push({ step: 0, message: L.phoneLabel });
    if (!targetRoles.length) issues.push({ step: 0, message: L.targetRolesLabel });
    if (experiences.some(dateRangeInvalid)) issues.push({ step: 1, message: L.dateOrderError });
    if (experiences.some((x) => !isExperienceEntryComplete(x))) issues.push({ step: 1, message: t.experienceIncompleteError });
    if (education.some((x) => x.schoolChoice === OTHER && !x.schoolCustom.trim())) {
      issues.push({ step: 2, message: L.universityOtherRequired });
    }
    if (education.some((x) => gpaExceedsScale(x.gpaValue, x.gpaScale))) {
      issues.push({ step: 2, message: L.gpaExceedsScaleError });
    }
    if (courses.some((c) => !isCourseEntryComplete(c))) issues.push({ step: 4, message: t.courseProviderRequiredError });
    if (isSparseCv(experiences)) {
      const techOk = techSkillTags.length >= SPARSE_SKILLS_MINIMUM && techSkillTags.every((s) => techSkillDescriptions[s]?.trim());
      const softOk = softSkillTags.length >= SPARSE_SKILLS_MINIMUM && softSkillTags.every((s) => softSkillDescriptions[s]?.trim());
      if (!techOk || !softOk) issues.push({ step: 3, message: t.sparseSkillsMinimumError });
    }
    return issues;
  }

  // ── Bilingual option lists + labels for the new controls ──
  const sep = cvLang === "en" ? ", " : "، ";
  const cityOptions = cvLang === "en" ? EN_CITIES : AR_CITIES;
  const targetCitiesOptions = cvLang === "en" ? EN_TARGET_CITIES : AR_TARGET_CITIES;
  const degreeOptions = cvLang === "en" ? EN_DEGREES : AR_DEGREES;
  const universityOptions = cvLang === "en" ? EN_UNIVERSITIES : AR_UNIVERSITIES;
  const majorOptions = cvLang === "en" ? EN_MAJORS : AR_MAJORS;
  const languageOptions = cvLang === "en" ? EN_LANGUAGE_OPTIONS : AR_LANGUAGE_OPTIONS;
  const levelOptions = cvLang === "en" ? EN_LEVELS : AR_LEVELS;
  const monthOptions = cvLang === "en" ? EN_MONTHS : AR_MONTHS;
  const gradYearOptions = yearRange(1970, CURRENT_YEAR + 6);
  const expYearOptions = yearRange(1970, CURRENT_YEAR);
  // "Obtained" dates (courses, certifications) can never legitimately be in
  // the future, unlike gradYearOptions which intentionally allows a few
  // years ahead for expected graduation.
  const pastYearOptions = yearRange(1970, CURRENT_YEAR);
  const techSkillSuggestions = cvLang === "en" ? EN_TECH_SKILLS : AR_TECH_SKILLS;
  const softSkillSuggestions = cvLang === "en" ? EN_SOFT_SKILLS : AR_SOFT_SKILLS;
  const roleOptions = cvLang === "en" ? EN_ROLES : AR_ROLES;

  // Populates the (still-empty) form state from an uploaded CV's extracted
  // data — every setter below is the exact same one the manual form uses,
  // so from this point on it's the normal flow: review, edit, per-section
  // warnings, preview with AI enhancement, export. Anything the extraction
  // didn't find is simply left at its default (empty), same as a blank form.
  function applyExtractedData(extracted) {
    // See resetDerivedAiOutput — this is about to replace the underlying
    // experiences/achievements/customSections/form data, so any AI summary
    // or polished bullets generated against the PREVIOUS data must not
    // survive to be silently reused against the new data.
    resetDerivedAiOutput();
    const cityMatch = matchOption(extracted.city, AR_CITIES, EN_CITIES, cityOptions);
    // Names are never auto-translated/transliterated (same rule as manual
    // entry) — an Arabic name found while the CV language is English is
    // left blank for the applicant to type in English themselves.
    const extractedName = String(extracted.name || "").trim();
    setForm((f) => ({
      ...f,
      name: cvLang === "en" && ARABIC_RE.test(extractedName) ? "" : extractedName,
      email: String(extracted.email || "").trim(),
      phone: normalizePhone(extracted.phone),
      cityChoice: cityMatch.choice,
      cityCustom: cityMatch.custom,
      linkedin: String(extracted.linkedin || "").trim(),
    }));

    if (Array.isArray(extracted.targetRoles) && extracted.targetRoles.length) {
      setTargetRoles(dedupeTrim(extracted.targetRoles));
    }

    if (Array.isArray(extracted.experiences) && extracted.experiences.length) {
      setExperiences(extracted.experiences.map((x) => ({
        title: String(x.title || "").trim(),
        employer: String(x.employer || "").trim(),
        fromMonth: normalizeMonth(x.fromMonth),
        fromYear: normalizeYear(x.fromYear),
        toMonth: x.current ? "" : normalizeMonth(x.toMonth),
        toYear: x.current ? "" : normalizeYear(x.toYear),
        current: !!x.current,
        bullets: Array.isArray(x.bullets) ? x.bullets.map((b) => String(b).trim()).filter(Boolean) : [],
      })));
    }

    if (Array.isArray(extracted.education) && extracted.education.length) {
      setEducation(extracted.education.map((x) => {
        const degreeMatch = matchOption(x.degree, AR_DEGREES, EN_DEGREES, degreeOptions);
        const majorMatch = matchOption(x.major, AR_MAJORS, EN_MAJORS, majorOptions);
        const uniMatch = matchOption(x.university, AR_UNIVERSITIES, EN_UNIVERSITIES, universityOptions);
        const { gpaValue, gpaScale } = parseGpaScale(x.gpa);
        return {
          degreeChoice: degreeMatch.choice, degreeCustom: degreeMatch.custom,
          specializationChoice: majorMatch.choice, specializationCustom: majorMatch.custom,
          schoolChoice: uniMatch.choice, schoolCustom: uniMatch.custom,
          year: normalizeYear(x.year),
          gpaValue, gpaScale,
          gradProject: String(x.gradProject || "").trim(),
        };
      }));
    }

    if (Array.isArray(extracted.techSkills) && extracted.techSkills.length) setTechSkillTags(dedupeTrim(extracted.techSkills));
    if (Array.isArray(extracted.softSkills) && extracted.softSkills.length) setSoftSkillTags(dedupeTrim(extracted.softSkills));

    if (Array.isArray(extracted.languages) && extracted.languages.length) {
      setLanguageEntries(extracted.languages.map((x) => {
        const langMatch = matchOption(x.name, AR_LANGUAGE_OPTIONS, EN_LANGUAGE_OPTIONS, languageOptions);
        return { langChoice: langMatch.choice, langCustom: langMatch.custom, level: matchExact(x.level, AR_LEVELS, EN_LEVELS, levelOptions) };
      }));
    }

    if (Array.isArray(extracted.achievements) && extracted.achievements.length) setAchievements(dedupeTrim(extracted.achievements));

    if (Array.isArray(extracted.courses) && extracted.courses.length) {
      setCourses(extracted.courses.map((x) => ({
        name: String(x.name || "").trim(),
        hours: String(x.hours || "").trim(),
        provider: String(x.provider || "").trim(),
        date: normalizeYear(x.date),
        hasLicense: false,
        licenseNumber: "",
      })));
    }

    if (Array.isArray(extracted.certifications) && extracted.certifications.length) {
      setCertifications(extracted.certifications.map((x) => ({
        name: String(x.name || "").trim(),
        issuingBody: String(x.issuingBody || "").trim(),
        date: normalizeYear(x.date),
      })));
    }

    if (Array.isArray(extracted.otherSections) && extracted.otherSections.length) {
      setCustomSections(extracted.otherSections.map((x) => {
        const title = String(x.title || "").trim();
        return {
          title: cvLang === "en" && ARABIC_RE.test(title) ? "" : title,
          points: Array.isArray(x.points) ? x.points.map((p) => String(p).trim()).filter(Boolean) : [],
        };
      }));
    }
  }

  // Used only when the uploaded CV's detected language differs from the
  // already-selected CV language (see the mismatch popup below). Reuses
  // the exact same bidirectional dropdown matching as applyExtractedData
  // (matchOption/matchExact already handle either direction with no AI
  // needed — untouched here), but additionally batch-translates the
  // fields that have no canonical list to fall back on: job title,
  // employer, unmatched "Other" custom text, unmatched skill tags, and
  // course/certification/custom-section-title text. Bullets, achievements,
  // graduation projects, and custom-section points are deliberately left
  // alone here — they already get translated (and polished) later,
  // automatically, by the existing enhance-items/generate-summary
  // pipeline at preview time, in either direction.
  //
  // This is a separate function from applyExtractedData on purpose — the
  // matching-language upload path (the vast majority of uploads) keeps
  // using applyExtractedData completely unchanged, so this new path can
  // never regress it.
  async function applyExtractedDataWithTranslation(extracted) {
    // See resetDerivedAiOutput — this is about to replace the underlying
    // experiences/achievements/customSections/form data, so any AI summary
    // or polished bullets generated against the PREVIOUS data (including a
    // previous failed/fallback attempt for this exact same CV) must not
    // survive to be silently reused against the new data.
    resetDerivedAiOutput();
    const cityMatch = matchOption(extracted.city, AR_CITIES, EN_CITIES, cityOptions);

    // Bidirectional mirror of applyExtractedData's name rule: a name is
    // never auto-translated/transliterated in either direction — an AI
    // transliteration risks inventing a spelling on identifying
    // information, so a name in the wrong script is left blank for the
    // applicant to type in themselves, exactly like the existing
    // Arabic-name-in-English-mode rule, now mirrored for an English name
    // in Arabic mode.
    const extractedName = String(extracted.name || "").trim();
    const nameWrongScript = cvLang === "en"
      ? ARABIC_RE.test(extractedName)
      : (LATIN_RE.test(extractedName) && !ARABIC_RE.test(extractedName));
    const resolvedName = nameWrongScript ? "" : extractedName;

    const educationMatches = (Array.isArray(extracted.education) ? extracted.education : []).map((x) => {
      const { gpaValue, gpaScale } = parseGpaScale(x.gpa);
      return {
        degreeMatch: matchOption(x.degree, AR_DEGREES, EN_DEGREES, degreeOptions),
        majorMatch: matchOption(x.major, AR_MAJORS, EN_MAJORS, majorOptions),
        uniMatch: matchOption(x.university, AR_UNIVERSITIES, EN_UNIVERSITIES, universityOptions),
        year: normalizeYear(x.year),
        gpaValue, gpaScale,
        gradProject: String(x.gradProject || "").trim(),
      };
    });

    const languageMatches = (Array.isArray(extracted.languages) ? extracted.languages : []).map((x) => ({
      langMatch: matchOption(x.name, AR_LANGUAGE_OPTIONS, EN_LANGUAGE_OPTIONS, languageOptions),
      level: matchExact(x.level, AR_LEVELS, EN_LEVELS, levelOptions),
    }));

    const experiencesBase = (Array.isArray(extracted.experiences) ? extracted.experiences : []).map((x) => ({
      title: String(x.title || "").trim(),
      employer: String(x.employer || "").trim(),
      fromMonth: normalizeMonth(x.fromMonth),
      fromYear: normalizeYear(x.fromYear),
      toMonth: x.current ? "" : normalizeMonth(x.toMonth),
      toYear: x.current ? "" : normalizeYear(x.toYear),
      current: !!x.current,
      bullets: Array.isArray(x.bullets) ? x.bullets.map((b) => String(b).trim()).filter(Boolean) : [],
    }));

    const targetRolesBase = Array.isArray(extracted.targetRoles) ? dedupeTrim(extracted.targetRoles) : [];
    const targetRoleMatches = targetRolesBase.map((role) => matchOption(role, AR_ROLES, EN_ROLES, roleOptions));

    const techSkillsBase = Array.isArray(extracted.techSkills) ? dedupeTrim(extracted.techSkills) : [];
    const techSkillMatches = techSkillsBase.map((tag) => matchOption(tag, AR_TECH_SKILLS, EN_TECH_SKILLS, techSkillSuggestions));

    const softSkillsBase = Array.isArray(extracted.softSkills) ? dedupeTrim(extracted.softSkills) : [];
    const softSkillMatches = softSkillsBase.map((tag) => matchOption(tag, AR_SOFT_SKILLS, EN_SOFT_SKILLS, softSkillSuggestions));

    const coursesBase = (Array.isArray(extracted.courses) ? extracted.courses : []).map((x) => ({
      name: String(x.name || "").trim(),
      hours: String(x.hours || "").trim(),
      provider: String(x.provider || "").trim(),
      date: normalizeYear(x.date),
    }));

    const certificationsBase = (Array.isArray(extracted.certifications) ? extracted.certifications : []).map((x) => ({
      name: String(x.name || "").trim(),
      issuingBody: String(x.issuingBody || "").trim(),
      date: normalizeYear(x.date),
    }));

    const otherSectionsBase = (Array.isArray(extracted.otherSections) ? extracted.otherSections : []).map((x) => ({
      title: String(x.title || "").trim(),
      points: Array.isArray(x.points) ? x.points.map((p) => String(p).trim()).filter(Boolean) : [],
    }));

    // Collect every free-text value that has no canonical list to match
    // against (so matchOption above couldn't resolve it deterministically)
    // into ONE ordered batch, translated in a single call.
    const batch = [];
    const push = (v) => { batch.push(v); return batch.length - 1; };

    const expSlots = experiencesBase.map((x) => ({
      titleIdx: x.title ? push(x.title) : -1,
      employerIdx: x.employer ? push(x.employer) : -1,
    }));
    const targetRoleSlots = targetRoleMatches.map((m) => (m.choice === OTHER && m.custom ? push(m.custom) : -1));
    const cityCustomIdx = cityMatch.choice === OTHER && cityMatch.custom ? push(cityMatch.custom) : -1;
    const eduSlots = educationMatches.map((e) => ({
      degreeIdx: e.degreeMatch.choice === OTHER && e.degreeMatch.custom ? push(e.degreeMatch.custom) : -1,
      majorIdx: e.majorMatch.choice === OTHER && e.majorMatch.custom ? push(e.majorMatch.custom) : -1,
      uniIdx: e.uniMatch.choice === OTHER && e.uniMatch.custom ? push(e.uniMatch.custom) : -1,
      // GPA is no longer free text (see gpaValue/gpaScale + parseGpaScale
      // above) — a number and a fixed 4-or-5 scale have no language
      // content to translate, so there's nothing to batch here anymore.
    }));
    // No batch entry for years-of-experience — it's no longer a free-text
    // field; it's auto-calculated from the (already-translated) experience
    // dates, so there's nothing left to translate here.
    const langSlots = languageMatches.map((l) => (l.langMatch.choice === OTHER && l.langMatch.custom ? push(l.langMatch.custom) : -1));
    const techSlots = techSkillMatches.map((m) => (m.choice === OTHER && m.custom ? push(m.custom) : -1));
    const softSlots = softSkillMatches.map((m) => (m.choice === OTHER && m.custom ? push(m.custom) : -1));
    const courseSlots = coursesBase.map((c) => ({
      nameIdx: c.name ? push(c.name) : -1,
      providerIdx: c.provider ? push(c.provider) : -1,
    }));
    const certSlots = certificationsBase.map((c) => ({
      nameIdx: c.name ? push(c.name) : -1,
      issuingBodyIdx: c.issuingBody ? push(c.issuingBody) : -1,
    }));
    const otherSectionTitleSlots = otherSectionsBase.map((s) => (s.title ? push(s.title) : -1));

    // Bounded-retry + graceful fallback already lives server-side (see
    // /api/translate-extraction, mirroring enhance-items). A network-level
    // failure here (fetch itself throwing, or a non-JSON response) falls
    // back to the original, untranslated batch values exactly the same
    // way a same-shape server-side failure would — this function never
    // throws, and the review-notice card applies either way.
    let translated = batch;
    if (batch.length) {
      try {
        const res = await fetch("/api/translate-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: cvLang, terms: batch }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.terms) && data.terms.length === batch.length) {
          translated = data.terms;
        }
      } catch {
        // Fall through with the original batch — see comment above.
      }
    }

    const at = (idx, fallback) => (idx >= 0 ? (translated[idx] || fallback) : fallback);

    setForm((f) => ({
      ...f,
      name: resolvedName,
      email: String(extracted.email || "").trim(),
      phone: normalizePhone(extracted.phone),
      cityChoice: cityMatch.choice,
      cityCustom: cityMatch.choice === OTHER ? at(cityCustomIdx, cityMatch.custom) : cityMatch.custom,
      linkedin: String(extracted.linkedin || "").trim(),
    }));

    if (targetRolesBase.length) {
      setTargetRoles(targetRoleMatches.map((m, i) => (m.choice === OTHER ? at(targetRoleSlots[i], m.custom) : m.choice)));
    }

    if (experiencesBase.length) {
      setExperiences(experiencesBase.map((x, i) => ({
        ...x,
        title: at(expSlots[i].titleIdx, x.title),
        employer: at(expSlots[i].employerIdx, x.employer),
      })));
    }

    if (educationMatches.length) {
      setEducation(educationMatches.map((e, i) => ({
        degreeChoice: e.degreeMatch.choice,
        degreeCustom: e.degreeMatch.choice === OTHER ? at(eduSlots[i].degreeIdx, e.degreeMatch.custom) : e.degreeMatch.custom,
        specializationChoice: e.majorMatch.choice,
        specializationCustom: e.majorMatch.choice === OTHER ? at(eduSlots[i].majorIdx, e.majorMatch.custom) : e.majorMatch.custom,
        schoolChoice: e.uniMatch.choice,
        schoolCustom: e.uniMatch.choice === OTHER ? at(eduSlots[i].uniIdx, e.uniMatch.custom) : e.uniMatch.custom,
        year: e.year,
        gpaValue: e.gpaValue, gpaScale: e.gpaScale,
        gradProject: e.gradProject,
      })));
    }

    if (techSkillsBase.length) {
      setTechSkillTags(techSkillMatches.map((m, i) => (m.choice === OTHER ? at(techSlots[i], m.custom) : m.choice)));
    }
    if (softSkillsBase.length) {
      setSoftSkillTags(softSkillMatches.map((m, i) => (m.choice === OTHER ? at(softSlots[i], m.custom) : m.choice)));
    }

    if (languageMatches.length) {
      setLanguageEntries(languageMatches.map((l, i) => ({
        langChoice: l.langMatch.choice,
        langCustom: l.langMatch.choice === OTHER ? at(langSlots[i], l.langMatch.custom) : l.langMatch.custom,
        level: l.level,
      })));
    }

    if (Array.isArray(extracted.achievements) && extracted.achievements.length) setAchievements(dedupeTrim(extracted.achievements));

    if (coursesBase.length) {
      setCourses(coursesBase.map((c, i) => ({
        name: at(courseSlots[i].nameIdx, c.name),
        hours: c.hours,
        provider: at(courseSlots[i].providerIdx, c.provider),
        date: c.date,
        hasLicense: false,
        licenseNumber: "",
      })));
    }

    if (certificationsBase.length) {
      setCertifications(certificationsBase.map((c, i) => ({
        name: at(certSlots[i].nameIdx, c.name),
        issuingBody: at(certSlots[i].issuingBodyIdx, c.issuingBody),
        date: c.date,
      })));
    }

    if (otherSectionsBase.length) {
      setCustomSections(otherSectionsBase.map((s, i) => ({
        title: at(otherSectionTitleSlots[i], s.title),
        points: s.points,
      })));
    }
  }

  async function handleUploadCv() {
    if (!cvFile) return;
    setUploadingCv(true);
    setUploadCvError("");
    try {
      const body = new FormData();
      body.append("file", cvFile);
      const res = await fetch("/api/extract-cv", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.data) throw new Error(data.error || "تعذّر استخراج البيانات من الملف.");

      const detected = data.data.detectedLanguage === "en" || data.data.detectedLanguage === "ar" ? data.data.detectedLanguage : null;
      if (detected && detected !== cvLang) {
        setDetectedCvLang(detected);
        setPendingExtractedData(data.data);
        setShowLangMismatchModal(true);
      } else {
        applyExtractedData(data.data);
        setSourceChosen(true);
      }
    } catch (err) {
      setUploadCvError(err.message || "تعذّر استخراج البيانات من الملف. أعد المحاولة، أو يمكنك المتابعة وتعبئة النموذج يدوياً.");
    } finally {
      setUploadingCv(false);
    }
  }

  // "الرجوع للتعديل" / "Go back and edit" — returns to the language
  // selection screen (unconfirming langConfirmed) so the applicant can
  // change the selected CV language or re-choose. Discards the pending
  // extraction so a stale mismatch never lingers if they upload again.
  function cancelLangMismatch() {
    setShowLangMismatchModal(false);
    setPendingExtractedData(null);
    setDetectedCvLang(null);
    setCvFile(null);
    setUploadCvError("");
    setShowUploadPanel(false);
    setPriorConfirmedLang(cvLang);
    setLangConfirmed(false);
  }

  // "المتابعة" / "Continue" — proceeds with the translation-aware mapping
  // path instead of the plain applyExtractedData used for matching-language
  // uploads.
  async function continueLangMismatch() {
    const extracted = pendingExtractedData;
    setShowLangMismatchModal(false);
    if (!extracted) return;
    setTranslatingCv(true);
    try {
      await applyExtractedDataWithTranslation(extracted);
      setTranslationApplied(true);
    } finally {
      setTranslatingCv(false);
      setPendingExtractedData(null);
      setDetectedCvLang(null);
      setSourceChosen(true);
    }
  }

  const L = cvLang === "en" ? {
    city: "City", experienceHeading: "Work Experience & Training", expCard: "Experience",
    jobTitle: "Job Title", employer: "Employer", from: "From", to: "To", month: "Month", year: "Year",
    currentJob: "I currently work here", bulletsLabel: "Responsibilities & Achievements",
    bulletsHint: "Add each task or achievement as its own point. Start with a strong verb and add numbers where possible.",
    bulletsPh: "e.g. Prepared journal entries and reviewed accounts", addBulletPoint: "Add point",
    dateOrderError: "End date must be after the start date.",
    overlapWarning: "Note: some experience periods overlap — please double-check the dates.",
    addExp: "Add another experience",
    eduHeading: "Educational Qualification", eduCard: "Qualification", degree: "Degree",
    specialization: "Specialization / Major", specializationSearchPh: "Search or select a major...",
    university: "University",
    gradYear: "Graduation Year", gpa: "GPA (optional)", addEdu: "Add another qualification",
    gpaScaleLabel: "Scale", gpaScalePh: "Scale...", gpaScaleOutOf4: "Out of 4", gpaScaleOutOf5: "Out of 5",
    gpaExceedsScaleError: "GPA cannot exceed the selected scale.",
    gpaScaleRequiredHint: "Select a scale to show the GPA on your CV.",
    gradProject: "Graduation Project (optional)", gradProjectPh: "e.g. Inventory Management System",
    universityOtherRequired: "Please enter the university name.",
    skillsHeading: "Skills & Languages", techSkillsLabel: "Technical Skills",
    techSkillsPh: "Search or type a skill and press Enter", techSkillsHint: "Pick from the list or type your own, then press Enter.",
    softSkillsLabel: "Professional Skills", languagesLabel: "Languages", langCard: "Language",
    langName: "Language", proficiency: "Proficiency", addLang: "Add language",
    extraHeading: "Additional Sections (Optional)",
    achievementsHeading: "Achievements", achievementsHint: "Optional — one entry per achievement.",
    achievementsPh: "e.g. Employee of the Year 2023", addAchievement: "Add achievement",
    coursesTitle: "Training Courses", coursesHint: "Optional.", courseCard: "Course",
    courseName: "Course Name", courseHours: "Hours", courseProvider: "Provider / Institution",
    courseDate: "Completion Date (optional)",
    addCourse: "Add another course",
    courseLicenseToggle: "Did you get a license / certificate number?",
    courseLicenseLabel: "License / Certificate Number",
    altPhoneToggle: "Show a different phone number on the CV",
    altPhoneLabel: "CV Phone Number",
    targetRolesLabel: "Target Role(s)",
    targetRolesPh: "Search or select a role...",
    targetRolesHint: "You can select more than one, or add your own. Used to tailor your experience — it will not appear in the PDF.",
    targetCitiesLabel: "Target Cities",
    targetCitiesPh: "Select one or more cities...",
    targetCitiesHint: "These help us reach the companies you're targeting — the cities you choose determine how many companies we can reach on your behalf. Not shown on the CV PDF.",
    internalNotesLabel: "Internal Notes (optional)",
    internalNotesPh: "e.g. Please don't send my CV to my current company at jobs@xxx.sa",
    internalNotesHint: "For our staff only — never processed by AI and never shown on the CV PDF.",
    certsHeading: "Certifications & Memberships", certsSubheading: "Standalone professional certifications and memberships (not training courses).",
    certsHint: "Optional — e.g. SOCPA, CMA, or a professional membership.",
    certCard: "Certification / Membership", certName: "Certification / Membership Name",
    certIssuingBody: "Issuing Body", certDate: "Date (optional)", addCert: "Add another certification",
    customSectionsTitle: "Custom Sections", customSectionsHint: "Optional — add any section not covered above (e.g. Volunteering, Publications). You can add more than one.",
    customSectionCard: "Custom Section", customSectionTitleLabel: "Section Title", customSectionTitlePh: "e.g. Volunteering",
    customSectionTitleEnglishOnly: "The section title must be entered in English only for an English CV (no translation).",
    customSectionPointsLabel: "Points", customSectionPointPh: "e.g. Organized a community fundraising event", addCustomSectionPoint: "Add point",
    addCustomSection: "Add custom section",
    changeLanguageLabel: "Change CV language",
    changeMethodLabel: "Change filling method",
    methodChangeWarningTitle: "Change filling method?",
    methodChangeWarningBody: "Some data you've already entered may be lost — do you want to continue?",
    methodChangeWarningConfirm: "Yes, continue",
    methodChangeWarningCancel: "Cancel",
    arabicBlockedNotice: "This field must be entered in English only for the English CV (no translation).",
    englishBlockedNotice: "This field must be entered in Arabic only for the Arabic CV (no translation).",
    translatingCv: "Translating your CV...",
    preparingCv: "Preparing your CV...",
    nameLabel: "Full Name",
    phoneLabel: "Phone Number",
    requiredFieldsTitle: "Required fields are missing",
    requiredFieldsIntro: "Please complete the following before you can preview or export your CV:",
    requiredFieldsGoTo: "Go to this field",
    requiredFieldsClose: "OK",
  } : {
    city: "المدينة", experienceHeading: "الخبرات العملية والتدريب", expCard: "خبرة",
    jobTitle: "المسمى الوظيفي", employer: "جهة العمل", from: "من", to: "إلى", month: "الشهر", year: "السنة",
    currentJob: "لا زلت أعمل هنا", bulletsLabel: "المهام والإنجازات",
    bulletsHint: "أضف كل مهمة أو إنجاز كنقطة مستقلة. ابدأ بفعل قوي وأضف رقماً كلما أمكن.",
    bulletsPh: "مثال: إعداد القيود اليومية ومراجعة الحسابات", addBulletPoint: "إضافة نقطة",
    dateOrderError: "تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.",
    overlapWarning: "تنبيه: فترات الخبرات متداخلة، تأكد من صحتها.",
    addExp: "إضافة خبرة أخرى",
    eduHeading: "المؤهل العلمي", eduCard: "مؤهل", degree: "الدرجة",
    specialization: "التخصص", specializationSearchPh: "ابحث أو اختر التخصص...",
    university: "الجامعة",
    gradYear: "سنة التخرج", gpa: "المعدل (اختياري)", addEdu: "إضافة مؤهل آخر",
    gpaScaleLabel: "المقياس", gpaScalePh: "المقياس...", gpaScaleOutOf4: "من 4", gpaScaleOutOf5: "من 5",
    gpaExceedsScaleError: "المعدل لا يمكن أن يتجاوز المقياس المختار.",
    gpaScaleRequiredHint: "اختر المقياس ليظهر المعدل في سيرتك الذاتية.",
    gradProject: "مشروع التخرج (اختياري)", gradProjectPh: "مثال: نظام إدارة المخزون",
    universityOtherRequired: "الرجاء إدخال اسم الجامعة.",
    skillsHeading: "المهارات واللغات", techSkillsLabel: "المهارات التقنية",
    techSkillsPh: "ابحث أو اكتب مهارة واضغط Enter", techSkillsHint: "اختر من القائمة أو اكتب مهارتك الخاصة ثم اضغط Enter.",
    softSkillsLabel: "المهارات المهنية", languagesLabel: "اللغات", langCard: "لغة",
    langName: "اللغة", proficiency: "المستوى", addLang: "إضافة لغة",
    extraHeading: "أقسام إضافية (اختيارية)",
    achievementsHeading: "الإنجازات", achievementsHint: "اختياري — كل إنجاز كسطر مستقل.",
    achievementsPh: "مثال: موظف العام 2023", addAchievement: "إضافة إنجاز",
    coursesTitle: "الدورات التدريبية", coursesHint: "اختياري.", courseCard: "دورة",
    courseName: "اسم الدورة", courseHours: "عدد الساعات", courseProvider: "الجهة المانحة",
    courseDate: "تاريخ الحصول عليها (اختياري)",
    addCourse: "إضافة دورة أخرى",
    courseLicenseToggle: "هل حصلت على ترخيص / رقم شهادة؟",
    courseLicenseLabel: "رقم الترخيص / الشهادة",
    altPhoneToggle: "عرض رقم جوال مختلف في السيرة الذاتية",
    altPhoneLabel: "رقم الجوال في السيرة",
    targetRolesLabel: "الوظيفة/الوظائف المستهدفة",
    targetRolesPh: "ابحث أو اختر وظيفة...",
    targetRolesHint: "يمكنك اختيار أكثر من وظيفة، أو إضافة وظيفة غير موجودة بالقائمة. تُستخدم لتخصيص تجربتك فقط — لن تظهر في ملف الـ PDF.",
    targetCitiesLabel: "المدن المستهدفة",
    targetCitiesPh: "اختر مدينة واحدة أو أكثر...",
    targetCitiesHint: "يساعدنا اختيارك في الوصول إلى الشركات التي تستهدفها — عدد الشركات التي يمكننا التواصل معها نيابةً عنك يتحدد بناءً على اختيارك هنا. لن تظهر في ملف الـ PDF.",
    internalNotesLabel: "ملاحظات داخلية (اختياري)",
    internalNotesPh: "مثال: الرجاء عدم إرسال سيرتي الذاتية لشركتي الحالية على jobs@xxx.sa",
    internalNotesHint: "لفريقنا فقط — لا تتم معالجتها بالذكاء الاصطناعي، ولن تظهر في ملف الـ PDF.",
    certsHeading: "الشهادات والعضويات المهنية", certsSubheading: "شهادات وعضويات مهنية مستقلة (وليست دورات تدريبية).",
    certsHint: "اختياري — مثل SOCPA أو CMA أو عضوية مهنية.",
    certCard: "شهادة / عضوية", certName: "اسم الشهادة / العضوية",
    certIssuingBody: "الجهة المانحة", certDate: "التاريخ (اختياري)", addCert: "إضافة شهادة أخرى",
    customSectionsTitle: "أقسام مخصصة", customSectionsHint: "اختياري — أضف أي قسم غير موجود أعلاه (مثل التطوع أو المنشورات). يمكنك إضافة أكثر من قسم.",
    customSectionCard: "قسم مخصص", customSectionTitleLabel: "عنوان القسم", customSectionTitlePh: "مثال: التطوع",
    customSectionTitleEnglishOnly: "عنوان القسم يجب إدخاله بالأحرف الإنجليزية فقط للسيرة الإنجليزية (بدون ترجمة).",
    customSectionPointsLabel: "النقاط", customSectionPointPh: "مثال: تنظيم حملة تبرع خيرية في المجتمع المحلي", addCustomSectionPoint: "إضافة نقطة",
    addCustomSection: "إضافة قسم مخصص",
    changeLanguageLabel: "تغيير لغة السيرة الذاتية",
    changeMethodLabel: "تغيير طريقة التعبئة",
    methodChangeWarningTitle: "تغيير طريقة التعبئة؟",
    methodChangeWarningBody: "سيتم فقدان البيانات المُدخلة — هل تريد المتابعة؟",
    methodChangeWarningConfirm: "نعم، متابعة",
    methodChangeWarningCancel: "إلغاء",
    arabicBlockedNotice: "يجب إدخال هذا الحقل بالأحرف الإنجليزية فقط للسيرة الإنجليزية (بدون ترجمة).",
    englishBlockedNotice: "يجب إدخال هذا الحقل بالأحرف العربية فقط للسيرة العربية (بدون ترجمة).",
    translatingCv: "جارٍ ترجمة سيرتك الذاتية...",
    preparingCv: "جارٍ تجهيز سيرتك...",
    nameLabel: "الاسم الكامل",
    phoneLabel: "رقم الجوال",
    requiredFieldsTitle: "هناك حقول مطلوبة غير مكتملة",
    requiredFieldsIntro: "يُرجى إكمال ما يلي قبل التمكن من معاينة أو تصدير سيرتك الذاتية:",
    requiredFieldsGoTo: "الانتقال لهذا الحقل",
    requiredFieldsClose: "حسنًا",
  };

  // ── Validation (gentle, non-blocking) ──
  const phoneValid = !form.phone || PHONE_RE.test(form.phone.replace(/[\s-]/g, ""));
  const emailValid = !form.email || EMAIL_RE.test(form.email.trim());
  const nameValid = isValidNamePartCount(form.name);
  const phoneError = !phoneValid && (cvLang === "en" ? "Enter a valid Saudi number (+9665XXXXXXXX or 05XXXXXXXX)." : "أدخل رقماً سعودياً صحيحاً (+9665XXXXXXXX أو 05XXXXXXXX).");
  const emailError = !emailValid && (cvLang === "en" ? "Enter a valid email address." : "الرجاء إدخال بريد إلكتروني صحيح.");
  const nameError = !nameValid && t.nameThreePartsError;

  // ── Derived plain values fed to the (untouched) preview + PDF generator ──
  const cityValue = form.cityChoice === OTHER ? form.cityCustom : form.cityChoice;
  // The number shown ON the CV is the main contact number, unless the user
  // explicitly opted into a separate CV-only number.
  const cvPhoneValue = useAltCvPhone && form.displayPhone ? form.displayPhone : form.phone;
  // Auto-calculated from the experience entries themselves (see
  // calculateTotalExperienceMonths/formatYearsOfExperiencePhrase above) —
  // there's no manual "years of experience" field anymore, so this is
  // always in sync with what's actually on the CV and can't drift into the
  // duplicated-label bug the old manual/extracted value was prone to.
  const computedYearsOfExperience = formatYearsOfExperiencePhrase(calculateTotalExperienceMonths(experiences), cvLang);
  // Single clean "email | phone | city | LinkedIn | years experience" line —
  // no dedicated headline field is collected, so the professional title
  // under the name is simply the most recent role's job title, if any.
  const contactLineParts = [form.email, cvPhoneValue, cityValue, form.linkedin, computedYearsOfExperience].filter(Boolean);

  // Resolves an AI-enhanceable item to whatever it should actually show/
  // export as right now: the AI version, a manual edit, or a reverted-to-
  // original choice — enhancedItems is the single source of truth for all
  // three once enhancement has run; before that (or if a key was never
  // collected — e.g. an empty bullet) it just falls back to the raw text.
  const getEnhancedText = (key, fallback) => enhancedItems[key]?.current ?? fallback;

  // Sorted most-recent-first for the generated CV, regardless of the order
  // entries were added in the form — an ongoing role always ranks above
  // any finished one. _origIndex is carried through the sort so bullets can
  // still be matched back to their stable "exp-{origIndex}-bullet-{j}" key.
  const displayExperiences = sortExperiencesDesc(experiences.map((x, i) => ({ ...x, _origIndex: i }))).map((x) => ({
    _origIndex: x._origIndex,
    // Employer + job title render in ALL CAPS on English CVs only (Arabic
    // has no case distinction, so this never applies there) — display-only:
    // the underlying stored value stays normal case, so re-editing the
    // form always shows what was actually typed.
    title: cvLang === "en" ? (x.title || "").toUpperCase() : x.title,
    employer: cvLang === "en" ? (x.employer || "").toUpperCase() : x.employer,
    period: formatPeriod(x, cvLang),
    // Joined back into the newline-per-point string the (untouched) PDF
    // template already expects — the structured list is purely a form-UX
    // improvement, the output format is unchanged.
    bullets: (x.bullets || [])
      .map((b, j) => (b.trim() ? getEnhancedText(`exp-${x._origIndex}-bullet-${j}`, b.trim()) : ""))
      .filter(Boolean)
      .join("\n"),
  }));
  const cvHeadline = displayExperiences.find((x) => x.title || x.employer)?.title || "";

  const displayEducation = education.map((x, i) => {
    const degreeLabel = x.degreeChoice === OTHER ? x.degreeCustom : x.degreeChoice;
    const specialization = x.specializationChoice === OTHER ? x.specializationCustom : x.specializationChoice;
    const school = x.schoolChoice === OTHER ? x.schoolCustom : x.schoolChoice;
    const gradProjectRaw = x.gradProject ? x.gradProject.trim() : "";
    return {
      _origIndex: i,
      degree: [degreeLabel, specialization].filter(Boolean).join(" "),
      school,
      year: x.year,
      // "4.5 / 5" (English) or "4.5 من 5" (Arabic) — empty (renders
      // nothing) unless both a value and a valid, in-range scale are set.
      // Used for the client-side preview; the raw gpaValue/gpaScale below
      // are sent alongside it so the server (generate-pdf) can
      // independently re-validate and re-format rather than trusting this
      // already-sanitized string — see cvHtmlTemplate.js's own
      // formatGpaValue/gpaExceedsScale.
      detail: formatGpaValue(x.gpaValue, x.gpaScale, cvLang),
      gpaValue: x.gpaValue,
      gpaScale: x.gpaScale,
      gradProject: gradProjectRaw ? getEnhancedText(`eduGradProject-${i}`, gradProjectRaw) : "",
    };
  });

  const displayCourses = courses.filter((c) => c.name || c.hours || c.provider || c.date);
  const displayCertifications = certifications.filter((c) => c.name || c.issuingBody || c.date);
  const displayAchievementsStr = achievements
    .map((a, i) => (a.trim() ? getEnhancedText(`achievement-${i}`, a.trim()) : ""))
    .filter(Boolean)
    .join("\n");
  // Title: spell-checked only (see collectCustomSectionTitles), resolved
  // as plain text — like every other section heading in the CV, it's not
  // an editable/toggle-able field. Points: polished exactly like
  // achievements, resolved as a newline-joined string for the (untouched)
  // PDF template's splitLines() convention.
  const displayCustomSections = customSections
    .map((s, i) => ({
      _origIndex: i,
      title: s.title.trim() ? getEnhancedText(`customSectionTitle-${i}`, s.title.trim()) : "",
      points: (s.points || [])
        .map((p, j) => (p.trim() ? getEnhancedText(`customSection-${i}-point-${j}`, p.trim()) : ""))
        .filter(Boolean)
        .join("\n"),
    }))
    .filter((s) => s.title || s.points);

  const techSkillsStr = techSkillTags.join(sep);
  const softSkillsStr = softSkillTags.join(sep);
  // Only populated for a sparse CV (rule #7) — carries each skill's
  // description through to the server for both validation (min 5+5, each
  // described) and PDF/Word rendering (skills-with-descriptions bullets).
  // Empty for every normal CV, so nothing changes for the common case.
  const skillDetails = isSparseCv(experiences)
    ? {
        tech: techSkillTags.map((s) => ({ name: s, description: techSkillDescriptions[s] || "" })),
        soft: softSkillTags.map((s) => ({ name: s, description: softSkillDescriptions[s] || "" })),
      }
    : { tech: [], soft: [] };

  // Context for the AI skill-suggestion buttons (rule #6) — job title +
  // experience + education + target role, matching what the route expects.
  const skillSuggestExperienceSummary = experiences
    .filter((x) => x.title?.trim() || x.employer?.trim())
    .map((x) => [x.title, x.employer, (x.bullets || []).filter((b) => b.trim()).join("; ")].filter(Boolean).join(" — "))
    .join("\n");
  const skillSuggestEducationSummary = education
    .filter((x) => x.degreeChoice || x.schoolChoice || x.specializationChoice)
    .map((x) => [
      x.degreeChoice === OTHER ? x.degreeCustom : x.degreeChoice,
      x.specializationChoice === OTHER ? x.specializationCustom : x.specializationChoice,
      x.schoolChoice === OTHER ? x.schoolCustom : x.schoolChoice,
    ].filter(Boolean).join(" — "))
    .join("\n");
  // "أخرى/Other" resolves to its typed-in custom text; never rendered into
  // the PDF (see form.targetCities below) — only shown in the admin/Staff1
  // panels, same treatment as targetRoles.
  const targetCitiesStr = targetCities
    .map((c) => (c === OTHER ? (targetCitiesOther.trim() ? `${cvLang === "en" ? "Other: " : "أخرى: "}${targetCitiesOther.trim()}` : "") : c))
    .filter(Boolean)
    .join(sep);
  const languagesStr = languageEntries
    .filter((l) => (l.langChoice === OTHER ? l.langCustom.trim() : l.langChoice))
    .map((l) => {
      const name = l.langChoice === OTHER ? l.langCustom : l.langChoice;
      return `${name}${l.level ? ` — ${l.level}` : ""}`;
    })
    .join(" | ");

  // Single confirm exports both files. The PDF is the critical/blocking
  // half — its success is still the one thing that marks the session
  // complete (matching the single-use access code's server-side
  // consumption, which only the PDF route triggers). Word is generated
  // right after, best-effort: if it fails, the order is already complete
  // and the applicant just sees a graceful note on the thank-you screen
  // instead of being blocked or shown an error.
  async function downloadCvFiles() {
    // Defense-in-depth alongside proceedToPreview's own check — nothing on
    // the preview screen lets these specific fields (name/phone/target
    // roles/dates/education) change, but exporting must never rely on
    // "the earlier gate must still be true" being an invariant forever.
    const issues = findMissingRequiredFields();
    if (issues.length) {
      setShowExportModal(false);
      setMissingFieldIssues(issues);
      setShowMissingFieldsModal(true);
      // Back to the editable form, where the missing-fields modal (below,
      // rendered on the form screen) can jump straight to the right step.
      setPreview(false);
      return;
    }
    setDownloading(true);
    setExportError("");
    setWordUnavailable(false);

    const payload = {
      form: {
        name: form.name,
        email: form.email,
        phone: cvPhoneValue,
        city: cityValue,
        // Collected for future AI/matching features, but neither export
        // template renders these into the CV output.
        targetRoles: targetRoles.join(sep),
        // Staff-only, never on either export (see lib/cvArchive.js /
        // lib/cvHtmlTemplate.js / lib/cvDocxTemplate.js — none render these).
        targetCities: targetCitiesStr,
        internalNotes,
        yearsOfExperience: computedYearsOfExperience,
        linkedin: form.linkedin,
        summary: form.summary,
        achievements: displayAchievementsStr,
        languages: languagesStr,
      },
      experiences: displayExperiences,
      // Alongside the display-formatted experiences above (title/employer/
      // period/bullets) — the server-side quality-rule validation needs the
      // raw date fields (fromMonth/fromYear/toMonth/toYear/current), which
      // displayExperiences doesn't carry. Never rendered into the CV.
      rawExperiences: experiences,
      education: displayEducation,
      courses: displayCourses,
      certifications: displayCertifications,
      customSections: displayCustomSections,
      techSkills: techSkillsStr,
      softSkills: softSkillsStr,
      // Only non-empty for a sparse CV (rule #7) — see skillDetails above.
      skillDetails,
      lang: cvLang,
      accessCode,
    };
    const safeName = (form.name || "CV").replace(/\s+/g, "_");

    // iOS Safari doesn't support forced downloads (the `download` attribute
    // is ignored) and revoking a blob: URL right after triggering it — as a
    // desktop-style anchor click normally does — races Safari's own async
    // handling of that URL and surfaces as "WebKitBlobResource error 1".
    // The reliable path on iOS is to hand each file to Safari's built-in
    // viewer (the user saves it from there via the Share sheet) in a tab
    // opened synchronously *before* the network request, so neither is
    // blocked as a popup once we're past the awaited fetches below — both
    // tabs must be opened up front, in the same click gesture.
    const isIOS = typeof navigator !== "undefined" && (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const iosTabPdf = isIOS ? window.open("", "_blank") : null;
    const iosTabDocx = isIOS ? window.open("", "_blank") : null;

    try {
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PDF generation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (isIOS && iosTabPdf) {
        iosTabPdf.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}_CV.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Give the browser time to actually open/consume the blob URL before
      // freeing it — revoking too early is what causes the iOS Safari error.
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      // Only reached on a successful PDF download — this is the single
      // place the session gets marked complete, per the single-use access
      // code. Word is attempted next but can no longer affect this.
      setShowExportModal(false);
      setExportCompleted(true);
      clearProgress();
    } catch (e) {
      if (iosTabPdf) iosTabPdf.close();
      if (iosTabDocx) iosTabDocx.close();
      setExportError(e.message && e.message !== "PDF generation failed" ? e.message : "تعذّر إنشاء الملف. تحقّق من اتصالك وحاول مرة أخرى.");
      setDownloading(false);
      return;
    }

    try {
      // A short gap before triggering the second download — firing two
      // download prompts back-to-back risks the browser's "this site is
      // trying to download multiple files" block on the second one.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const res = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Word generation failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (isIOS && iosTabDocx) {
        iosTabDocx.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}_CV.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      if (iosTabDocx) iosTabDocx.close();
      setWordUnavailable(true);
    } finally {
      setDownloading(false);
    }
  }

  // Everything the summary is actually generated FROM — compared against
  // summaryInputSnapshot on every Preview visit to decide whether the
  // cached summary is still valid (see the summaryInputSnapshot state
  // comment above). cvLang is included too as a safety net alongside
  // resetDerivedAiOutput's own language-switch handling, not as its only
  // line of defense.
  // Deliberately built from RAW form state (experiences/education as typed),
  // never from displayExperiences/displayEducation — those two route bullet
  // text and graduation-project text through getEnhancedText(), which
  // returns whatever's already stored in enhancedItems for that key. Since
  // enhancedItems is populated asynchronously (concurrently with this very
  // summary call, via generateAiEnhancements), a snapshot built from them
  // captures a moving target: it can differ from itself between two preview
  // visits even when the user changed nothing, purely because enhancedItems
  // caught up to the AI response in between — this was observed to cause a
  // spurious extra regeneration on the visit right after any real change.
  // Raw state changes synchronously the instant the user types, so it's a
  // stable, race-free basis for "did the input actually change."
  function buildSummaryInputSnapshot() {
    return JSON.stringify({
      lang: cvLang,
      targetRoles: targetRoles.join(sep),
      yearsOfExperience: computedYearsOfExperience,
      experiences: experiences.map((x) => ({
        title: x.title, employer: x.employer, period: formatPeriod(x, cvLang),
        bullets: (x.bullets || []).map((b) => b.trim()).filter(Boolean).join("\n"),
      })),
      education: education.map((x) => ({
        degree: x.degreeChoice === OTHER ? x.degreeCustom : x.degreeChoice,
        specialization: x.specializationChoice === OTHER ? x.specializationCustom : x.specializationChoice,
        school: x.schoolChoice === OTHER ? x.schoolCustom : x.schoolChoice,
        year: x.year,
        gpaValue: x.gpaValue,
        gpaScale: x.gpaScale,
        gradProject: x.gradProject,
      })),
      achievements: achievements.map((a) => a.trim()).filter(Boolean),
      techSkills: techSkillsStr,
      softSkills: softSkillsStr,
    });
  }

  // Called whenever proceedToPreview finds the summary's input has changed
  // (or it's never been generated) — never overwrites a summary whose
  // input snapshot still matches the current input.
  async function generateAiSummary() {
    const snapshot = buildSummaryInputSnapshot();
    setAiSummaryLoading(true);
    setAiSummaryError("");
    try {
      const res = await fetch("/api/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang: cvLang,
          targetRoles: targetRoles.join(sep),
          yearsOfExperience: computedYearsOfExperience,
          experiences: displayExperiences,
          education: displayEducation,
          achievements: displayAchievementsStr,
          techSkills: techSkillsStr,
          softSkills: softSkillsStr,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.summary) throw new Error(data.error || "AI summary generation failed");
      setForm((f) => ({ ...f, summary: data.summary }));
      setSummaryEdited(false);
      // Only recorded on success — a failed attempt leaves this at its
      // previous value (or null), so the NEXT Preview visit still sees
      // the input as "stale" and retries, even if nothing changed since
      // the failed attempt.
      setSummaryInputSnapshot(snapshot);
    } catch (err) {
      // The server route already logs full diagnostic detail for this
      // failure (see [AI-SUMMARY-ERROR] in server logs) — this is just the
      // client-side trace, useful when the failure happened before a
      // response ever came back (e.g. a network error).
      console.error("[AI-SUMMARY-ERROR] client:", err?.message || err);
      setAiSummaryError(t.summaryGenerateError);
    } finally {
      setAiSummaryLoading(false);
      setAiSummaryGenerated(true);
    }
  }

  // Flat list of every AI-enhanceable item currently in the form, keyed
  // stably so the preview can match responses back to the right bullet/
  // achievement/graduation project regardless of experience sort order.
  function collectEnhancementItems() {
    const keys = [];
    const texts = [];
    experiences.forEach((x, i) => {
      (x.bullets || []).forEach((b, j) => {
        if (b.trim()) {
          keys.push(`exp-${i}-bullet-${j}`);
          texts.push(b.trim());
        }
      });
    });
    achievements.forEach((a, i) => {
      if (a.trim()) {
        keys.push(`achievement-${i}`);
        texts.push(a.trim());
      }
    });
    education.forEach((x, i) => {
      if (x.gradProject && x.gradProject.trim()) {
        keys.push(`eduGradProject-${i}`);
        texts.push(x.gradProject.trim());
      }
    });
    customSections.forEach((s, i) => {
      (s.points || []).forEach((p, j) => {
        if (p.trim()) {
          keys.push(`customSection-${i}-point-${j}`);
          texts.push(p.trim());
        }
      });
    });
    return { keys, texts };
  }

  // Custom-section TITLES go through a separate, much narrower AI call
  // (spell-check only, never rephrased) — see collectEnhancementItems above
  // for the points, which are polished exactly like achievements/bullets.
  function collectCustomSectionTitles() {
    const keys = [];
    const texts = [];
    customSections.forEach((s, i) => {
      if (s.title && s.title.trim()) {
        keys.push(`customSectionTitle-${i}`);
        texts.push(s.title.trim());
      }
    });
    return { keys, texts };
  }

  // Compares each currently-collected item's raw text against the raw text
  // its stored result was generated from (enhancedItems[key].original) —
  // an item with no entry yet, no AI result yet, or whose raw text no
  // longer matches what it was last generated from is "stale" and needs
  // a fresh call; everything else already reflects its current input and
  // is left alone.
  function splitStaleItems(keys, texts) {
    const staleKeys = [];
    const staleTexts = [];
    keys.forEach((k, idx) => {
      const existing = enhancedItems[k];
      if (!existing || existing.ai == null || existing.original !== texts[idx]) {
        staleKeys.push(k);
        staleTexts.push(texts[idx]);
      }
    });
    return { staleKeys, staleTexts };
  }

  // Called on every Preview visit (not gated by a single "has this ever
  // run" flag) — only the bullets/achievements/grad projects/custom-
  // section points/titles whose raw text actually changed since their
  // last successful result (see splitStaleItems) are sent for
  // re-enhancement, so editing one bullet after going back from preview
  // never re-translates every other unchanged one. Run alongside (not
  // blocking on) the separate title spell-check call so either can fail
  // independently and fall back to the applicant's original text/title
  // without affecting the other.
  async function generateAiEnhancements() {
    const { keys, texts } = collectEnhancementItems();
    const { keys: titleKeys, texts: titleTexts } = collectCustomSectionTitles();
    const { staleKeys, staleTexts } = splitStaleItems(keys, texts);
    const { staleKeys: staleTitleKeys, staleTexts: staleTitleTexts } = splitStaleItems(titleKeys, titleTexts);

    if (!staleKeys.length && !staleTitleKeys.length) {
      setItemsEnhanced(true);
      return;
    }

    // Seed the stale items immediately with their (new) raw text — the
    // preview never shows a blank/loading placeholder for them, and any
    // manual edit tied to the OLD raw text is cleared here since that
    // text no longer exists to have been edited from.
    setEnhancedItems((prev) => {
      const next = { ...prev };
      staleKeys.forEach((k, idx) => { next[k] = { original: staleTexts[idx], ai: null, current: staleTexts[idx], edited: false }; });
      staleTitleKeys.forEach((k, idx) => { next[k] = { original: staleTitleTexts[idx], ai: null, current: staleTitleTexts[idx], edited: false }; });
      return next;
    });

    setAiItemsLoading(true);
    setAiItemsError("");

    const [itemsOutcome, titlesOutcome] = await Promise.allSettled([
      staleKeys.length
        ? fetch("/api/enhance-items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang: cvLang, items: staleTexts }),
          }).then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
        : Promise.resolve(null),
      staleTitleKeys.length
        ? fetch("/api/spellcheck-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang: cvLang, titles: staleTitleTexts }),
          }).then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
        : Promise.resolve(null),
    ]);

    // Points (bullets/achievements/grad projects/custom-section points):
    // a failure here is user-visible via aiItemsError, same as before this
    // feature — custom-section points are just more of the same kind of item.
    let itemsFailed = false;
    if (staleKeys.length) {
      const outcome = itemsOutcome.status === "fulfilled" ? itemsOutcome.value : null;
      if (outcome?.ok && Array.isArray(outcome.data.items) && outcome.data.items.length === staleTexts.length) {
        setEnhancedItems((prev) => {
          const next = { ...prev };
          staleKeys.forEach((k, idx) => {
            if (next[k]?.edited) return; // a manual edit made WHILE this call was in flight wins
            next[k] = { original: staleTexts[idx], ai: outcome.data.items[idx], current: outcome.data.items[idx], edited: false };
          });
          return next;
        });
      } else {
        itemsFailed = true;
      }
    }

    // Title spell-check: conservative and low-stakes by design, so a
    // failure here just silently keeps the seeded original title — no
    // shared error banner, matching "fall back to original, nothing crashes".
    if (staleTitleKeys.length) {
      const outcome = titlesOutcome.status === "fulfilled" ? titlesOutcome.value : null;
      if (outcome?.ok && Array.isArray(outcome.data.titles) && outcome.data.titles.length === staleTitleTexts.length) {
        setEnhancedItems((prev) => {
          const next = { ...prev };
          staleTitleKeys.forEach((k, idx) => {
            if (next[k]?.edited) return;
            next[k] = { original: staleTitleTexts[idx], ai: outcome.data.titles[idx], current: outcome.data.titles[idx], edited: false };
          });
          return next;
        });
      }
    }

    if (itemsFailed) setAiItemsError(t.itemsGenerateError);
    setAiItemsLoading(false);
    setItemsEnhanced(true);
  }

  function setItemCurrent(key, value) {
    setEnhancedItems((prev) => ({ ...prev, [key]: { ...prev[key], current: value, edited: true } }));
  }

  // Both the original and the AI/suggested version are already generated
  // and stored on the item (original/ai) — toggling just switches which
  // of the two already-stored strings is shown as "current" and flips the
  // button's own label to name the OTHER one (tap "Original text" to see
  // the original; once shown, the same button becomes "Suggested text" to
  // switch back) — never calls the AI again. Discards a manual edit in
  // favor of whichever stored version was just picked, same as picking
  // either version has always meant "use this one," now in a single tap
  // instead of a separate reveal-then-confirm step.
  function toggleOriginal(key) {
    const item = enhancedItems[key];
    if (!item || item.ai == null) return;
    const nowShowingOriginal = !originalToggles[key];
    setOriginalToggles((prev) => ({ ...prev, [key]: nowShowingOriginal }));
    setEnhancedItems((prev) => ({
      ...prev,
      [key]: { ...prev[key], current: nowShowingOriginal ? prev[key].original : prev[key].ai, edited: false },
    }));
  }

  // Renders one AI-enhanceable item: an editable field showing whatever is
  // "current" (AI text, a manual edit, or the toggled-to original), plus —
  // once an AI version actually exists — a one-tap toggle between the two
  // already-stored versions.
  function enhancedItemBlock(key, fallbackText) {
    const item = enhancedItems[key] || { original: fallbackText, ai: null, current: fallbackText };
    const hasAiVersion = item.ai != null;
    const showingOriginal = !!originalToggles[key];
    return (
      <div>
        <AutoTextarea
          value={item.current}
          onChange={(e) => setItemCurrent(key, e.target.value)}
          dir={cvDir}
        />
        {hasAiVersion && (
          <button type="button" onClick={() => toggleOriginal(key)} style={originalToggleBtn} className="no-print">
            {showingOriginal ? t.suggestedTextLabel : t.originalTextLabel}
          </button>
        )}
      </div>
    );
  }

  // Purely informational — every one of these is a legitimate thing to
  // leave blank (a fresh graduate has no experience, many CVs skip
  // certifications), so this only ever nudges, never blocks proceeding.
  // Checked one section at a time, right when the applicant leaves that
  // section (see goToNextStep) — not lumped together before the preview.
  function sectionEmptyLabel(stepIndex) {
    if (stepIndex === 1) return !experiences.some((x) => (x.title || "").trim() || (x.employer || "").trim()) ? t.experience : null;
    if (stepIndex === 2) return !education.some((x) => x.schoolChoice || x.schoolCustom?.trim() || x.degreeChoice) ? t.education : null;
    if (stepIndex === 3) return techSkillTags.length === 0 && softSkillTags.length === 0 ? t.skills : null;
    if (stepIndex === 4) return !achievements.some((a) => a.trim()) ? t.achievements : null;
    return null;
  }

  function goToNextStep() {
    if (!canProceed()) return;
    const label = sectionEmptyLabel(step);
    if (label) {
      setSectionWarningLabel(label);
      setPendingStepAdvance(step + 1);
      setShowSectionWarningModal(true);
      return;
    }
    setStep(step + 1);
  }

  async function proceedToPreview() {
    const issues = findMissingRequiredFields();
    if (issues.length) {
      setMissingFieldIssues(issues);
      setShowMissingFieldsModal(true);
      return;
    }
    setPreview(true);
    // generateAiEnhancements always runs — it checks per-item staleness
    // itself (see splitStaleItems) and resolves immediately if nothing
    // changed, so this never means "re-translate everything on every
    // Preview visit," only "check whether anything needs it." The summary
    // has its own equivalent check (buildSummaryInputSnapshot).
    // The truncation check only fires when the box still holds the AI's
    // own, never-touched output (!summaryEdited) — a user's deliberate
    // manual edit that happens not to end in punctuation must never be
    // silently discarded.
    const summaryStale =
      !aiSummaryGenerated ||
      buildSummaryInputSnapshot() !== summaryInputSnapshot ||
      (!summaryEdited && looksTruncated(form.summary));
    const tasks = [summaryStale ? generateAiSummary() : null, generateAiEnhancements()].filter(Boolean);
    setPreviewGenerating(true);
    try {
      await Promise.allSettled(tasks);
    } finally {
      setPreviewGenerating(false);
    }
  }

  // ─────────────────── LANGUAGE (chosen first) ───────────────────
  if (!langConfirmed) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: THEME.pageBg, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 420, background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: 28, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ background: THEME.primary, width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <LanguagesIcon size={20} color="#ffffff" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: THEME.primary }}>لغة السيرة الذاتية</div>
          </div>
          <div style={{ fontSize: 12.5, color: THEME.text, marginBottom: 20 }}>
            اختر اللغة التي تريد أن تصدر بها سيرتك الذاتية (PDF). ستُعبَّأ بيانات النموذج بهذه اللغة فقط.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {[{ code: "ar", label: "العربية" }, { code: "en", label: "English" }].map((opt) => (
              <button
                key={opt.code}
                onClick={() => setCvLang(opt.code)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: `1.5px solid ${cvLang === opt.code ? THEME.primary : THEME.border}`,
                  background: cvLang === opt.code ? THEME.soft : "transparent",
                  color: THEME.primary,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "start",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button onClick={() => confirmLanguage(cvLang)} style={{ ...btnPrimary, width: "100%" }}>متابعة</button>
        </div>
      </div>
    );
  }

  // ─────────── UPLOAD EXISTING CV, OR START FRESH (one-time fork) ───────────
  if (!sourceChosen) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: THEME.pageBg, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 440, background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: 28, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ background: THEME.primary, width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Upload size={20} color="#ffffff" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: THEME.primary }}>لديك سيرة ذاتية جاهزة؟</div>
          </div>
          <div style={{ fontSize: 12.5, color: THEME.text, marginBottom: 20, lineHeight: 1.8 }}>
            ارفعها لنعبّئ بياناتك تلقائيًا، ثم راجعها وعدّلها كما تشاء — أو ابدأ من نموذج فارغ.
          </div>

          {!showUploadPanel ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => setShowUploadPanel(true)} style={{ ...btnPrimary, width: "100%" }}>
                <Upload size={16} /> ارفع سيرتك الذاتية وعبّئ النموذج تلقائيًا
              </button>
              <button onClick={() => setSourceChosen(true)} style={{ ...btnGhost, width: "100%", justifyContent: "center" }}>
                ابدأ من نموذج فارغ
              </button>
            </div>
          ) : (
            <div>
              <input
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => { setCvFile(e.target.files?.[0] || null); setUploadCvError(""); }}
                style={inputStyle}
              />
              <div style={{ ...hintStyle, marginBottom: 16 }}>الصيغ المدعومة: PDF أو Word (.docx)، بحد أقصى 4 ميجابايت. البيانات المستخرجة هي مسودة أولية — راجعها وصحّحها قبل التصدير.</div>
              <button
                onClick={handleUploadCv}
                disabled={uploadingCv || translatingCv || !cvFile}
                style={{ ...btnPrimary, width: "100%", opacity: uploadingCv || translatingCv || !cvFile ? 0.7 : 1 }}
              >
                {uploadingCv
                  ? <><Loader2 size={16} className="spin" /> جارٍ استخراج البيانات...</>
                  : translatingCv
                  ? <><Loader2 size={16} className="spin" /> {L.translatingCv}</>
                  : "رفع ومتابعة"}
              </button>
              {uploadCvError && (
                <div style={{ marginTop: 12 }}>
                  <div style={warnStyle}>{uploadCvError}</div>
                  <button onClick={() => setSourceChosen(true)} style={{ ...btnGhost, width: "100%", justifyContent: "center", marginTop: 8 }}>
                    المتابعة بنموذج فارغ بدلاً من ذلك
                  </button>
                </div>
              )}
              <button
                onClick={() => { setShowUploadPanel(false); setCvFile(null); setUploadCvError(""); }}
                disabled={uploadingCv || translatingCv}
                style={{ ...btnGhost, width: "100%", justifyContent: "center", marginTop: 10, opacity: uploadingCv || translatingCv ? 0.5 : 1 }}
              >
                رجوع
              </button>
            </div>
          )}
        </div>

        {showLangMismatchModal && (
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 100 }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="lang-mismatch-title"
              aria-describedby="lang-mismatch-desc"
              style={{ width: "100%", maxWidth: 420, background: THEME.card, borderRadius: 14, padding: 24, boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
            >
              {/* Shown bilingually (EN + AR together), always, regardless
                  of the selected CV language — see langMismatchBodyBilingual. */}
              <div id="lang-mismatch-title" dir="ltr" style={{ fontSize: 16.5, fontWeight: 800, color: THEME.primary, marginBottom: 10, textAlign: "start" }}>
                Language mismatch <span dir="rtl" style={{ opacity: 0.75 }}>/ اختلاف في اللغة</span>
              </div>
              <div id="lang-mismatch-desc" style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.9, marginBottom: 20 }}>
                {(() => {
                  const body = langMismatchBodyBilingual(cvLang, detectedCvLang);
                  return (
                    <>
                      <p dir="ltr" style={{ margin: 0, marginBottom: 12, textAlign: "start" }}>{body.en}</p>
                      <p dir="rtl" style={{ margin: 0, textAlign: "start" }}>{body.ar}</p>
                    </>
                  );
                })()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button type="button" onClick={continueLangMismatch} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>
                  Continue / المتابعة
                </button>
                <button type="button" onClick={cancelLangMismatch} style={{ ...btnGhost, width: "100%", justifyContent: "center" }}>
                  Go back and edit / الرجوع للتعديل
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─────────────── POST-EXPORT THANK-YOU (bilingual) ───────────────
  // Reached only after a genuinely successful PDF download (see
  // downloadCvFiles, which is the single place exportCompleted flips
  // true) — the access code is single-use, so this is the natural end of
  // the flow rather than a banner layered on top of a CV the applicant
  // can no longer usefully edit. The Word download may still be in
  // flight at this point (it's kicked off right after the PDF succeeds);
  // if it fails, wordUnavailable flips true and this screen picks that up
  // reactively without blocking or delaying the thank-you message itself.
  if (exportCompleted) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: THEME.pageBg, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 460, background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 12, padding: 32, boxShadow: "0 1px 3px rgba(20,40,60,.06)", textAlign: "center" }}>
          <div style={{ background: THEME.primary, width: 56, height: 56, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
            <CheckCircle2 size={28} color="#ffffff" />
          </div>
          <div style={{ fontSize: 13.5, color: THEME.text, lineHeight: 2, marginBottom: 14 }} dir="rtl">
            {THANK_YOU_MESSAGE_BILINGUAL.ar}
          </div>
          <div style={{ height: 1, background: THEME.border, margin: "16px 0" }} />
          <div style={{ fontSize: 13.5, color: THEME.text, lineHeight: 2 }} dir="ltr">
            {THANK_YOU_MESSAGE_BILINGUAL.en}
          </div>
          {wordUnavailable && (
            <div style={{ ...warnStyle, background: "#fbeaea", borderRadius: 8, padding: "10px 12px", marginTop: 16, textAlign: "center" }} dir="rtl">
              تم تصدير PDF بنجاح، لكن تعذّر إنشاء نسخة Word هذه المرة.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ───────────────────────── PREVIEW ─────────────────────────
  if (preview) {
    return (
      <div dir={cvDir} style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
        {/* Blocking loading overlay — covers the preview from the moment
            proceedToPreview triggers generation until it settles (success
            or graceful fallback), so the applicant never sees a flash of
            unpolished/original text quietly swap to the AI version. */}
        {previewGenerating && (
          <div
            role="alert"
            aria-busy="true"
            className="no-print"
            style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 200 }}
          >
            <div
              dir={cvDir}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, background: THEME.card, borderRadius: 14, padding: "28px 36px", boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
            >
              <Loader2 size={28} className="spin" color={THEME.primary} />
              <div style={{ fontSize: 14.5, fontWeight: 700, color: THEME.primary }}>{L.preparingCv}</div>
            </div>
          </div>
        )}

        {/* toolbar - hidden on print. exportCompleted redirects to the
            dedicated thank-you screen above before this ever renders, so
            the export button here is always the "not yet exported" state. */}
        <div dir="rtl" className="no-print" style={{ background: C.ink, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
          <button onClick={() => setPreview(false)} style={btnGhostLight}>
            <ChevronRight size={16} /> رجوع للتعديل
          </button>
          <button
            onClick={() => { setExportError(""); setShowExportModal(true); }}
            disabled={downloading}
            style={{ ...btnBrass, opacity: downloading ? 0.7 : 1 }}
          >
            {downloading ? <><Loader2 size={16} className="spin" /> جارٍ التحميل...</> : <><Download size={16} /> تصدير PDF و Word</>}
          </button>
        </div>

        {showExportModal && (
          <div
            role="presentation"
            onClick={() => { if (!downloading) { setShowExportModal(false); setExportError(""); } }}
            style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 100 }}
          >
            <div
              dir="rtl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-modal-title"
              aria-describedby="export-modal-desc"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "100%", maxWidth: 430, background: THEME.card, borderRadius: 14, padding: 26, boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
            >
              <div id="export-modal-title" style={{ fontSize: 17.5, fontWeight: 800, color: THEME.primary, marginBottom: 12 }}>
                تأكيد تصدير السيرة الذاتية
              </div>
              <div id="export-modal-desc" style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.95, marginBottom: exportError ? 12 : 22 }}>
                بمجرد تصدير سيرتك الذاتية بصيغتي PDF و Word، سيُعتبر طلبك مكتملاً. لإنشاء سيرة جديدة أو إجراء تعديلات لاحقاً، ستحتاج إلى تقديم طلب جديد والحصول على رمز جديد. هل أنت متأكد من رغبتك في التصدير الآن؟
              </div>
              {exportError && (
                <div style={{ ...warnStyle, background: "#fbeaea", borderRadius: 8, padding: "10px 12px", marginBottom: 22 }}>{exportError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={downloadCvFiles} disabled={downloading} style={{ ...btnPrimary, width: "100%", opacity: downloading ? 0.7 : 1, cursor: downloading ? "wait" : "pointer" }}>
                  {downloading ? <><Loader2 size={16} className="spin" /> جارٍ التصدير...</> : "نعم، تصدير PDF و Word"}
                </button>
                <button
                  onClick={() => { setShowExportModal(false); setExportError(""); }}
                  disabled={downloading}
                  style={{ ...btnGhost, width: "100%", justifyContent: "center", opacity: downloading ? 0.5 : 1, cursor: downloading ? "not-allowed" : "pointer" }}
                >
                  رجوع للتعديل
                </button>
              </div>
            </div>
          </div>
        )}

        {aiItemsError && (
          <div dir={cvDir} className="no-print" style={{ maxWidth: 700, margin: "16px auto 0", padding: "10px 16px" }}>
            <div style={{ ...warnStyle, background: "#fbeaea", borderRadius: 8, padding: "10px 12px" }}>{aiItemsError}</div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", padding: "24px 12px 60px" }}>
          <div className="cv-page" style={cvPage}>
            {/* Header: name + professional headline (the most recent role's title) */}
            <div style={{ borderBottom: `2.5px solid ${C.ink}`, paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: 0.3 }}>{form.name || t.fallbackName}</div>
              {cvHeadline && <div style={{ fontSize: 13.5, color: C.slate, marginTop: 3, fontWeight: 600 }}>{cvHeadline}</div>}
              {contactLineParts.length > 0 && (
                <div style={{ fontSize: 12, color: C.slate, marginTop: 9 }}>{contactLineParts.join(" | ")}</div>
              )}
            </div>

            {(aiSummaryLoading || form.summary || aiSummaryGenerated) && (
              <Section title={t.summary}>
                {aiSummaryLoading ? (
                  <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.slate }}>
                    <Loader2 size={14} className="spin" /> {t.summaryGenerating}
                  </div>
                ) : (
                  <>
                    {aiSummaryError && (
                      <div className="no-print" style={{ ...warnStyle, marginBottom: 6 }}>{aiSummaryError}</div>
                    )}
                    <AutoTextarea
                      value={form.summary}
                      onChange={(e) => { setSummaryEdited(true); setForm((f) => ({ ...f, summary: guardLangInput("summary", e.target.value) })); }}
                      onBlur={(e) => setForm((f) => ({ ...f, summary: stripProseOnBlur("summary", e.target.value) }))}
                      placeholder={t.summaryPlaceholder}
                      dir={cvDir}
                    />
                    {blockedField === "summary" && (
                      <div className="no-print" style={warnStyle}>{cvLang === "en" ? L.arabicBlockedNotice : L.englishBlockedNotice}</div>
                    )}
                    <div className="no-print" style={{ fontSize: 10.5, color: C.slate, marginTop: 3 }}>{t.summaryEditHint}</div>
                  </>
                )}
              </Section>
            )}

            {(techSkillTags.length > 0 || softSkillTags.length > 0) && (
              <Section title={t.skills}>
                {techSkillTags.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <span style={skillCat}>{t.techSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{techSkillTags.join(" | ")}</span>
                  </div>
                )}
                {softSkillTags.length > 0 && (
                  <div>
                    <span style={skillCat}>{t.softSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{softSkillTags.join(" | ")}</span>
                  </div>
                )}
              </Section>
            )}

            {displayExperiences.some((x) => x.title || x.employer) && (
              <Section title={t.experience}>
                {displayExperiences.filter((x) => x.title || x.employer).map((x, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, color: C.ink, fontSize: 13.5 }}>
                      {[x.title, x.employer, x.period].filter(Boolean).join(" | ")}
                    </div>
                    {(experiences[x._origIndex]?.bullets || []).some((b) => b.trim()) && (
                      <ul style={ulBody(cvDir)}>
                        {(experiences[x._origIndex]?.bullets || []).map((b, j) => b.trim() ? (
                          <li key={j} style={liBody(cvDir)}>{enhancedItemBlock(`exp-${x._origIndex}-bullet-${j}`, b.trim())}</li>
                        ) : null)}
                      </ul>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {displayEducation.some((x) => x.degree || x.school) && (
              <Section title={t.education}>
                {displayEducation.filter((x) => x.degree || x.school).map((x, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                      {[x.degree, x.school, x.year].filter(Boolean).join(" | ")}
                    </div>
                    {x.detail && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}><strong style={{ color: C.ink }}>{t.gpa}:</strong> {x.detail}</div>}
                    {education[x._origIndex]?.gradProject?.trim() && (
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                        <strong style={{ color: C.ink }}>{t.gradProject}:</strong>
                        {enhancedItemBlock(`eduGradProject-${x._origIndex}`, education[x._origIndex].gradProject.trim())}
                      </div>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {achievements.some((a) => a.trim()) && (
              <Section title={t.achievements}>
                <ul style={ulBody(cvDir)}>
                  {achievements.map((a, i) => a.trim() ? (
                    <li key={i} style={liBody(cvDir)}>{enhancedItemBlock(`achievement-${i}`, a.trim())}</li>
                  ) : null)}
                </ul>
              </Section>
            )}

            {displayCourses.length > 0 && (
              <Section title={t.courses}>
                {displayCourses.map((x, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                      {[x.name, x.provider, x.hours && `${x.hours} ${t.hoursUnit}`, x.date].filter(Boolean).join(" | ")}
                    </div>
                    {x.hasLicense && x.licenseNumber && (
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}><strong style={{ color: C.ink }}>{t.licenseNumber}:</strong> {x.licenseNumber}</div>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {displayCertifications.length > 0 && (
              <Section title={t.certs}>
                {displayCertifications.map((x, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                      {[x.name, x.issuingBody, x.date].filter(Boolean).join(" | ")}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {displayCustomSections.map((s) => (
              <Section key={s._origIndex} title={s.title || t.customSectionFallbackTitle}>
                {s.points && (
                  <ul style={ulBody(cvDir)}>
                    {customSections[s._origIndex].points.map((p, j) => p.trim() ? (
                      <li key={j} style={liBody(cvDir)}>{enhancedItemBlock(`customSection-${s._origIndex}-point-${j}`, p.trim())}</li>
                    ) : null)}
                  </ul>
                )}
              </Section>
            ))}

            {/* Always absolute last, after any custom sections — see the
                matching order in cvHtmlTemplate.js's buildCvHtml. */}
            {languagesStr && (
              <Section title={t.languages}>
                <p style={pBody}>{languagesStr}</p>
              </Section>
            )}
          </div>
        </div>

        <style>{printCSS}</style>
      </div>
    );
  }

  // ───────────────────────── FORM ─────────────────────────
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: THEME.pageBg, fontFamily: "'Segoe UI', Tahoma, sans-serif", color: THEME.text }}>
      <div style={{ background: THEME.primary, padding: "22px 24px", borderBottom: `3px solid ${THEME.secondary}` }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: THEME.secondary, width: 42, height: 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileText size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ color: "#ffffff", fontSize: 19, fontWeight: 700 }}>منشئ السيرة الذاتية — ATS</div>
            <div style={{ color: THEME.soft, fontSize: 12.5 }}>عبّئ بياناتك واحصل على سيرة بصيغة PDF متوافقة مع أنظمة التوظيف</div>
          </div>
          <img
            src="/wazifti-logo.jpeg"
            alt="وظيفتي"
            style={{ height: 34, maxHeight: 34, width: "auto", maxWidth: 110, objectFit: "contain", borderRadius: 6, background: "#ffffff", padding: "3px 6px", marginInlineStart: "auto", flexShrink: 0 }}
          />
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 20px 60px" }}>
        <div style={{ textAlign: "center", marginBottom: 10, fontSize: 12.5, color: THEME.text }}>
          لغة السيرة الذاتية الناتجة: <strong style={{ color: THEME.primary }}>{cvLang === "en" ? "English" : "العربية"}</strong>
        </div>

        {/* Additive back/change navigation — the existing step wizard below
            is completely untouched by this row. */}
        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={requestChangeLanguage} style={navLinkBtnStyle}>
            🌐 {L.changeLanguageLabel}
          </button>
          <button type="button" onClick={requestChangeMethod} style={navLinkBtnStyle}>
            🔄 {L.changeMethodLabel}
          </button>
        </div>

        {showMethodChangeWarning && (
          <div
            role="presentation"
            onClick={() => setShowMethodChangeWarning(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 100 }}
          >
            <div
              dir={cvDir}
              role="dialog"
              aria-modal="true"
              aria-labelledby="method-change-warning-title"
              aria-describedby="method-change-warning-desc"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "100%", maxWidth: 400, background: THEME.card, borderRadius: 14, padding: 24, boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
            >
              <div id="method-change-warning-title" style={{ fontSize: 16.5, fontWeight: 800, color: THEME.primary, marginBottom: 10 }}>
                {L.methodChangeWarningTitle}
              </div>
              <div id="method-change-warning-desc" style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.9, marginBottom: 20 }}>
                {L.methodChangeWarningBody}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button type="button" onClick={confirmChangeMethod} style={{ ...btnPrimary, width: "100%" }}>
                  {L.methodChangeWarningConfirm}
                </button>
                <button type="button" onClick={() => setShowMethodChangeWarning(false)} style={{ ...btnGhost, width: "100%", justifyContent: "center" }}>
                  {L.methodChangeWarningCancel}
                </button>
              </div>
            </div>
          </div>
        )}

        {cvLang === "en" && (
          <div style={{ ...noteBannerStyle, marginBottom: 18 }}>{t.arabicAllowedNote}</div>
        )}

        {/* Stepper */}
        <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <button key={s.key} onClick={() => setStep(i)} style={{ flex: "1 1 130px", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: active ? THEME.primary : done ? THEME.soft : THEME.card, border: `1px solid ${active ? THEME.primary : THEME.border}`, cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: active ? THEME.secondary : done ? THEME.primary : THEME.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {done ? <CheckCircle2 size={15} color="#fff" /> : <Icon size={15} color={active ? "#ffffff" : THEME.text} />}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? "#ffffff" : THEME.text }}>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ background: THEME.card, borderRadius: 12, border: `1px solid ${THEME.border}`, padding: 26, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
          {/* STEP 0 - Personal */}
          {step === 0 && (
            <>
              <SectionTitle>البيانات الشخصية والهدف الوظيفي</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {field("name", "الاسم الكامل", form.name, set("name"), { req: true, ph: "عادل علي الأجاجي", error: nameError })}
                {field("email", "البريد الإلكتروني", form.email, set("email"), { ph: "name@email.com", error: emailError })}
                {field("phone", "رقم الجوال", form.phone, set("phone"), { req: true, ph: "+9665xxxxxxxx", error: phoneError })}
                {selectWithOther(
                  "city", L.city, form.cityChoice, form.cityCustom,
                  (v) => setForm({ ...form, cityChoice: v }),
                  (v) => setForm({ ...form, cityCustom: v }),
                  cityOptions
                )}
                {field("linkedin", "رابط LinkedIn (اختياري)", form.linkedin, set("linkedin"), { ph: "https://linkedin.com/in/name" })}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: THEME.text, marginBottom: 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useAltCvPhone}
                  onChange={(e) => setUseAltCvPhone(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: THEME.primary }}
                />
                {L.altPhoneToggle}
              </label>
              {useAltCvPhone && field("displayPhone", L.altPhoneLabel, form.displayPhone, set("displayPhone"), { ph: "+9665xxxxxxxx", hint: "يظهر في السيرة الذاتية بدلاً من رقم الجوال أعلاه." })}

              {tagsInput("targetRoles", `${L.targetRolesLabel} *`, targetRoles, setTargetRoles, { ph: L.targetRolesPh, hint: L.targetRolesHint, suggestions: roleOptions })}
              {multiSelectWithOther("targetCities", L.targetCitiesLabel, targetCities, setTargetCities, targetCitiesOther, setTargetCitiesOther, targetCitiesOptions, { ph: L.targetCitiesPh, hint: L.targetCitiesHint })}
              {fieldArea("internalNotes", L.internalNotesLabel, internalNotes, (e) => setInternalNotes(e.target.value), { ph: L.internalNotesPh, hint: L.internalNotesHint, rows: 3 })}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{t.summary}</label>
                <div style={{ background: THEME.soft, border: `1px solid ${THEME.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 13, color: THEME.text, lineHeight: 1.8 }}>
                  {t.summaryAiNote}
                </div>
              </div>
            </>
          )}

          {/* STEP 1 - Experience */}
          {step === 1 && (
            <>
              <SectionTitle>{L.experienceHeading}</SectionTitle>
              {experiences.map((x, i) => (
                <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.expCard} #{i + 1}</span>
                    {experiences.length > 1 && (
                      <button onClick={() => rmExp(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field(`exp-${i}-title`, L.jobTitle, x.title, setExp(i, "title"), { ph: cvLang === "en" ? "Accountant" : "محاسب" })}
                    {field(`exp-${i}-employer`, L.employer, x.employer, setExp(i, "employer"), { ph: cvLang === "en" ? "Company..." : "شركة ..." })}
                  </div>

                  <label style={labelStyle}>{L.from}</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <select value={x.fromMonth} onChange={setExp(i, "fromMonth")} style={inputStyle}>
                      <option value="">{L.month}</option>
                      {monthOptions.map((m, idx) => <option key={idx + 1} value={idx + 1}>{m}</option>)}
                    </select>
                    <select value={x.fromYear} onChange={setExp(i, "fromYear")} style={inputStyle}>
                      <option value="">{L.year}</option>
                      {expYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>

                  {!x.current && (
                    <>
                      <label style={labelStyle}>{L.to}</label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: dateRangeInvalid(x) ? 6 : 14 }}>
                        <select value={x.toMonth} onChange={setExp(i, "toMonth")} style={inputStyle}>
                          <option value="">{L.month}</option>
                          {monthOptions.map((m, idx) => <option key={idx + 1} value={idx + 1}>{m}</option>)}
                        </select>
                        <select value={x.toYear} onChange={setExp(i, "toYear")} style={inputStyle}>
                          <option value="">{L.year}</option>
                          {expYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
                      {dateRangeInvalid(x) && <div style={{ ...warnStyle, marginBottom: 14 }}>{L.dateOrderError}</div>}
                    </>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: THEME.text, marginBottom: 14, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={x.current}
                      onChange={(e) => setExp(i, "current")({ target: { value: e.target.checked } })}
                      style={{ width: 16, height: 16, accentColor: THEME.primary }}
                    />
                    {L.currentJob}
                  </label>

                  {listInput(`exp-${i}-bullets`, L.bulletsLabel, x.bullets, (items) => setExp(i, "bullets")({ target: { value: items } }), {
                    ph: L.bulletsPh, addLabel: L.addBulletPoint, hint: L.bulletsHint,
                    suggest: {
                      kind: "bullets",
                      context: {
                        jobTitle: x.title || "",
                        employer: x.employer || "",
                        yearsOfExperience: computedYearsOfExperience,
                        specialization: (education[0]?.specializationChoice === OTHER ? education[0]?.specializationCustom : education[0]?.specializationChoice) || "",
                        targetRole: targetRoles.join(sep),
                      },
                    },
                  })}
                  {!isExperienceEntryComplete(x) && <div style={{ ...warnStyle, marginTop: 10 }}>{t.experienceIncompleteError}</div>}
                </div>
              ))}
              <button onClick={addExp} style={btnAdd}><Plus size={16} /> {L.addExp}</button>
              {anyExperiencesOverlap(experiences) && <div style={{ ...warnStyle, marginTop: 12 }}>{L.overlapWarning}</div>}
            </>
          )}

          {/* STEP 2 - Education */}
          {step === 2 && (
            <>
              <SectionTitle>{L.eduHeading}</SectionTitle>
              {education.map((x, i) => (
                <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.eduCard} #{i + 1}</span>
                    {education.length > 1 && (
                      <button onClick={() => rmEdu(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {selectWithOther(
                      `edu-${i}-degree`, L.degree, x.degreeChoice, x.degreeCustom,
                      (v) => setEdu(i, "degreeChoice")({ target: { value: v } }),
                      (v) => setEdu(i, "degreeCustom")({ target: { value: v } }),
                      degreeOptions
                    )}
                    {searchableSelect(
                      `edu-${i}-specialization`, L.specialization, x.specializationChoice, x.specializationCustom,
                      (v) => setEdu(i, "specializationChoice")({ target: { value: v } }),
                      (v) => setEdu(i, "specializationCustom")({ target: { value: v } }),
                      majorOptions, { ph: L.specializationSearchPh }
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {selectWithOther(
                      `edu-${i}-school`, L.university, x.schoolChoice, x.schoolCustom,
                      (v) => setEdu(i, "schoolChoice")({ target: { value: v } }),
                      (v) => setEdu(i, "schoolCustom")({ target: { value: v } }),
                      universityOptions, { otherRequired: true, otherRequiredMsg: L.universityOtherRequired }
                    )}
                    {selectField(`edu-${i}-year`, L.gradYear, x.year, setEdu(i, "year"), gradYearOptions)}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={labelStyle}>{L.gpa}</label>
                      <input
                        value={x.gpaValue}
                        onChange={(e) => setEdu(i, "gpaValue")({ target: { value: normalizeGpaInput(e.target.value) } })}
                        placeholder="4.5"
                        style={inputStyle}
                        inputMode="decimal"
                      />
                      {gpaExceedsScale(x.gpaValue, x.gpaScale) && <div style={warnStyle}>{L.gpaExceedsScaleError}</div>}
                      {x.gpaValue && !x.gpaScale && <div style={hintStyle}>{L.gpaScaleRequiredHint}</div>}
                    </div>
                    <div>
                      <label style={labelStyle}>{L.gpaScaleLabel}</label>
                      <select value={x.gpaScale} onChange={setEdu(i, "gpaScale")} style={inputStyle}>
                        <option value="">{L.gpaScalePh}</option>
                        <option value="4">{L.gpaScaleOutOf4}</option>
                        <option value="5">{L.gpaScaleOutOf5}</option>
                      </select>
                    </div>
                  </div>
                  {field(`edu-${i}-gradProject`, L.gradProject, x.gradProject, setEdu(i, "gradProject"), { ph: L.gradProjectPh })}
                </div>
              ))}
              <button onClick={addEdu} style={btnAdd}><Plus size={16} /> {L.addEdu}</button>
            </>
          )}

          {/* STEP 3 - Skills */}
          {step === 3 && (
            <>
              <SectionTitle>{L.skillsHeading}</SectionTitle>
              {isSparseCv(experiences) && <div style={{ ...warnStyle, marginBottom: 14 }}>{t.sparseSkillsHint}</div>}
              {tagsInput("techSkills", L.techSkillsLabel, techSkillTags, setTechSkillTags, {
                ph: L.techSkillsPh, hint: L.techSkillsHint, suggestions: techSkillSuggestions,
                suggest: {
                  kind: "technical",
                  context: {
                    jobTitle: cvHeadline || "",
                    experienceSummary: skillSuggestExperienceSummary,
                    educationSummary: skillSuggestEducationSummary,
                    targetRoles: targetRoles.join(sep),
                    existingSkills: techSkillsStr,
                  },
                },
              })}
              {tagsInput("softSkills", L.softSkillsLabel, softSkillTags, setSoftSkillTags, {
                ph: L.techSkillsPh, suggestions: softSkillSuggestions,
                suggest: {
                  kind: "soft",
                  context: {
                    jobTitle: cvHeadline || "",
                    experienceSummary: skillSuggestExperienceSummary,
                    educationSummary: skillSuggestEducationSummary,
                    targetRoles: targetRoles.join(sep),
                    existingSkills: softSkillsStr,
                  },
                },
              })}
              {isSparseCv(experiences) && (techSkillTags.length > 0 || softSkillTags.length > 0) && (
                <div style={{ marginBottom: 24 }}>
                  <label style={labelStyle}>{t.skillDescriptionPlaceholder}</label>
                  {[...techSkillTags.map((s) => ({ s, set: setTechSkillDescriptions, val: techSkillDescriptions })), ...softSkillTags.map((s) => ({ s, set: setSoftSkillDescriptions, val: softSkillDescriptions }))].map(({ s, set: setDesc, val }, i) => (
                    <div key={`${s}-${i}`} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: THEME.secondary, marginBottom: 4 }}>{s}</div>
                      <input
                        value={val[s] || ""}
                        onChange={(e) => setDesc((prev) => ({ ...prev, [s]: e.target.value }))}
                        placeholder={t.skillDescriptionPlaceholder}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              )}

              <label style={labelStyle}>{L.languagesLabel}</label>
              {languageEntries.map((l, i) => (
                <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.langCard} #{i + 1}</span>
                    {languageEntries.length > 1 && (
                      <button onClick={() => rmLang(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {selectWithOther(
                      `lang-${i}-name`, L.langName, l.langChoice, l.langCustom,
                      (v) => setLang(i, "langChoice")({ target: { value: v } }),
                      (v) => setLang(i, "langCustom")({ target: { value: v } }),
                      languageOptions
                    )}
                    {selectField(`lang-${i}-level`, L.proficiency, l.level, setLang(i, "level"), levelOptions)}
                  </div>
                </div>
              ))}
              <button onClick={addLang} style={btnAdd}><Plus size={16} /> {L.addLang}</button>
            </>
          )}

          {/* STEP 4 - Extra optional sections: Projects, Achievements, Training Courses */}
          {step === 4 && (
            <>
              <SectionTitle>{L.extraHeading}</SectionTitle>

              {/* Achievements */}
              <div style={{ marginBottom: 24 }}>
                {listInput("achievements", L.achievementsHeading, achievements, setAchievements, {
                  ph: L.achievementsPh, addLabel: L.addAchievement, hint: L.achievementsHint,
                  suggest: {
                    kind: "achievements",
                    context: {
                      jobTitle: cvHeadline || "",
                      yearsOfExperience: computedYearsOfExperience,
                      specialization: (education[0]?.specializationChoice === OTHER ? education[0]?.specializationCustom : education[0]?.specializationChoice) || "",
                      targetRole: targetRoles.join(sep),
                    },
                  },
                })}
              </div>

              {/* Training Courses */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary, marginBottom: 4 }}>{L.coursesTitle}</div>
                <div style={hintStyle}>{L.coursesHint}</div>
                {courses.map((x, i) => (
                  <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginTop: 12, marginBottom: 14, background: THEME.card }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.courseCard} #{i + 1}</span>
                      <button onClick={() => rmCourse(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {field(`course-${i}-name`, L.courseName, x.name, setCourse(i, "name"), {})}
                      {field(`course-${i}-hours`, L.courseHours, x.hours, setCourse(i, "hours"), { numeric: true })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {field(`course-${i}-provider`, L.courseProvider, x.provider, setCourse(i, "provider"), {})}
                      {selectField(`course-${i}-date`, L.courseDate, x.date, setCourse(i, "date"), pastYearOptions)}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: THEME.text, marginTop: 4, marginBottom: x.hasLicense ? 14 : 0, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!x.hasLicense}
                        onChange={(e) => setCourse(i, "hasLicense")({ target: { value: e.target.checked } })}
                        style={{ width: 16, height: 16, accentColor: THEME.primary }}
                      />
                      {L.courseLicenseToggle}
                    </label>
                    {x.hasLicense && field(`course-${i}-license`, L.courseLicenseLabel, x.licenseNumber, setCourse(i, "licenseNumber"), {})}
                    {!isCourseEntryComplete(x) && <div style={{ ...warnStyle, marginTop: 10 }}>{t.courseProviderRequiredError}</div>}
                  </div>
                ))}
                <button onClick={addCourse} style={{ ...btnAdd, marginTop: 12 }}><Plus size={16} /> {L.addCourse}</button>
              </div>

              {/* Certifications & Memberships (standalone credentials, distinct from Training Courses) */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary, marginBottom: 4 }}>{L.certsHeading}</div>
                <div style={hintStyle}>{L.certsSubheading}</div>
                <div style={{ ...hintStyle, marginBottom: 16 }}>{L.certsHint}</div>
                {certifications.map((x, i) => (
                  <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.certCard} #{i + 1}</span>
                      <button onClick={() => rmCert(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {field(`cert-${i}-name`, L.certName, x.name, setCert(i, "name"), { ph: "SOCPA" })}
                      {field(`cert-${i}-issuingBody`, L.certIssuingBody, x.issuingBody, setCert(i, "issuingBody"), {})}
                    </div>
                    {selectField(`cert-${i}-date`, L.certDate, x.date, setCert(i, "date"), pastYearOptions)}
                  </div>
                ))}
                <button onClick={addCert} style={{ ...btnAdd, marginTop: 12 }}><Plus size={16} /> {L.addCert}</button>
              </div>

              {/* Custom Sections — fully user-defined title + points, always last */}
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary, marginBottom: 4 }}>{L.customSectionsTitle}</div>
                <div style={hintStyle}>{L.customSectionsHint}</div>
                {customSections.map((s, i) => (
                  <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginTop: 12, marginBottom: 14, background: THEME.card }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.customSectionCard} #{i + 1}</span>
                      <button onClick={() => rmCustomSection(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>{L.customSectionTitleLabel}</label>
                      <input
                        value={s.title}
                        onChange={(e) => setCustomSectionTitle(i, e.target.value)}
                        placeholder={L.customSectionTitlePh}
                        style={inputStyle}
                      />
                      {blockedField === `customSectionTitle-${i}` && <div style={warnStyle}>{L.customSectionTitleEnglishOnly}</div>}
                    </div>
                    {listInput(`customSection-${i}-points`, L.customSectionPointsLabel, s.points, (items) => setCustomSectionPoints(i, items), {
                      ph: L.customSectionPointPh, addLabel: L.addCustomSectionPoint,
                    })}
                  </div>
                ))}
                <button onClick={addCustomSection} style={{ ...btnAdd, marginTop: 12 }}><Plus size={16} /> {L.addCustomSection}</button>
              </div>
            </>
          )}

          {/* Single review notice — shown once a mismatch-triggered
              translation was applied to this CV, on every step, right
              above Next so it's seen before moving on. Not per-field. */}
          {translationApplied && (
            <div
              role="note"
              style={{
                marginTop: 24, padding: "12px 16px", borderRadius: 10,
                background: "#fff8e6", border: "1px solid #e8c874",
                color: "#6b4e00", fontSize: 12.5, lineHeight: 1.8,
                display: "flex", alignItems: "flex-start", gap: 8,
              }}
            >
              <span style={{ flexShrink: 0 }}>⚠️</span>
              {/* Shown bilingually (EN + AR together), always — see
                  TRANSLATION_REVIEW_NOTICE_BILINGUAL. */}
              <span>
                <span dir="ltr" style={{ display: "block" }}>{TRANSLATION_REVIEW_NOTICE_BILINGUAL.en}</span>
                <span dir="rtl" style={{ display: "block", marginTop: 4 }}>{TRANSLATION_REVIEW_NOTICE_BILINGUAL.ar}</span>
              </span>
            </div>
          )}

          {/* Nav */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 20, borderTop: `1px solid ${THEME.border}` }}>
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} style={{ ...btnGhost, opacity: step === 0 ? 0.4 : 1, cursor: step === 0 ? "not-allowed" : "pointer" }}>
              <ChevronRight size={17} /> السابق
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={goToNextStep} disabled={!canProceed()} style={{ ...btnPrimary, opacity: canProceed() ? 1 : 0.5, cursor: canProceed() ? "pointer" : "not-allowed" }}>
                التالي <ChevronLeft size={17} />
              </button>
            ) : (
              <button onClick={proceedToPreview} style={{ ...btnPrimary, minWidth: 200 }}>
                <FileText size={17} /> معاينة السيرة الذاتية
              </button>
            )}
          </div>
          {step === 0 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: form.name?.trim() && !nameValid ? "#b3261e" : THEME.text, textAlign: "center" }}>
              {form.name?.trim() && !nameValid ? nameError : "* الاسم والجوال والوظيفة المستهدفة مطلوبة للمتابعة"}
            </div>
          )}
          {step === 1 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#b3261e", textAlign: "center" }}>
              {experiences.some(dateRangeInvalid) ? L.dateOrderError : t.experienceIncompleteError}
            </div>
          )}
          {step === 2 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#b3261e", textAlign: "center" }}>
              {education.some((x) => gpaExceedsScale(x.gpaValue, x.gpaScale)) ? L.gpaExceedsScaleError : L.universityOtherRequired}
            </div>
          )}
          {step === 3 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#b3261e", textAlign: "center" }}>{t.sparseSkillsMinimumError}</div>
          )}
          {step === 4 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#b3261e", textAlign: "center" }}>{t.courseProviderRequiredError}</div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11.5, color: THEME.text }}>
          بياناتك تُستخدَم فقط لتوليد ملفي PDF و Word عند الضغط على "تصدير PDF و Word"، ولا تُحفظ على أي خادم.
        </div>
      </div>

      {showSectionWarningModal && (
        <div
          role="presentation"
          onClick={() => setShowSectionWarningModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 100 }}
        >
          <div
            dir={cvDir}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 430, background: THEME.card, borderRadius: 14, padding: 26, boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
          >
            <div style={{ fontSize: 17.5, fontWeight: 800, color: THEME.primary, marginBottom: 12 }}>{t.missingSectionTitle}</div>
            <div style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.95, marginBottom: 18 }}>
              {t.missingSectionBody(sectionWarningLabel)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={() => { setShowSectionWarningModal(false); if (pendingStepAdvance != null) setStep(pendingStepAdvance); }}
                style={{ ...btnPrimary, width: "100%" }}
              >
                {t.missingSectionContinue}
              </button>
              <button onClick={() => setShowSectionWarningModal(false)} style={{ ...btnGhost, width: "100%", justifyContent: "center" }}>{t.missingSectionBack}</button>
            </div>
          </div>
        </div>
      )}

      {/* BLOCKING — unlike showSectionWarningModal above, there is no
          "continue anyway": these are the same requirements canProceed()
          already enforces per-step, just checked across every step at
          once (see findMissingRequiredFields), so there's nothing left to
          confirm past fixing them. */}
      {showMissingFieldsModal && (
        <div
          role="presentation"
          style={{ position: "fixed", inset: 0, background: "rgba(18,41,63,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 100 }}
        >
          <div
            dir={cvDir}
            role="dialog"
            aria-modal="true"
            style={{ width: "100%", maxWidth: 430, background: THEME.card, borderRadius: 14, padding: 26, boxShadow: "0 12px 40px rgba(18,41,63,.4)" }}
          >
            <div style={{ fontSize: 17.5, fontWeight: 800, color: THEME.primary, marginBottom: 12 }}>{L.requiredFieldsTitle}</div>
            <div style={{ fontSize: 13.5, color: THEME.text, lineHeight: 1.95, marginBottom: 14 }}>
              {L.requiredFieldsIntro}
            </div>
            <ul style={{ margin: "0 0 20px", padding: cvDir === "rtl" ? "0 20px 0 0" : "0 0 0 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {missingFieldIssues.map((issue, i) => (
                <li key={i} style={{ fontSize: 13.5, color: "#b3261e", fontWeight: 600 }}>{issue.message}</li>
              ))}
            </ul>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={() => { setShowMissingFieldsModal(false); setStep(missingFieldIssues[0].step); }}
                style={{ ...btnPrimary, width: "100%" }}
              >
                {L.requiredFieldsGoTo}
              </button>
              <button onClick={() => setShowMissingFieldsModal(false)} style={{ ...btnGhost, width: "100%", justifyContent: "center" }}>{L.requiredFieldsClose}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reusable pieces ──
function SectionTitle({ children }) {
  return <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a5c", marginBottom: 18 }}>{children}</div>;
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#000000", letterSpacing: 0.5, lineHeight: 1.8, marginBottom: 7, borderBottom: "1px solid #d0d0d0", paddingBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// Self-resizing, print-transparent textarea used for every editable CV
// field in the preview (summary, bullets, achievements, graduation
// project). A local ref+effect is needed (not just an onInput handler)
// because `value` can change programmatically — an AI result landing, or
// a saved session being restored — not just from user keystrokes.
function AutoTextarea({ value, onChange, onBlur, placeholder, dir }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      dir={dir}
      style={{ ...pBody, width: "100%", border: "1px dashed transparent", borderRadius: 4, padding: 2, resize: "none", overflow: "hidden", fontFamily: "inherit", background: "transparent" }}
      onFocus={(e) => { e.target.style.borderColor = THEME.border; }}
      onBlur={(e) => { e.target.style.borderColor = "transparent"; onBlur?.(e); }}
    />
  );
}

// ── Styles (form-only — the CV preview/PDF below keeps its own black/white styling) ──
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#3a4a5a", marginBottom: 6 };
const hintStyle = { fontSize: 11.5, color: "#3a4a5a", marginTop: 5, lineHeight: 1.5 };
const warnStyle = { fontSize: 11.5, color: "#b3261e", marginTop: 5, lineHeight: 1.5, fontWeight: 600 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const chipStyle = { display: "inline-flex", alignItems: "center", gap: 6, background: "#e8eef4", color: "#1a3a5c", borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 600 };
const chipRemoveStyle = { background: "transparent", border: "none", cursor: "pointer", color: "#1a3a5c", fontSize: 14, lineHeight: 1, padding: 0, fontWeight: 700 };
const dropdownListStyle = { position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0, marginTop: 4, background: "#ffffff", border: "1px solid #dde4ec", borderRadius: 8, boxShadow: "0 4px 16px rgba(20,40,60,.12)", maxHeight: 220, overflowY: "auto", zIndex: 20 };
const dropdownItemStyle = { padding: "9px 12px", fontSize: 13, color: "#3a4a5a", cursor: "pointer", borderBottom: "1px solid #f0f2f5" };
const noteBannerStyle = { background: "#e8eef4", border: "1px dashed #dde4ec", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#3a4a5a", textAlign: "center", lineHeight: 1.7 };
const suggestBtnStyle = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#1a3a5c", border: "1px solid #dde4ec", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 6 };

const cvPage = { width: "210mm", minHeight: "297mm", background: "#ffffff", padding: "18mm 16mm", boxShadow: "0 2px 16px rgba(20,40,60,.12)", boxSizing: "border-box" };
const pBody = { margin: 0, fontSize: 13, lineHeight: 1.85, color: "#333333", textAlign: "justify" };
const ulBody = (dir) => ({ margin: "5px 0 0", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 18, listStyle: "none" });
const liBody = (dir) => ({ fontSize: 12.5, lineHeight: 1.7, color: "#333333", position: "relative", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 12, marginBottom: 3 });
const skillCat = { fontWeight: 700, color: "#000000", fontSize: 12.5 };
const originalToggleBtn = { background: "transparent", border: "none", padding: 0, marginTop: 2, fontSize: 10.5, color: "#5a7590", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" };

const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#1a3a5c", border: "1px solid #dde4ec", borderRadius: 8, padding: "11px 18px", fontSize: 14, fontWeight: 600, fontFamily: "inherit" };
// btnGhostLight and btnBrass style the CV preview toolbar only — left as-is intentionally.
const btnGhostLight = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#ffffff", border: "1px solid #555555", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnBrass = { display: "inline-flex", alignItems: "center", gap: 7, background: "#000000", color: "#ffffff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnAdd = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#1a3a5c", border: "1.5px dashed #2d5578", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: "100%", justifyContent: "center" };
const btnIcon = { background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex" };
// Small text-link style for the form's back/change-language/change-method
// controls — deliberately understated so it doesn't compete with the main
// step wizard below it.
const navLinkBtnStyle = { background: "transparent", border: "none", color: "#2d5578", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: "4px 8px", textDecoration: "underline", textUnderlineOffset: 3 };

const printCSS = `
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  li:before { content: "▪"; position: absolute; right: 0; color: #000000; font-size: 8pt; top: 2px; }
  [dir="ltr"] li:before { right: auto; left: 0; }
  input::placeholder, textarea::placeholder { color: #a8a294; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid #000000; outline-offset: 1px; }
  @media print {
    .no-print { display: none !important; }
    body { background: #fff !important; }
    .cv-page { box-shadow: none !important; width: 100% !important; min-height: auto !important; padding: 0 !important; margin: 0 !important; }
    @page { size: A4; margin: 14mm 16mm; }
  }
`;
