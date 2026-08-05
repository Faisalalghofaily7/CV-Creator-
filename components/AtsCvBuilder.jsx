"use client";

import React, { useState, useEffect } from "react";
import { FileText, Download, ChevronLeft, ChevronRight, Plus, Trash2, User, Briefcase, GraduationCap, Award, Wrench, CheckCircle2, Loader2, Languages as LanguagesIcon, Layers } from "lucide-react";
import { CV_LABELS } from "../lib/cvLabels";

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
// forms) — used to block Arabic keystrokes when the chosen CV output
// language is English, so the two languages' data never mix in the PDF.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

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

const AR_DEGREES = ["الثانوية العامة", "دبلوم", "بكالوريوس", "ماجستير", "دكتوراه", "زمالة"];
const EN_DEGREES = ["High School", "Diploma", "Bachelor's", "Master's", "PhD", "Fellowship"];

const AR_UNIVERSITIES = ["جامعة الملك سعود", "جامعة الملك عبدالعزيز", "جامعة الملك فهد للبترول والمعادن", "جامعة الإمام محمد بن سعود", "جامعة القصيم", "جامعة الملك خالد", "جامعة أم القرى", "جامعة الملك فيصل", "جامعة طيبة", "جامعة الطائف", "جامعة حائل", "جامعة تبوك", "جامعة نجران", "جامعة جازان", "جامعة الأميرة نورة", "جامعة الملك سعود للعلوم الصحية"];
const EN_UNIVERSITIES = ["King Saud University", "King Abdulaziz University", "KFUPM", "Al-Imam Muhammad Ibn Saud Islamic University", "Qassim University", "King Khalid University", "Umm Al-Qura University", "King Faisal University", "Taibah University", "Taif University", "University of Hail", "University of Tabuk", "Najran University", "Jazan University", "Princess Nourah University", "King Saud bin Abdulaziz University for Health Sciences"];

