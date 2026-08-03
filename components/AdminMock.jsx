"use client";

import React, { useState } from "react";
import { Lock, Copy, LogOut, Sparkles, Check } from "lucide-react";

const C = { ink: "#1a3a5c", paper: "#f5f7fa", paperCard: "#ffffff", slate: "#3a4a5a", line: "#dde4ec", soft: "#e8eef4" };

const DEMO_USER = "admin";
const DEMO_PASS = "admin123";

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `CV-${seg(4)}-${seg(4)}`;
}

export default function AdminMock() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [codes, setCodes] = useState([]);
  const [copiedCode, setCopiedCode] = useState("");

  function handleLogin(e) {
    e.preventDefault();
    if (username === DEMO_USER && password === DEMO_PASS) {
      setError("");
      setLoggedIn(true);
    } else {
      setError("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }
  }

  function handleLogout() {
    setLoggedIn(false);
    setUsername("");
    setPassword("");
    setError("");
  }

  function handleGenerate() {
    const code = generateCode();
    setCodes((prev) => [
      { code, status: "متاح", order: "", createdAt: new Date().toLocaleString("ar-SA") },
      ...prev,
    ]);
  }

  function handleCopy(code) {
    navigator.clipboard?.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 1500);
  }

  function updateOrder(index, value) {
    setCodes((prev) => prev.map((c, i) => (i === index ? { ...c, order: value } : c)));
  }

  if (!loggedIn) {
    return (
      <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 360, background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 28, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ background: C.ink, width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock size={20} color="#fff" />
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>تسجيل دخول المشرف</div>
          </div>

          <label style={labelStyle}>اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} placeholder="admin" />

          <label style={{ ...labelStyle, marginTop: 14 }}>كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="••••••••" />

          {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b3261e" }}>{error}</div>}

          <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 18 }}>تسجيل الدخول</button>

          <div style={{ marginTop: 16, fontSize: 11.5, color: C.slate, background: C.soft, border: `1px dashed ${C.line}`, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            بيانات تجريبية: admin / admin123
          </div>
        </form>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", color: C.ink }}>
      <div style={{ background: C.ink, padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>لوحة المشرف — توليد أكواد الطلبات</div>
        <button onClick={handleLogout} style={btnGhostOnDark}><LogOut size={15} /> تسجيل الخروج</button>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 20px 60px" }}>
        <div style={noteBanner}>نموذج تجريبي (Mock) — الأكواد لا تُحفظ فعليًا، للمعاينة فقط.</div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <button onClick={handleGenerate} style={btnPrimary}><Sparkles size={16} /> توليد كود جديد</button>

          {codes.length > 0 && (
            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
              <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1, color: C.ink, fontFamily: "monospace" }}>{codes[0].code}</span>
              <button onClick={() => handleCopy(codes[0].code)} style={btnIcon} title="نسخ">
                {copiedCode === codes[0].code ? <Check size={17} color="#1a3a5c" /> : <Copy size={17} color="#1a3a5c" />}
              </button>
            </div>
          )}
        </div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
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
              {codes.length === 0 ? (
                <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: C.slate, padding: 24 }}>لا توجد أكواد بعد — اضغط "توليد كود جديد"</td></tr>
              ) : (
                codes.map((c, i) => (
                  <tr key={c.code} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 700 }}>
                      {c.code}
                      <button onClick={() => handleCopy(c.code)} style={{ ...btnIcon, marginInlineStart: 6 }} title="نسخ">
                        {copiedCode === c.code ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </td>
                    <td style={tdStyle}><span style={statusBadge}>{c.status}</span></td>
                    <td style={tdStyle}>
                      <input
                        value={c.order}
                        onChange={(e) => updateOrder(i, e.target.value)}
                        placeholder="مثال: 10234"
                        style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
                      />
                    </td>
                    <td style={{ ...tdStyle, color: C.slate, fontSize: 12 }}>{c.createdAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#3a4a5a", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnGhostOnDark = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#ffffff", border: "1px solid #2d5578", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const btnIcon = { background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "inline-flex", verticalAlign: "middle" };
const noteBanner = { background: "#e8eef4", border: "1px dashed #dde4ec", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#3a4a5a", marginBottom: 20, textAlign: "center" };
const thStyle = { textAlign: "start", padding: "10px 14px", fontSize: 12, fontWeight: 700, color: "#1a3a5c", borderBottom: "1px solid #dde4ec" };
const tdStyle = { padding: "10px 14px", fontSize: 12.5, color: "#1a3a5c", verticalAlign: "middle" };
const statusBadge = { display: "inline-block", background: "#1a3a5c", color: "#ffffff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 10px" };
