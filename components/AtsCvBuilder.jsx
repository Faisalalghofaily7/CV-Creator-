"use client";

import React, { useState } from "react";
import { FileText, Download, ChevronLeft, ChevronRight, Plus, Trash2, User, Briefcase, GraduationCap, Award, Wrench, CheckCircle2, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import { embedArabicFonts } from "../lib/pdfText";
import { buildCvPdf } from "../lib/cvPdfLayout";
import { CV_LABELS } from "../lib/cvLabels";

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
  const cvDir = cvLang === "ar" ? "rtl" : "ltr";
  const t = CV_LABELS[cvLang];

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    targetRole: "",
    summary: "",
    languages: "العربية (لغة أم)، الإنجليزية",
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
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      await embedArabicFonts(pdf);
      pdf.setFont("Amiri", "normal");
      buildCvPdf(pdf, { form, experiences, education, techSkills, softSkills, splitLines, splitList, lang: cvLang });

      const safeName = (form.name || "CV").replace(/\s+/g, "_");
      pdf.save(`${safeName}_CV.pdf`);
    } catch (e) {
      alert("تعذّر إنشاء الملف. حاول مرة أخرى.");
    } finally {
      setDownloading(false);
    }
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
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", color: C.ink }}>
      <div style={{ background: C.ink, padding: "22px 24px", borderBottom: `3px solid ${C.brass}` }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: C.brass, width: 42, height: 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileText size={22} color={C.ink} />
          </div>
          <div>
            <div style={{ color: C.paperCard, fontSize: 19, fontWeight: 700 }}>منشئ السيرة الذاتية — ATS</div>
            <div style={{ color: C.brassSoft, fontSize: 12.5 }}>عبّئ بياناتك واحصل على سيرة بصيغة PDF متوافقة مع أنظمة التوظيف</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 20px 60px" }}>
        {/* Language of the CV output (form UI itself stays Arabic) */}
        <div style={{ background: C.paperCard, borderRadius: 10, border: `1px solid ${C.line}`, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>لغة السيرة الذاتية الناتجة</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ code: "ar", label: "العربية" }, { code: "en", label: "English" }].map((opt) => (
              <button
                key={opt.code}
                onClick={() => setCvLang(opt.code)}
                style={{
                  padding: "7px 18px",
                  borderRadius: 7,
                  border: `1px solid ${cvLang === opt.code ? C.ink : C.line}`,
                  background: cvLang === opt.code ? C.ink : "transparent",
                  color: cvLang === opt.code ? C.paperCard : C.slate,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stepper */}
        <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <button key={s.key} onClick={() => setStep(i)} style={{ flex: "1 1 130px", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, background: active ? C.ink : done ? "#eae3d3" : C.paperCard, border: `1px solid ${active ? C.ink : C.line}`, cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: active ? C.brass : done ? C.ok : C.line, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {done ? <CheckCircle2 size={15} color="#fff" /> : <Icon size={15} color={active ? C.ink : C.slate} />}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? C.paperCard : C.slate }}>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ background: C.paperCard, borderRadius: 12, border: `1px solid ${C.line}`, padding: 26, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
          {/* STEP 0 - Personal */}
          {step === 0 && (
            <>
              <SectionTitle>البيانات الشخصية والهدف الوظيفي</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {field("الاسم الكامل", form.name, set("name"), { req: true, ph: "عادل علي الأجاجي" })}
                {field("البريد الإلكتروني", form.email, set("email"), { ph: "name@email.com" })}
                {field("رقم الجوال", form.phone, set("phone"), { req: true, ph: "+9665xxxxxxxx" })}
                {field("المدينة", form.city, set("city"), { ph: "القصيم" })}
              </div>
              {field("الوظيفة المستهدفة", form.targetRole, set("targetRole"), { req: true, ph: "محاسب / محلل مالي" })}
              {fieldArea("الملخص المهني", form.summary, set("summary"), { rows: 4, ph: "اكتب 2-3 أسطر عن خبرتك ونقاط قوتك موجّهة للوظيفة المستهدفة.", hint: "اختياري — لكنه أول ما يقرأه صاحب العمل." })}
            </>
          )}

          {/* STEP 1 - Experience */}
          {step === 1 && (
            <>
              <SectionTitle>الخبرات العملية والتدريب</SectionTitle>
              {experiences.map((x, i) => (
                <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, marginBottom: 14, background: C.paper }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.brass }}>خبرة #{i + 1}</span>
                    {experiences.length > 1 && (
                      <button onClick={() => rmExp(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field("المسمى الوظيفي", x.title, setExp(i, "title"), { ph: "محاسب" })}
                    {field("جهة العمل", x.employer, setExp(i, "employer"), { ph: "شركة ..." })}
                  </div>
                  {field("الفترة", x.period, setExp(i, "period"), { ph: "2022 - 2024" })}
                  {fieldArea("المهام والإنجازات", x.bullets, setExp(i, "bullets"), { rows: 4, ph: "كل سطر = نقطة مستقلة:\nإعداد القيود اليومية ومراجعة الحسابات\nإعداد التقارير الضريبية وتقديمها في مواعيدها", hint: "اكتب كل مهمة في سطر. ابدأ بفعل قوي وأضف رقماً كلما أمكن." })}
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
                <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, marginBottom: 14, background: C.paper }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.brass }}>مؤهل #{i + 1}</span>
                    {education.length > 1 && (
                      <button onClick={() => rmEdu(i)} style={btnIcon}><Trash2 size={15} color="#b3261e" /></button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field("الدرجة والتخصص", x.degree, setEdu(i, "degree"), { ph: "بكالوريوس المحاسبة" })}
                    {field("الجامعة", x.school, setEdu(i, "school"), { ph: "جامعة القصيم" })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {field("سنة التخرج", x.year, setEdu(i, "year"), { ph: "2023" })}
                    {field("المعدل (اختياري)", x.detail, setEdu(i, "detail"), { ph: "4.5 / 5 — مرتبة الشرف" })}
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
              {fieldArea("المهارات التقنية", techSkills, (e) => setTechSkills(e.target.value), { rows: 3, ph: "التحليل المالي، إعداد القيود، Excel، برامج ERP (SAP/Oracle)، إعداد التقارير الضريبية", hint: "افصل بين المهارات بفاصلة أو سطر جديد." })}
              {fieldArea("المهارات المهنية", softSkills, (e) => setSoftSkills(e.target.value), { rows: 2, ph: "حل المشكلات، إدارة الوقت، التواصل، العمل ضمن فريق" })}
              {field("اللغات", form.languages, set("languages"), { ph: "العربية (لغة أم)، الإنجليزية (متقدم)" })}
            </>
          )}

          {/* STEP 4 - Certs */}
          {step === 4 && (
            <>
              <SectionTitle>الشهادات المهنية والدورات</SectionTitle>
              {fieldArea("الشهادات والدورات", form.certs, set("certs"), { rows: 5, ph: "كل شهادة في سطر:\nشهادة SOCPA\nدورة معايير IFRS\nشهادة CMA (قيد الدراسة)", hint: "اختياري — لكنه يقوّي السيرة كثيراً في مجال المحاسبة. اكتب كل شهادة في سطر." })}
            </>
          )}

          {/* Nav */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
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
            <div style={{ marginTop: 12, fontSize: 12, color: C.slate, textAlign: "center" }}>* الاسم والجوال والوظيفة المستهدفة مطلوبة للمتابعة</div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11.5, color: C.slate }}>
          كل البيانات تُعالَج داخل متصفحك فقط — لا يتم إرسالها أو حفظها في أي مكان.
        </div>
      </div>
    </div>
  );
}

// ── Reusable pieces ──
function SectionTitle({ children }) {
  return <div style={{ fontSize: 16, fontWeight: 700, color: "#000000", marginBottom: 18 }}>{children}</div>;
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#000000", letterSpacing: 0.5, marginBottom: 7, borderBottom: "1px solid #d0d0d0", paddingBottom: 3 }}>{title}</div>
      {children}
    </div>
  );
}

function field(label, val, onChange, opts = {}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#000000" }}>*</span>}</label>
      <input value={val} onChange={onChange} placeholder={opts.ph} style={inputStyle} />
      {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
    </div>
  );
}

function fieldArea(label, val, onChange, opts = {}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label} {opts.req && <span style={{ color: "#000000" }}>*</span>}</label>
      <textarea value={val} onChange={onChange} placeholder={opts.ph} rows={opts.rows || 4} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.8 }} />
      {opts.hint && <div style={hintStyle}>{opts.hint}</div>}
    </div>
  );
}