const AR_LEVELS = ["مبتدئ", "متوسط", "متقدم", "طليق", "لغة أم"];
const EN_LEVELS = ["Beginner", "Intermediate", "Advanced", "Fluent", "Native"];

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
  { key: "extra", label: "أقسام إضافية", icon: Layers },
  { key: "certs", label: "الشهادات", icon: Award },
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
  const [blockedField, setBlockedField] = useState(null);
  // Export confirmation flow: the access code is single-use, so exporting
  // must be an explicit, confirmed action. `exportCompleted` only flips to
  // true after a PDF has actually finished downloading successfully — a
  // failed attempt (network/server error) must leave it false so the user
  // can retry without losing their code.
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportCompleted, setExportCompleted] = useState(false);
  const [exportError, setExportError] = useState("");
  const cvDir = cvLang === "ar" ? "rtl" : "ltr";
  const t = CV_LABELS[cvLang];

  function confirmLanguage(lang) {
    setCvLang(lang);
    setLangConfirmed(true);
  }

  // Strips Arabic characters out of a keystroke when the CV output language
  // is English, and flashes an inline warning near the offending field —
  // this is what keeps English-output CVs from ending up with Arabic
  // content mixed into the PDF.
  function guardLangInput(id, value) {
    if (cvLang !== "en" || !ARABIC_RE.test(value)) return value;
    setBlockedField(id);
    window.clearTimeout(guardLangInput._t);
    guardLangInput._t = window.setTimeout(() => setBlockedField((cur) => (cur === id ? null : cur)), 2000);
    return value.replace(ARABIC_RE, "");
  }

  function field(id, label, val, onChange, opts = {}) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <input
          value={val}
          onChange={(e) => {
            const raw = opts.numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value;
            onChange({ target: { value: guardLangInput(id, raw) } });
          }}
          placeholder={opts.ph}
          style={inputStyle}
          inputMode={opts.numeric ? "numeric" : undefined}
        />
        {blockedField === id && <div style={warnStyle}>الرجاء الإدخال بالإنجليزية للسيرة الإنجليزية</div>}
        {opts.error && <div style={warnStyle}>{opts.error}</div>}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  function fieldArea(id, label, val, onChange, opts = {}) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#1a3a5c" }}>*</span>}</label>
        <textarea value={val} onChange={(e) => onChange({ target: { value: guardLangInput(id, e.target.value) } })} placeholder={opts.ph} rows={opts.rows || 4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.8 }} />
        {blockedField === id && <div style={warnStyle}>الرجاء الإدخال بالإنجليزية للسيرة الإنجليزية</div>}
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
  // free-text field bound to a separate `custom` value.
  function selectWithOther(id, label, choice, custom, onChoiceChange, onCustomChange, options, opts = {}) {
    const isOther = choice === OTHER;
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
        {isOther && blockedField === id && <div style={warnStyle}>الرجاء الإدخال بالإنجليزية للسيرة الإنجليزية</div>}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  // Chip/tag input: Enter or comma commits the draft as a new tag.
  function tagsInput(id, label, tags, setTags, opts = {}) {
    const draft = tagDrafts[id] || "";
    const setDraft = (v) => setTagDrafts((d) => ({ ...d, [id]: v }));
    const commit = () => {
      const parts = guardLangInput(id, draft).split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) setTags((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
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
    return (
      <div style={{ marginBottom: 14 }}>
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
            onChange={(e) => setDraft(guardLangInput(id, e.target.value))}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            placeholder={tags.length ? "" : opts.ph}
            style={{ border: "none", outline: "none", flex: "1 1 120px", minWidth: 100, fontSize: 13.5, fontFamily: "inherit", background: "transparent", color: THEME.text }}
          />
        </div>
        {blockedField === id && <div style={warnStyle}>الرجاء الإدخال بالإنجليزية للسيرة الإنجليزية</div>}
        {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
      </div>
    );
  }

  const [form, setForm] = useState(saved?.form ?? {
    name: "",
    email: "",
    phone: "",
    cityChoice: "",
    cityCustom: "",
    targetRole: "",
    objective: "",
    yearsOfExperience: "",
    linkedin: "",
    displayPhone: "",
    summary: "",
    achievements: "",
    certs: "",
  });

  const [experiences, setExperiences] = useState(saved?.experiences ?? [
    { title: "", employer: "", fromMonth: "", fromYear: "", toMonth: "", toYear: "", current: false, bullets: "" },
  ]);
  const [education, setEducation] = useState(saved?.education ?? [
    { degreeChoice: "", degreeCustom: "", specialization: "", schoolChoice: "", schoolCustom: "", year: "", detail: "", gradProject: "" },
  ]);
  const [techSkillTags, setTechSkillTags] = useState(saved?.techSkillTags ?? []);
  const [softSkillTags, setSoftSkillTags] = useState(saved?.softSkillTags ?? []);
  const [languageEntries, setLanguageEntries] = useState(saved?.languageEntries ?? [{ name: "", level: "" }]);
  const [tagDrafts, setTagDrafts] = useState({});

  // ── Optional extra sections — each starts hidden ("not added") so the
  // form stays clean; the user explicitly opts in per section. ──
  const [projects, setProjects] = useState(saved?.projects ?? []);
  const [courses, setCourses] = useState(saved?.courses ?? []);
  const [showProjects, setShowProjects] = useState(saved?.showProjects ?? false);
  const [showAchievements, setShowAchievements] = useState(saved?.showAchievements ?? false);
  const [showCourses, setShowCourses] = useState(saved?.showCourses ?? false);

  // Persists the current step and all form data on every change, keyed to
  // this access code, so refreshing the page — on ANY step, including the
  // preview — restores exactly where the user left off instead of
  // bouncing them back to the language screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
        accessCode, step, preview, cvLang, langConfirmed,
        form, experiences, education, techSkillTags, softSkillTags, languageEntries,
        projects, courses, showProjects, showAchievements, showCourses,
      }));
    } catch {}
  }, [accessCode, step, preview, cvLang, langConfirmed, form, experiences, education, techSkillTags, softSkillTags, languageEntries, projects, courses, showProjects, showAchievements, showCourses]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // ── Experience helpers ──
  const addExp = () => setExperiences([...experiences, { title: "", employer: "", fromMonth: "", fromYear: "", toMonth: "", toYear: "", current: false, bullets: "" }]);
  const rmExp = (i) => setExperiences(experiences.filter((_, x) => x !== i));
  const setExp = (i, k) => (e) => {
    const copy = [...experiences];
    copy[i][k] = e.target.value;
    setExperiences(copy);
  };

  // ── Education helpers ──
  const addEdu = () => setEducation([...education, { degreeChoice: "", degreeCustom: "", specialization: "", schoolChoice: "", schoolCustom: "", year: "", detail: "", gradProject: "" }]);
  const rmEdu = (i) => setEducation(education.filter((_, x) => x !== i));
  const setEdu = (i, k) => (e) => {
    const copy = [...education];
    copy[i][k] = e.target.value;
    setEducation(copy);
  };

  // ── Projects helpers (optional section) ──
  const addProject = () => setProjects([...projects, { name: "", details: "" }]);
  const rmProject = (i) => setProjects(projects.filter((_, x) => x !== i));
  const setProject = (i, k) => (e) => {
    const copy = [...projects];
    copy[i][k] = e.target.value;
    setProjects(copy);
  };

  // ── Training courses helpers (optional section) ──
  const addCourse = () => setCourses([...courses, { name: "", hours: "", provider: "" }]);
  const rmCourse = (i) => setCourses(courses.filter((_, x) => x !== i));
  const setCourse = (i, k) => (e) => {
    const copy = [...courses];
    copy[i][k] = e.target.value;
    setCourses(copy);
  };

  // ── Language helpers ──
  const addLang = () => setLanguageEntries([...languageEntries, { name: "", level: "" }]);
  const rmLang = (i) => setLanguageEntries(languageEntries.filter((_, x) => x !== i));
  const setLang = (i, k) => (e) => {
    const copy = [...languageEntries];
    copy[i][k] = e.target.value;
    setLanguageEntries(copy);
  };

  const canProceed = () => {
    if (step === 0) return form.name && form.phone && form.targetRole;
    return true;
  };

  const splitLines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);

  // ── Bilingual option lists + labels for the new controls ──
  const sep = cvLang === "en" ? ", " : "، ";
  const cityOptions = cvLang === "en" ? EN_CITIES : AR_CITIES;
  const degreeOptions = cvLang === "en" ? EN_DEGREES : AR_DEGREES;
  const universityOptions = cvLang === "en" ? EN_UNIVERSITIES : AR_UNIVERSITIES;
  const levelOptions = cvLang === "en" ? EN_LEVELS : AR_LEVELS;
  const monthOptions = cvLang === "en" ? EN_MONTHS : AR_MONTHS;
  const gradYearOptions = yearRange(1970, CURRENT_YEAR + 6);
  const expYearOptions = yearRange(1970, CURRENT_YEAR);

  const L = cvLang === "en" ? {
    city: "City", experienceHeading: "Work Experience & Training", expCard: "Experience",
    jobTitle: "Job Title", employer: "Employer", from: "From", to: "To", month: "Month", year: "Year",
    currentJob: "I currently work here", bulletsLabel: "Responsibilities & Achievements",
    bulletsHint: "One line per point. Start with a strong verb and add numbers where possible.",
    bulletsPh: "One line = one point:\nPrepared journal entries and reviewed accounts\nFiled tax reports on time",
    addExp: "Add another experience",
    eduHeading: "Educational Qualification", eduCard: "Qualification", degree: "Degree",
    specialization: "Specialization", specializationPh: "Accounting", university: "University",
    gradYear: "Graduation Year", gpa: "GPA (optional)", addEdu: "Add another qualification",
    gradProject: "Graduation Project (optional)", gradProjectPh: "e.g. Inventory Management System",
    skillsHeading: "Skills & Languages", techSkillsLabel: "Technical Skills",
    techSkillsPh: "Type a skill and press Enter", techSkillsHint: "Press Enter or comma to add a skill.",
    softSkillsLabel: "Professional Skills", languagesLabel: "Languages", langCard: "Language",
    langName: "Language", langNamePh: "English", proficiency: "Proficiency", addLang: "Add language",
    extraHeading: "Additional Sections (Optional)",
    projectsTitle: "Projects", projectsHint: "Optional — showcase projects relevant to the target role.",
    addProjectSection: "Add Projects Section", projectCard: "Project", projectName: "Project Name",
    projectDetails: "Description", addProject: "Add another project",
    removeSection: "Remove Section",
    achievementsTitle: "Achievements", achievementsHint: "One line per achievement.",
    achievementsPh: "One line = one achievement:\nEmployee of the Year 2023\nCertificate of appreciation from the Finance Dept.",
    addAchievementsSection: "Add Achievements Section",
    coursesTitle: "Training Courses", addCourseSection: "Add Courses Section", courseCard: "Course",
    courseName: "Course Name", courseHours: "Hours", courseProvider: "Provider / Institution",
    addCourse: "Add another course",
  } : {
    city: "المدينة", experienceHeading: "الخبرات العملية والتدريب", expCard: "خبرة",
    jobTitle: "المسمى الوظيفي", employer: "جهة العمل", from: "من", to: "إلى", month: "الشهر", year: "السنة",
    currentJob: "لا زلت أعمل هنا", bulletsLabel: "المهام والإنجازات",
    bulletsHint: "اكتب كل مهمة في سطر. ابدأ بفعل قوي وأضف رقماً كلما أمكن.",
    bulletsPh: "كل سطر = نقطة مستقلة:\nإعداد القيود اليومية ومراجعة الحسابات\nإعداد التقارير الضريبية وتقديمها في مواعيدها",
    addExp: "إضافة خبرة أخرى",
    eduHeading: "المؤهل العلمي", eduCard: "مؤهل", degree: "الدرجة",
    specialization: "التخصص", specializationPh: "المحاسبة", university: "الجامعة",
    gradYear: "سنة التخرج", gpa: "المعدل (اختياري)", addEdu: "إضافة مؤهل آخر",
    gradProject: "مشروع التخرج (اختياري)", gradProjectPh: "مثال: نظام إدارة المخزون",
    skillsHeading: "المهارات واللغات", techSkillsLabel: "المهارات التقنية",
    techSkillsPh: "اكتب مهارة واضغط Enter", techSkillsHint: "اضغط Enter أو الفاصلة لإضافة المهارة.",
    softSkillsLabel: "المهارات المهنية", languagesLabel: "اللغات", langCard: "لغة",
    langName: "اسم اللغة", langNamePh: "الإنجليزية", proficiency: "المستوى", addLang: "إضافة لغة",
    extraHeading: "أقسام إضافية (اختياري)",
    projectsTitle: "المشاريع", projectsHint: "اختياري — أضف مشاريع ذات صلة بالوظيفة المستهدفة.",
    addProjectSection: "إضافة قسم المشاريع", projectCard: "مشروع", projectName: "اسم المشروع",
    projectDetails: "الوصف", addProject: "إضافة مشروع آخر",
    removeSection: "إزالة القسم",
    achievementsTitle: "الإنجازات", achievementsHint: "اكتب كل إنجاز في سطر.",
    achievementsPh: "كل سطر = إنجاز مستقل:\nموظف العام 2023\nشهادة تقدير من الإدارة المالية",
    addAchievementsSection: "إضافة قسم الإنجازات",
    coursesTitle: "الدورات التدريبية", addCourseSection: "إضافة قسم الدورات", courseCard: "دورة",
    courseName: "اسم الدورة", courseHours: "عدد الساعات", courseProvider: "الجهة المانحة",
    addCourse: "إضافة دورة أخرى",
  };

  // ── Validation (gentle, non-blocking) ──
  const phoneValid = !form.phone || PHONE_RE.test(form.phone.replace(/[\s-]/g, ""));
  const emailValid = !form.email || EMAIL_RE.test(form.email.trim());
  const phoneError = !phoneValid && (cvLang === "en" ? "Enter a valid Saudi number (+9665XXXXXXXX or 05XXXXXXXX)." : "أدخل رقماً سعودياً صحيحاً (+9665XXXXXXXX أو 05XXXXXXXX).");
  const emailError = !emailValid && (cvLang === "en" ? "Enter a valid email address." : "الرجاء إدخال بريد إلكتروني صحيح.");

  // ── Derived plain values fed to the (untouched) preview + PDF generator ──
  const cityValue = form.cityChoice === OTHER ? form.cityCustom : form.cityChoice;
  // The number shown ON the CV falls back to the contact number when no
  // separate display number was given.
  const cvPhoneValue = form.displayPhone || form.phone;

  const displayExperiences = experiences.map((x) => ({
    title: x.title,
    employer: x.employer,
    period: formatPeriod(x, cvLang),
    bullets: x.bullets,
  }));

  const displayEducation = education.map((x) => {
    const degreeLabel = x.degreeChoice === OTHER ? x.degreeCustom : x.degreeChoice;
    const school = x.schoolChoice === OTHER ? x.schoolCustom : x.schoolChoice;
    return {
      degree: [degreeLabel, x.specialization].filter(Boolean).join(" "),
      school,
      year: x.year,
      detail: x.detail,
      gradProject: x.gradProject,
    };
  });

  const displayProjects = projects.filter((p) => p.name || p.details);
  const displayCourses = courses.filter((c) => c.name || c.hours || c.provider);

  const techSkillsStr = techSkillTags.join(sep);
  const softSkillsStr = softSkillTags.join(sep);
  const languagesStr = languageEntries
    .filter((l) => l.name.trim())
    .map((l) => `${l.name}${l.level ? ` — ${l.level}` : ""}`)
    .join(sep);

  async function downloadPDF() {
    setDownloading(true);
    setExportError("");
    // iOS Safari doesn't support forced downloads (the `download` attribute
    // is ignored) and revoking a blob: URL right after triggering it — as a
    // desktop-style anchor click normally does — races Safari's own async
    // handling of that URL and surfaces as "WebKitBlobResource error 1".
    // The reliable path on iOS is to hand the PDF to Safari's built-in
    // viewer (the user saves it from there via the Share sheet) in a tab
    // opened synchronously *before* the network request, so it isn't
    // blocked as a popup once we're past the awaited fetch below.
    const isIOS = typeof navigator !== "undefined" && (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const iosTab = isIOS ? window.open("", "_blank") : null;
    try {
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: {
            name: form.name,
            email: form.email,
            phone: cvPhoneValue,
            city: cityValue,
            targetRole: form.targetRole,
            objective: form.objective,
            yearsOfExperience: form.yearsOfExperience,
            linkedin: form.linkedin,
            summary: form.summary,
            achievements: form.achievements,
            certs: form.certs,
            languages: languagesStr,
          },
          experiences: displayExperiences,
          education: displayEducation,
          projects: displayProjects,
          courses: displayCourses,
          techSkills: techSkillsStr,
          softSkills: softSkillsStr,
          lang: cvLang,
          accessCode,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PDF generation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (isIOS && iosTab) {
        iosTab.location.href = url;
      } else {
        const safeName = (form.name || "CV").replace(/\s+/g, "_");
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

      // Only reached on a successful download — this is the single place
      // the session gets marked complete, per the single-use access code.
      setShowExportModal(false);
      setExportCompleted(true);
      clearProgress();
    } catch (e) {
      if (iosTab) iosTab.close();
      setExportError(e.message && e.message !== "PDF generation failed" ? e.message : "تعذّر إنشاء الملف. تحقّق من اتصالك وحاول مرة أخرى.");
    } finally {
      setDownloading(false);
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

  // ───────────────────────── PREVIEW ─────────────────────────
  if (preview) {
    return (
      <div dir={cvDir} style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Segoe UI', Tahoma, sans-serif" }}>
        {/* toolbar - hidden on print */}
        <div dir="rtl" className="no-print" style={{ background: C.ink, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
          <button onClick={() => setPreview(false)} style={btnGhostLight}>
            <ChevronRight size={16} /> رجوع للتعديل
          </button>
          {exportCompleted ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#ffffff", fontSize: 13, fontWeight: 700 }}>
              <CheckCircle2 size={16} /> تم التصدير
            </div>
          ) : (
            <button
              onClick={() => { setExportError(""); setShowExportModal(true); }}
              disabled={downloading}
              style={{ ...btnBrass, opacity: downloading ? 0.7 : 1 }}
            >
              {downloading ? <><Loader2 size={16} className="spin" /> جارٍ التحميل...</> : <><Download size={16} /> تحميل PDF</>}
            </button>
          )}
        </div>

        {exportCompleted && (
          <div dir="rtl" className="no-print" style={{ background: THEME.soft, borderBottom: `1px solid ${THEME.border}`, padding: "14px 20px", textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: THEME.primary, fontSize: 13.5, fontWeight: 700, lineHeight: 1.7 }}>
              <CheckCircle2 size={18} />
              تم تصدير سيرتك الذاتية بنجاح. لإنشاء سيرة جديدة، يرجى تقديم طلب جديد.
            </div>
          </div>
        )}

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
                بمجرد تصدير سيرتك الذاتية، سيُعتبر طلبك مكتملاً. لإنشاء سيرة جديدة أو إجراء تعديلات لاحقاً، ستحتاج إلى تقديم طلب جديد والحصول على رمز جديد. هل أنت متأكد من رغبتك في التصدير الآن؟
              </div>
              {exportError && (
                <div style={{ ...warnStyle, background: "#fbeaea", borderRadius: 8, padding: "10px 12px", marginBottom: 22 }}>{exportError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={downloadPDF} disabled={downloading} style={{ ...btnPrimary, width: "100%", opacity: downloading ? 0.7 : 1, cursor: downloading ? "wait" : "pointer" }}>
                  {downloading ? <><Loader2 size={16} className="spin" /> جارٍ التصدير...</> : "نعم، تصدير السيرة"}
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

        <div style={{ display: "flex", justifyContent: "center", padding: "24px 12px 60px" }}>
          <div className="cv-page" style={cvPage}>
            {/* Header */}
            <div style={{ borderBottom: `2.5px solid ${C.ink}`, paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: 0.3 }}>{form.name || t.fallbackName}</div>
              {form.targetRole && <div style={{ fontSize: 14.5, color: C.brass, fontWeight: 700, marginTop: 3 }}>{form.targetRole}</div>}
              {form.objective && <div style={{ fontSize: 12, color: C.slate, fontStyle: "italic", marginTop: 3 }}>{t.objective}: {form.objective}</div>}
              <div style={{ fontSize: 12, color: C.slate, marginTop: 9, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                {form.email && <span>✉ {form.email}</span>}
                {cvPhoneValue && <span>☎ {cvPhoneValue}</span>}
                {cityValue && <span>📍 {cityValue}</span>}
                {form.linkedin && <span>🔗 {form.linkedin}</span>}
                {form.yearsOfExperience && <span>🕘 {form.yearsOfExperience} {t.yearsOfExperience}</span>}
              </div>
            </div>

            {form.summary && (
              <Section title={t.summary}>
                <p style={pBody}>{form.summary}</p>
              </Section>
            )}

            {displayExperiences.some((x) => x.title || x.employer) && (
              <Section title={t.experience}>
                {displayExperiences.filter((x) => x.title || x.employer).map((x, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: C.ink, fontSize: 13.5 }}>
                        {x.title}{x.employer && <span style={{ color: C.slate, fontWeight: 500 }}> — {x.employer}</span>}
                      </span>
                      {x.period && <span style={{ fontSize: 11.5, color: C.slate, fontStyle: "italic", whiteSpace: "nowrap" }}>{x.period}</span>}
                    </div>
                    {x.bullets && (
                      <ul style={ulBody(cvDir)}>
                        {splitLines(x.bullets).map((b, j) => <li key={j} style={liBody(cvDir)}>{b}</li>)}
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                        {x.degree}{x.school && <span style={{ color: C.slate, fontWeight: 500 }}> — {x.school}</span>}
                      </span>
                      {x.year && <span style={{ fontSize: 11.5, color: C.slate, fontStyle: "italic" }}>{x.year}</span>}
                    </div>
                    {x.detail && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{x.detail}</div>}
                    {x.gradProject && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}><strong style={{ color: C.ink }}>{t.gradProject}:</strong> {x.gradProject}</div>}
                  </div>
                ))}
              </Section>
            )}

            {displayProjects.length > 0 && (
              <Section title={t.projects}>
                {displayProjects.map((x, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>{x.name}</div>
                    {x.details && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{x.details}</div>}
                  </div>
                ))}
              </Section>
            )}

            {form.achievements && (
              <Section title={t.achievements}>
                <ul style={ulBody(cvDir)}>
                  {splitLines(form.achievements).map((a, i) => <li key={i} style={liBody(cvDir)}>{a}</li>)}
                </ul>
              </Section>
            )}

            {(techSkillTags.length > 0 || softSkillTags.length > 0) && (
              <Section title={t.skills}>
                {techSkillTags.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <span style={skillCat}>{t.techSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{techSkillTags.join(" · ")}</span>
                  </div>
                )}
                {softSkillTags.length > 0 && (
                  <div>
                    <span style={skillCat}>{t.softSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{softSkillTags.join(" · ")}</span>
                  </div>
                )}
              </Section>
            )}

            {displayCourses.length > 0 && (
              <Section title={t.courses}>
                {displayCourses.map((x, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                        {x.name}{x.provider && <span style={{ color: C.slate, fontWeight: 500 }}> — {x.provider}</span>}
                      </span>
                      {x.hours && <span style={{ fontSize: 11.5, color: C.slate, fontStyle: "italic" }}>{x.hours} {t.hoursUnit}</span>}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {form.certs && (
              <Section title={t.certs}>
                <ul style={ulBody(cvDir)}>
                  {splitLines(form.certs).map((c, i) => <li key={i} style={liBody(cvDir)}>{c}</li>)}
                </ul>
              </Section>
            )}

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
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 20px 60px" }}>
        <div style={{ textAlign: "center", marginBottom: 18, fontSize: 12.5, color: THEME.text }}>
          لغة السيرة الذاتية الناتجة: <strong style={{ color: THEME.primary }}>{cvLang === "en" ? "English" : "العربية"}</strong>
        </div>

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
                {field("name", "الاسم الكامل", form.name, set("name"), { req: true, ph: "عادل علي الأجاجي" })}
                {field("email", "البريد الإلكتروني", form.email, set("email"), { ph: "name@email.com", error: emailError })}
                {field("phone", "رقم الجوال", form.phone, set("phone"), { req: true, ph: "+9665xxxxxxxx", error: phoneError })}
                {selectWithOther(
                  "city", L.city, form.cityChoice, form.cityCustom,
                  (v) => setForm({ ...form, cityChoice: v }),
                  (v) => setForm({ ...form, cityCustom: v }),
                  cityOptions
                )}
                {field("displayPhone", "رقم جوال آخر يظهر في السيرة (اختياري)", form.displayPhone, set("displayPhone"), { ph: "+9665xxxxxxxx", hint: "اتركه فارغاً لعرض رقم الجوال أعلاه في السيرة." })}
                {field("linkedin", "رابط LinkedIn (اختياري)", form.linkedin, set("linkedin"), { ph: "https://linkedin.com/in/name" })}
                {field("yearsOfExperience", "عدد سنوات الخبرة (اختياري)", form.yearsOfExperience, set("yearsOfExperience"), { ph: "5", numeric: true })}
              </div>
              {field("targetRole", "الوظيفة المستهدفة", form.targetRole, set("targetRole"), { req: true, ph: "محاسب / محلل مالي" })}
              {field("objective", "الوظائف المستهدفة (اختياري)", form.objective, set("objective"), { ph: "محاسب أول، محلل مالي، مراقب مالي", hint: "إن كان لديك أكثر من مسار وظيفي مستهدف." })}
              {fieldArea("summary", "الملخص المهني", form.summary, set("summary"), { rows: 4, ph: "اكتب 2-3 أسطر عن خبرتك ونقاط قوتك موجّهة للوظيفة المستهدفة.", hint: "اختياري — لكنه أول ما يقرأه صاحب العمل." })}
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
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                        <select value={x.toMonth} onChange={setExp(i, "toMonth")} style={inputStyle}>
                          <option value="">{L.month}</option>
                          {monthOptions.map((m, idx) => <option key={idx + 1} value={idx + 1}>{m}</option>)}
                        </select>
                        <select value={x.toYear} onChange={setExp(i, "toYear")} style={inputStyle}>
                          <option value="">{L.year}</option>
                          {expYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                      </div>
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

                  {fieldArea(`exp-${i}-bullets`, L.bulletsLabel, x.bullets, setExp(i, "bullets"), { rows: 4, ph: L.bulletsPh, hint: L.bulletsHint })}
                </div>
              ))}
              <button onClick={addExp} style={btnAdd}><Plus size={16} /> {L.addExp}</button>
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
                    {field(`edu-${i}-specialization`, L.specialization, x.specialization, setEdu(i, "specialization"), { ph: L.specializationPh })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {selectWithOther(
                      `edu-${i}-school`, L.university, x.schoolChoice, x.schoolCustom,
                      (v) => setEdu(i, "schoolChoice")({ target: { value: v } }),
                      (v) => setEdu(i, "schoolCustom")({ target: { value: v } }),
                      universityOptions
                    )}
                    {selectField(`edu-${i}-year`, L.gradYear, x.year, setEdu(i, "year"), gradYearOptions)}
                  </div>
                  {field(`edu-${i}-detail`, L.gpa, x.detail, setEdu(i, "detail"), { ph: "4.5 / 5" })}
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
              {tagsInput("techSkills", L.techSkillsLabel, techSkillTags, setTechSkillTags, { ph: L.techSkillsPh, hint: L.techSkillsHint })}
              {tagsInput("softSkills", L.softSkillsLabel, softSkillTags, setSoftSkillTags, { ph: L.techSkillsPh })}

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
                    {field(`lang-${i}-name`, L.langName, l.name, setLang(i, "name"), { ph: L.langNamePh })}
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

              {/* Projects */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: showProjects ? 12 : 0 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary }}>{L.projectsTitle}</div>
                    {!showProjects && <div style={hintStyle}>{L.projectsHint}</div>}
                  </div>
                  {!showProjects ? (
                    <button onClick={() => { setShowProjects(true); if (!projects.length) addProject(); }} style={btnAddSection}>
                      <Plus size={15} /> {L.addProjectSection}
                    </button>
                  ) : (
                    <button onClick={() => { setProjects([]); setShowProjects(false); }} style={btnRemoveSection}>
                      <Trash2 size={14} /> {L.removeSection}
                    </button>
                  )}
                </div>
                {showProjects && (
                  <>
                    {projects.map((x, i) => (
                      <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.projectCard} #{i + 1}</span>
                          {projects.length > 1 && (
                            <button onClick={() => rmProject(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                          )}
                        </div>
                        {field(`proj-${i}-name`, L.projectName, x.name, setProject(i, "name"), { ph: cvLang === "en" ? "Inventory Management System" : "نظام إدارة المخزون" })}
                        {fieldArea(`proj-${i}-details`, L.projectDetails, x.details, setProject(i, "details"), { rows: 3 })}
                      </div>
                    ))}
                    <button onClick={addProject} style={btnAdd}><Plus size={16} /> {L.addProject}</button>
                  </>
                )}
              </div>

              {/* Achievements */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: showAchievements ? 12 : 0 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary }}>{L.achievementsTitle}</div>
                    {!showAchievements && <div style={hintStyle}>{L.achievementsHint}</div>}
                  </div>
                  {!showAchievements ? (
                    <button onClick={() => setShowAchievements(true)} style={btnAddSection}>
                      <Plus size={15} /> {L.addAchievementsSection}
                    </button>
                  ) : (
                    <button onClick={() => { setForm((f) => ({ ...f, achievements: "" })); setShowAchievements(false); }} style={btnRemoveSection}>
                      <Trash2 size={14} /> {L.removeSection}
                    </button>
                  )}
                </div>
                {showAchievements && fieldArea("achievements", "", form.achievements, set("achievements"), { rows: 4, ph: L.achievementsPh, hint: L.achievementsHint })}
              </div>

              {/* Training Courses */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: showCourses ? 12 : 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: THEME.primary }}>{L.coursesTitle}</div>
                  {!showCourses ? (
                    <button onClick={() => { setShowCourses(true); if (!courses.length) addCourse(); }} style={btnAddSection}>
                      <Plus size={15} /> {L.addCourseSection}
                    </button>
                  ) : (
                    <button onClick={() => { setCourses([]); setShowCourses(false); }} style={btnRemoveSection}>
                      <Trash2 size={14} /> {L.removeSection}
                    </button>
                  )}
                </div>
                {showCourses && (
                  <>
                    {courses.map((x, i) => (
                      <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginTop: 12, marginBottom: 14, background: THEME.card }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>{L.courseCard} #{i + 1}</span>
                          {courses.length > 1 && (
                            <button onClick={() => rmCourse(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          {field(`course-${i}-name`, L.courseName, x.name, setCourse(i, "name"), {})}
                          {field(`course-${i}-hours`, L.courseHours, x.hours, setCourse(i, "hours"), { numeric: true })}
                        </div>
                        {field(`course-${i}-provider`, L.courseProvider, x.provider, setCourse(i, "provider"), {})}
                      </div>
                    ))}
                    <button onClick={addCourse} style={btnAdd}><Plus size={16} /> {L.addCourse}</button>
                  </>
                )}
              </div>
            </>
          )}

          {/* STEP 5 - Certs */}
          {step === 5 && (
            <>
              <SectionTitle>الشهادات المهنية والدورات</SectionTitle>
              {fieldArea("certs", "الشهادات والدورات", form.certs, set("certs"), { rows: 5, ph: "كل شهادة في سطر:\nشهادة SOCPA\nدورة معايير IFRS\nشهادة CMA (قيد الدراسة)", hint: "اختياري — لكنه يقوّي السيرة كثيراً في مجال المحاسبة. اكتب كل شهادة في سطر." })}
            </>
          )}

          {/* Nav */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 20, borderTop: `1px solid ${THEME.border}` }}>
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} style={{ ...btnGhost, opacity: step === 0 ? 0.4 : 1, cursor: step === 0 ? "not-allowed" : "pointer" }}>
              <ChevronRight size={17} /> السابق
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => canProceed() && setStep(step + 1)} disabled={!canProceed()} style={{ ...btnPrimary, opacity: canProceed() ? 1 : 0.5, cursor: canProceed() ? "pointer" : "not-allowed" }}>
                التالي <ChevronLeft size={17} />
              </button>
            ) : (
              <button onClick={() => setPreview(true)} style={{ ...btnPrimary, minWidth: 200 }}>
                <FileText size={17} /> معاينة السيرة الذاتية
              </button>
            )}
          </div>
          {step === 0 && !canProceed() && (
            <div style={{ marginTop: 12, fontSize: 12, color: THEME.text, textAlign: "center" }}>* الاسم والجوال والوظيفة المستهدفة مطلوبة للمتابعة</div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11.5, color: THEME.text }}>
          بياناتك تُستخدَم فقط لتوليد ملف PDF عند الضغط على "تحميل PDF"، ولا تُحفظ على أي خادم.
        </div>
      </div>
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

// ── Styles (form-only — the CV preview/PDF below keeps its own black/white styling) ──
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#3a4a5a", marginBottom: 6 };
const hintStyle = { fontSize: 11.5, color: "#3a4a5a", marginTop: 5, lineHeight: 1.5 };
const warnStyle = { fontSize: 11.5, color: "#b3261e", marginTop: 5, lineHeight: 1.5, fontWeight: 600 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const chipStyle = { display: "inline-flex", alignItems: "center", gap: 6, background: "#e8eef4", color: "#1a3a5c", borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 600 };
const chipRemoveStyle = { background: "transparent", border: "none", cursor: "pointer", color: "#1a3a5c", fontSize: 14, lineHeight: 1, padding: 0, fontWeight: 700 };

const cvPage = { width: "210mm", minHeight: "297mm", background: "#ffffff", padding: "18mm 16mm", boxShadow: "0 2px 16px rgba(20,40,60,.12)", boxSizing: "border-box" };
const pBody = { margin: 0, fontSize: 13, lineHeight: 1.85, color: "#333333", textAlign: "justify" };
const ulBody = (dir) => ({ margin: "5px 0 0", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 18, listStyle: "none" });
const liBody = (dir) => ({ fontSize: 12.5, lineHeight: 1.7, color: "#333333", position: "relative", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 12, marginBottom: 3 });
const skillCat = { fontWeight: 700, color: "#000000", fontSize: 12.5 };

const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#1a3a5c", border: "1px solid #dde4ec", borderRadius: 8, padding: "11px 18px", fontSize: 14, fontWeight: 600, fontFamily: "inherit" };
// btnGhostLight and btnBrass style the CV preview toolbar only — left as-is intentionally.
const btnGhostLight = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#ffffff", border: "1px solid #555555", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnBrass = { display: "inline-flex", alignItems: "center", gap: 7, background: "#000000", color: "#ffffff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnAdd = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#1a3a5c", border: "1.5px dashed #2d5578", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: "100%", justifyContent: "center" };
const btnIcon = { background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex" };
// Toggles an optional CV section (Projects / Achievements / Training Courses) on or off.
const btnAddSection = { display: "inline-flex", alignItems: "center", gap: 5, background: "#e8eef4", color: "#1a3a5c", border: "1px solid #dde4ec", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const btnRemoveSection = { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", color: "#b3261e", border: "1px solid #f0d0d0", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

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
