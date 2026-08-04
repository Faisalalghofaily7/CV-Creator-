"use client";

import React, { useState } from "react";
import { FileText, Download, ChevronLeft, ChevronRight, Plus, Trash2, User, Briefcase, GraduationCap, Award, Wrench, CheckCircle2, Loader2, Languages as LanguagesIcon } from "lucide-react";
import { CV_LABELS } from "../lib/cvLabels";

// Matches Arabic script (incl. supplement/extended blocks and presentation
// forms) — used to block Arabic keystrokes when the chosen CV output
// language is English, so the two languages' data never mix in the PDF.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

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
  { key: "certs", label: "الشهادات", icon: Award },
];

export default function AtsCvBuilder() {
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cvLang, setCvLang] = useState("ar");
  const [langConfirmed, setLangConfirmed] = useState(false);
  const [blockedField, setBlockedField] = useState(null);
  const cvDir = cvLang === "ar" ? "rtl" : "ltr";
  const t = CV_LABELS[cvLang];

  function confirmLanguage(lang) {
    setCvLang(lang);
    setForm((f) => ({
      ...f,
      // Seed a sensible example only if the user hasn't typed anything yet —
      // never overwrite real content, and never seed the wrong language.
      languages: f.languages || (lang === "en" ? "Arabic (Native), English (Fluent)" : "العربية (لغة أم)، الإنجليزية"),
    }));
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
        <input value={val} onChange={(e) => onChange({ target: { value: guardLangInput(id, e.target.value) } })} placeholder={opts.ph} style={inputStyle} />
        {blockedField === id && <div style={warnStyle}>الرجاء الإدخال بالإنجليزية للسيرة الإنجليزية</div>}
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

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    targetRole: "",
    summary: "",
    languages: "",
    certs: "",
  });

  const [experiences, setExperiences] = useState([
    { title: "", employer: "", period: "", bullets: "" },
  ]);
  const [education, setEducation] = useState([
    { degree: "", school: "", year: "", detail: "" },
  ]);
  const [techSkills, setTechSkills] = useState("");
  const [softSkills, setSoftSkills] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // ── Experience helpers ──
  const addExp = () => setExperiences([...experiences, { title: "", employer: "", period: "", bullets: "" }]);
  const rmExp = (i) => setExperiences(experiences.filter((_, x) => x !== i));
  const setExp = (i, k) => (e) => {
    const copy = [...experiences];
    copy[i][k] = e.target.value;
    setExperiences(copy);
  };

  // ── Education helpers ──
  const addEdu = () => setEducation([...education, { degree: "", school: "", year: "", detail: "" }]);
  const rmEdu = (i) => setEducation(education.filter((_, x) => x !== i));
  const setEdu = (i, k) => (e) => {
    const copy = [...education];
    copy[i][k] = e.target.value;
    setEducation(copy);
  };

  const canProceed = () => {
    if (step === 0) return form.name && form.phone && form.targetRole;
    return true;
  };

  const splitLines = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const splitList = (t) => t.split(/[،,\n]/).map((l) => l.trim()).filter(Boolean);

  async function downloadPDF() {
    setDownloading(true);
    try {
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form, experiences, education, techSkills, softSkills, lang: cvLang }),
      });
      if (!res.ok) throw new Error("PDF generation failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeName = (form.name || "CV").replace(/\s+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}_CV.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("تعذّر إنشاء الملف. حاول مرة أخرى.");
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
          <button onClick={downloadPDF} disabled={downloading} style={{ ...btnBrass, opacity: downloading ? 0.7 : 1 }}>
            {downloading ? <><Loader2 size={16} className="spin" /> جارٍ التحميل...</> : <><Download size={16} /> تحميل PDF</>}
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", padding: "24px 12px 60px" }}>
          <div className="cv-page" style={cvPage}>
            {/* Header */}
            <div style={{ borderBottom: `2.5px solid ${C.ink}`, paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: 0.3 }}>{form.name || t.fallbackName}</div>
              {form.targetRole && <div style={{ fontSize: 14.5, color: C.brass, fontWeight: 700, marginTop: 3 }}>{form.targetRole}</div>}
              <div style={{ fontSize: 12, color: C.slate, marginTop: 9, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                {form.email && <span>✉ {form.email}</span>}
                {form.phone && <span>☎ {form.phone}</span>}
                {form.city && <span>📍 {form.city}</span>}
              </div>
            </div>

            {form.summary && (
              <Section title={t.summary}>
                <p style={pBody}>{form.summary}</p>
              </Section>
            )}

            {experiences.some((x) => x.title || x.employer) && (
              <Section title={t.experience}>
                {experiences.filter((x) => x.title || x.employer).map((x, i) => (
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

            {education.some((x) => x.degree || x.school) && (
              <Section title={t.education}>
                {education.filter((x) => x.degree || x.school).map((x, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700, color: C.ink, fontSize: 13 }}>
                        {x.degree}{x.school && <span style={{ color: C.slate, fontWeight: 500 }}> — {x.school}</span>}
                      </span>
                      {x.year && <span style={{ fontSize: 11.5, color: C.slate, fontStyle: "italic" }}>{x.year}</span>}
                    </div>
                    {x.detail && <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{x.detail}</div>}
                  </div>
                ))}
              </Section>
            )}

            {(techSkills || softSkills) && (
              <Section title={t.skills}>
                {techSkills && (
                  <div style={{ marginBottom: 6 }}>
                    <span style={skillCat}>{t.techSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{splitList(techSkills).join(" · ")}</span>
                  </div>
                )}
                {softSkills && (
                  <div>
                    <span style={skillCat}>{t.softSkills} </span>
                    <span style={{ fontSize: 12.5, color: C.slate }}>{splitList(softSkills).join(" · ")}</span>
                  </div>
                )}
              </Section>
            )}

            {form.certs && (
              <Section title={t.certs}>
                <ul style={ulBody(cvDir)}>
                  {splitLines(form.certs).map((c, i) => <li key={i} style={liBody(cvDir)}>{c}</li>)}
                </ul>
              </Section>
            )}

            {form.languages && (
              <Section title={t.languages}>
                <p style={pBody}>{form.languages}</p>
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
                {field("email", "البريد الإلكتروني", form.email, set("email"), { ph: "name@email.com" })}
                {field("phone", "رقم الجوال", form.phone, set("phone"), { req: true, ph: "+9665xxxxxxxx" })}
                {field("city", "المدينة", form.city, set("city"), { ph: "القصيم" })}
              </div>
              {field("targetRole", "الوظيفة المستهدفة", form.targetRole, set("targetRole"), { req: true, ph: "محاسب / محلل مالي" })}
              {fieldArea("summary", "الملخص المهني", form.summary, set("summary"), { rows: 4, ph: "اكتب 2-3 أسطر عن خبرتك ونقاط قوتك موجّهة للوظيفة المستهدفة.", hint: "اختياري — لكنه أول ما يقرأه صاحب العمل." })}
            </>
          )}

          {/* STEP 1 - Experience */}
          {step === 1 && (
            <>
              <SectionTitle>الخبرات العملية والتدريب</SectionTitle>
              {experiences.map((x, i) => (
                <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>خبرة #{i + 1}</span>
                    {experiences.length > 1 && (
                      <button onClick={() => rmExp(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field(`exp-${i}-title`, "المسمى الوظيفي", x.title, setExp(i, "title"), { ph: "محاسب" })}
                    {field(`exp-${i}-employer`, "جهة العمل", x.employer, setExp(i, "employer"), { ph: "شركة ..." })}
                  </div>
                  {field(`exp-${i}-period`, "الفترة", x.period, setExp(i, "period"), { ph: "2022 - 2024" })}
                  {fieldArea(`exp-${i}-bullets`, "المهام والإنجازات", x.bullets, setExp(i, "bullets"), { rows: 4, ph: "كل سطر = نقطة مستقلة:\nإعداد القيود اليومية ومراجعة الحسابات\nإعداد التقارير الضريبية وتقديمها في مواعيدها", hint: "اكتب كل مهمة في سطر. ابدأ بفعل قوي وأضف رقماً كلما أمكن." })}
                </div>
              ))}
              <button onClick={addExp} style={btnAdd}><Plus size={16} /> إضافة خبرة أخرى</button>
            </>
          )}

          {/* STEP 2 - Education */}
          {step === 2 && (
            <>
              <SectionTitle>المؤهل العلمي</SectionTitle>
              {education.map((x, i) => (
                <div key={i} style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 16, marginBottom: 14, background: THEME.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: THEME.secondary }}>مؤهل #{i + 1}</span>
                    {education.length > 1 && (
                      <button onClick={() => rmEdu(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field(`edu-${i}-degree`, "الدرجة والتخصص", x.degree, setEdu(i, "degree"), { ph: "بكالوريوس المحاسبة" })}
                    {field(`edu-${i}-school`, "الجامعة", x.school, setEdu(i, "school"), { ph: "جامعة القصيم" })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field(`edu-${i}-year`, "سنة التخرج", x.year, setEdu(i, "year"), { ph: "2023" })}
                    {field(`edu-${i}-detail`, "المعدل (اختياري)", x.detail, setEdu(i, "detail"), { ph: "4.5 / 5 — مرتبة الشرف" })}
                  </div>
                </div>
              ))}
              <button onClick={addEdu} style={btnAdd}><Plus size={16} /> إضافة مؤهل آخر</button>
            </>
          )}

          {/* STEP 3 - Skills */}
          {step === 3 && (
            <>
              <SectionTitle>المهارات واللغات</SectionTitle>
              {fieldArea("techSkills", "المهارات التقنية", techSkills, (e) => setTechSkills(e.target.value), { rows: 3, ph: "التحليل المالي، إعداد القيود، Excel، برامج ERP (SAP/Oracle)، إعداد التقارير الضريبية", hint: "افصل بين المهارات بفاصلة أو سطر جديد." })}
              {fieldArea("softSkills", "المهارات المهنية", softSkills, (e) => setSoftSkills(e.target.value), { rows: 2, ph: "حل المشكلات، إدارة الوقت، التواصل، العمل ضمن فريق" })}
              {field("languages", "اللغات", form.languages, set("languages"), { ph: "العربية (لغة أم)، الإنجليزية (متقدم)" })}
            </>
          )}

          {/* STEP 4 - Certs */}
          {step === 4 && (
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

const printCSS = `
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  li:before { content: "▪"; position: absolute; right: 0; color: #000000; font-size: 8pt; top: 2px; }
  [dir="ltr"] li:before { right: auto; left: 0; }
  input::placeholder, textarea::placeholder { color: #a8a294; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid #000000; outline-offset: 1px; }
  @media print {
    .no-print { display: none !important; }
    body { background: #fff !important; }
    .cv-page { box-shadow: none !important; width: 100% !important; min-height: auto !important; padding: 0 !important; margin: 0 !important; }
    @page { size: A4; margin: 14mm 16mm; }
  }
`;
