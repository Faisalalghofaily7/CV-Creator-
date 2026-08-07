"use client";

import React, { useEffect, useState } from "react";
import { Copy, LogOut, Sparkles, Check, Loader2, FileText, Archive, RefreshCw, ChevronDown, ChevronUp, Mail, Phone, MapPin, Target, Hash, KeyRound, Languages, Clock } from "lucide-react";
import { SENDING_STATUSES, SENDING_STATUS_LABELS, SENDING_STATUS_COLORS } from "../lib/sendingStatus";

const C = { ink: "#1a3a5c", paper: "#f5f7fa", paperCard: "#ffffff", slate: "#3a4a5a", line: "#dde4ec", soft: "#e8eef4" };

// Real server-side session (httpOnly cookie, checked in app/admin/page.js
// before this component ever renders) — no credentials live here anymore.
function redirectToLogin() {
  window.location.assign("/admin/login");
}

export default function AdminCodes() {
  const [tab, setTab] = useState("codes"); // "codes" | "archive"
  const [loggingOut, setLoggingOut] = useState(false);

  const [codes, setCodes] = useState([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [lastGenerated, setLastGenerated] = useState(null);
  const [copiedCode, setCopiedCode] = useState("");

  const [cvs, setCvs] = useState([]);
  const [loadingCvs, setLoadingCvs] = useState(false);
  const [cvsError, setCvsError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [statusErrors, setStatusErrors] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [historyCache, setHistoryCache] = useState({});

  async function loadCodes() {
    setLoadingCodes(true);
    setLoadError("");
    try {
      const res = await fetch("/api/admin/codes");
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل الأكواد.");
      setCodes(data.codes || []);
    } catch (err) {
      setLoadError(err.message || "تعذّر تحميل الأكواد.");
    } finally {
      setLoadingCodes(false);
    }
  }

  async function loadCvs(filter) {
    setLoadingCvs(true);
    setCvsError("");
    try {
      const qs = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`/api/admin/cvs${qs}`);
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل الأرشيف.");
      setCvs(data.cvs || []);
    } catch (err) {
      setCvsError(err.message || "تعذّر تحميل الأرشيف.");
    } finally {
      setLoadingCvs(false);
    }
  }

  useEffect(() => {
    loadCodes();
  }, []);

  useEffect(() => {
    if (tab === "archive") loadCvs(statusFilter);
  }, [tab, statusFilter]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch (err) {
      // Ignore — redirecting to the login page either way is the correct
      // outcome, and the session row/cookie will simply expire on its own.
    } finally {
      redirectToLogin();
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError("");
    try {
      const res = await fetch("/api/admin/codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر إنشاء الكود.");
      setLastGenerated(data.code);
      setCodes((prev) => [data.code, ...prev]);
    } catch (err) {
      setGenerateError(err.message || "تعذّر إنشاء الكود.");
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy(code) {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 1500);
  }

  async function updateOrder(id, value) {
    // Optimistic update, reconciled with the server response.
    setCodes((prev) => prev.map((c) => (c.id === id ? { ...c, salla_order_number: value } : c)));
    try {
      const res = await fetch(`/api/admin/codes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sallaOrderNumber: value }),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر الحفظ.");
    } catch (err) {
      // Not critical enough to interrupt the admin — refresh from the
      // server so the field reflects what's actually persisted.
      loadCodes();
    }
  }

  async function updateSendingStatus(id, newStatus) {
    const previous = cvs.find((c) => c.id === id)?.sending_status;
    setUpdatingStatusId(id);
    setStatusErrors((prev) => ({ ...prev, [id]: "" }));
    // Optimistic update — reconciled/reverted below.
    setCvs((prev) => prev.map((c) => (c.id === id ? { ...c, sending_status: newStatus } : c)));
    try {
      const res = await fetch(`/api/admin/cvs/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحديث الحالة.");
      // Keep an expanded timeline in sync with the change that was just made.
      if (expandedId === id) loadHistory(id);
    } catch (err) {
      setCvs((prev) => prev.map((c) => (c.id === id ? { ...c, sending_status: previous } : c)));
      setStatusErrors((prev) => ({ ...prev, [id]: err.message || "تعذّر تحديث الحالة." }));
    } finally {
      setUpdatingStatusId(null);
    }
  }

  async function loadHistory(id) {
    setHistoryCache((prev) => ({ ...prev, [id]: { loading: true, error: "", items: prev[id]?.items || [] } }));
    try {
      const res = await fetch(`/api/admin/cvs/${id}/history`);
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل السجل.");
      setHistoryCache((prev) => ({ ...prev, [id]: { loading: false, error: "", items: data.history || [] } }));
    } catch (err) {
      setHistoryCache((prev) => ({ ...prev, [id]: { loading: false, error: err.message || "تعذّر تحميل السجل.", items: [] } }));
    }
  }

  function toggleHistory(id) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!historyCache[id]) loadHistory(id);
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", color: C.ink }}>
      <div style={{ background: C.ink, padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>لوحة المشرف — توليد أكواد الطلبات</div>
        <button onClick={handleLogout} disabled={loggingOut} style={{ ...btnGhostOnDark, opacity: loggingOut ? 0.7 : 1 }}>
          <LogOut size={15} /> تسجيل الخروج
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 60px" }}>
        <div style={noteBanner}>
          هذه اللوحة تحتوي بيانات شخصية حقيقية لمتقدمين (أرشيف السير الذاتية) — الوصول محمي بجلسة تسجيل دخول آمنة على الخادم.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setTab("codes")} style={tabBtnStyle(tab === "codes")}>
              <Sparkles size={15} /> الأكواد
            </button>
            <button onClick={() => setTab("archive")} style={tabBtnStyle(tab === "archive")}>
              <Archive size={15} /> أرشيف السير الذاتية
            </button>
          </div>
          <button
            onClick={() => (tab === "archive" ? loadCvs(statusFilter) : loadCodes())}
            disabled={tab === "archive" ? loadingCvs : loadingCodes}
            style={tabBtnStyle(false)}
            title="تحديث القائمة — البيانات لا تتحدث تلقائيًا إذا تغيّرت من جلسة أخرى"
          >
            <RefreshCw size={15} className={(tab === "archive" ? loadingCvs : loadingCodes) ? "spin-admin" : ""} /> تحديث
          </button>
        </div>

        {tab === "codes" ? (
        <>
        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <button onClick={handleGenerate} disabled={generating} style={{ ...btnPrimary, opacity: generating ? 0.7 : 1 }}>
            {generating ? <><Loader2 size={16} className="spin-admin" /> جارٍ الإنشاء...</> : <><Sparkles size={16} /> توليد كود جديد</>}
          </button>
          {generateError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#b3261e" }}>{generateError}</div>}

          {lastGenerated && (
            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
              <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, color: C.ink, fontFamily: "monospace" }}>{lastGenerated.code}</span>
              <button onClick={() => handleCopy(lastGenerated.code)} style={btnIcon} title="نسخ">
                {copiedCode === lastGenerated.code ? <Check size={17} color="#1a3a5c" /> : <Copy size={17} color="#1a3a5c" />}
              </button>
            </div>
          )}
        </div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.soft }}>
                <th style={thStyle}>الكود</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>رقم طلب سلة (اختياري)</th>
                <th style={thStyle}>وقت الإنشاء</th>
              </tr>
            </thead>
            <tbody>
              {loadingCodes ? (
                <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: C.slate, padding: 24 }}>جارٍ التحميل...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#b3261e", padding: 24 }}>{loadError}</td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: C.slate, padding: 24 }}>لا توجد أكواد بعد — اضغط "توليد كود جديد"</td></tr>
              ) : (
                codes.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 700 }}>
                      {c.code}
                      <button onClick={() => handleCopy(c.code)} style={{ ...btnIcon, marginInlineStart: 6 }} title="نسخ">
                        {copiedCode === c.code ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <span style={c.status === "used" ? statusBadgeUsed : statusBadge}>{c.status === "used" ? "مستخدم" : "متاح"}</span>
                    </td>
                    <td style={tdStyle}>
                      <input
                        defaultValue={c.salla_order_number || ""}
                        onBlur={(e) => e.target.value !== (c.salla_order_number || "") && updateOrder(c.id, e.target.value)}
                        placeholder="مثال: 10234"
                        style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
                      />
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, fontSize: 12 }}>{new Date(c.created_at).toLocaleString("ar-SA")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
        </>
        ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.slate }}>تصفية حسب حالة الإرسال:</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }}>
              <option value="">الكل</option>
              {SENDING_STATUSES.map((s) => (
                <option key={s} value={s}>{SENDING_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {loadingCvs ? (
            <div style={emptyStateBox}>جارٍ التحميل...</div>
          ) : cvsError ? (
            <div style={{ ...emptyStateBox, color: "#b3261e" }}>{cvsError}</div>
          ) : cvs.length === 0 ? (
            <div style={emptyStateBox}>{statusFilter ? "لا توجد سير ذاتية بهذه الحالة." : "لا توجد سير ذاتية محفوظة بعد."}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {cvs.map((v) => {
                const colors = SENDING_STATUS_COLORS[v.sending_status] || SENDING_STATUS_COLORS.pending;
                const history = historyCache[v.id];
                const expanded = expandedId === v.id;
                return (
                  <div key={v.id} style={archiveCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{v.applicant_name || "بدون اسم"}</div>
                        {v.applicant_target_role && (
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 12.5, color: C.slate, fontWeight: 600 }}>
                            <Target size={13} /> {v.applicant_target_role}
                          </div>
                        )}
                      </div>
                      <span style={{ display: "inline-block", background: colors.bg, color: colors.fg, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap" }}>
                        {SENDING_STATUS_LABELS[v.sending_status] || v.sending_status}
                      </span>
                    </div>

                    <div style={fieldGrid}>
                      <Field icon={Mail} label="البريد الإلكتروني" value={v.applicant_email} />
                      <Field icon={Phone} label="رقم الجوال" value={v.applicant_phone} />
                      <Field icon={MapPin} label="المدينة" value={v.applicant_city} />
                      <Field icon={Hash} label="رقم طلب سلة" value={v.salla_order_number} />
                      <Field icon={KeyRound} label="كود الدخول" value={v.code} mono />
                      <Field icon={Languages} label="اللغة" value={v.pdf_language === "en" ? "English" : "العربية"} />
                      <Field icon={Clock} label="تاريخ الإنشاء" value={v.generated_at ? new Date(v.generated_at).toLocaleString("ar-SA") : "—"} />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                      <a href={`/api/admin/cvs/${v.id}/pdf`} target="_blank" rel="noreferrer" style={btnViewLink}>
                        <FileText size={14} /> عرض / تحميل PDF
                      </a>

                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate, fontWeight: 600 }}>
                        حالة الإرسال:
                        <select
                          value={v.sending_status}
                          disabled={updatingStatusId === v.id}
                          onChange={(e) => updateSendingStatus(v.id, e.target.value)}
                          style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12.5, opacity: updatingStatusId === v.id ? 0.6 : 1 }}
                        >
                          {SENDING_STATUSES.map((s) => (
                            <option key={s} value={s}>{SENDING_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </label>

                      <button onClick={() => toggleHistory(v.id)} style={btnHistoryToggle}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} سجل الحالة
                      </button>
                    </div>

                    {statusErrors[v.id] && <div style={{ marginTop: 8, fontSize: 12, color: "#b3261e" }}>{statusErrors[v.id]}</div>}

                    {expanded && (
                      <div style={historyBox}>
                        {history?.loading ? (
                          <div style={{ fontSize: 12.5, color: C.slate }}>جارٍ التحميل...</div>
                        ) : history?.error ? (
                          <div style={{ fontSize: 12.5, color: "#b3261e" }}>{history.error}</div>
                        ) : !history?.items?.length ? (
                          <div style={{ fontSize: 12.5, color: C.slate }}>لا يوجد سجل بعد.</div>
                        ) : (
                          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                            {history.items.map((h, i) => (
                              <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: (SENDING_STATUS_COLORS[h.status] || SENDING_STATUS_COLORS.pending).fg, flexShrink: 0 }} />
                                <span style={{ fontWeight: 700, color: C.ink }}>{SENDING_STATUS_LABELS[h.status] || h.status}</span>
                                <span style={{ color: C.slate }}>{new Date(h.changed_at).toLocaleString("ar-SA")}</span>
                                {h.changed_by && <span style={{ color: C.slate }}>— {h.changed_by}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
        )}
      </div>
      <style>{`.spin-admin { animation: spin-admin 1s linear infinite; } @keyframes spin-admin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Field({ icon: Icon, label, value, mono }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600, marginBottom: 2 }}>
        <Icon size={12} /> {label}
      </div>
      <div style={{ fontSize: 13, color: C.ink, fontFamily: mono ? "monospace" : "inherit", overflowWrap: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhostOnDark = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#ffffff", border: "1px solid #2d5578", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnIcon = { background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "inline-flex", verticalAlign: "middle" };
const noteBanner = { background: "#e8eef4", border: "1px dashed #dde4ec", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#3a4a5a", marginBottom: 20, textAlign: "center", lineHeight: 1.6 };
const thStyle = { textAlign: "start", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#1a3a5c", borderBottom: "1px solid #dde4ec" };
const tdStyle = { padding: "10px 14px", fontSize: 12.5, color: "#1a3a5c", verticalAlign: "middle" };
const btnViewLink = { display: "inline-flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#ffffff", borderRadius: 6, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, textDecoration: "none" };
const btnHistoryToggle = { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", color: "#1a3a5c", border: "1px solid #dde4ec", borderRadius: 6, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const emptyStateBox = { background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 32, textAlign: "center", color: C.slate, fontSize: 13 };
const archiveCard = { background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px" };
const fieldGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px 16px", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` };
const historyBox = { marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${C.line}` };
function tabBtnStyle(active) {
  return {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8,
    border: `1px solid ${active ? "#1a3a5c" : "#dde4ec"}`,
    background: active ? "#1a3a5c" : "#ffffff",
    color: active ? "#ffffff" : "#3a4a5a",
    fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
}
const statusBadge = { display: "inline-block", background: "#1a3a5c", color: "#ffffff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 10px" };
const statusBadgeUsed = { display: "inline-block", background: "#8a8f98", color: "#ffffff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 10px" };