// ── Styles ──
const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#000000", marginBottom: 6 };
const hintStyle = { fontSize: 11.5, color: "#333333", marginTop: 5, lineHeight: 1.5 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #cccccc", background: "#ffffff", fontSize: 13.5, color: "#000000", fontFamily: "inherit", boxSizing: "border-box" };

const cvPage = { width: "210mm", minHeight: "297mm", background: "#ffffff", padding: "18mm 16mm", boxShadow: "0 2px 16px rgba(20,40,60,.12)", boxSizing: "border-box" };
const pBody = { margin: 0, fontSize: 13, lineHeight: 1.85, color: "#333333", textAlign: "justify" };
const ulBody = (dir) => ({ margin: "5px 0 0", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 18, listStyle: "none" });
const liBody = (dir) => ({ fontSize: 12.5, lineHeight: 1.7, color: "#333333", position: "relative", [dir === "ltr" ? "paddingLeft" : "paddingRight"]: 12, marginBottom: 3 });
const skillCat = { fontWeight: 700, color: "#000000", fontSize: 12.5 };

const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#000000", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhost = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#000000", border: "1px solid #cccccc", borderRadius: 8, padding: "11px 18px", fontSize: 14, fontWeight: 600, fontFamily: "inherit" };
const btnGhostLight = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#ffffff", border: "1px solid #555555", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnBrass = { display: "inline-flex", alignItems: "center", gap: 7, background: "#000000", color: "#ffffff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnAdd = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#000000", border: "1.5px dashed #555555", borderRadius: 8, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: "100%", justifyContent: "center" };
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
