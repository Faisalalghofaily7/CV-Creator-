"use client";

import React, { useState } from "react";
import { Lock, Loader2 } from "lucide-react";

const C = { ink: "#1a3a5c", paper: "#f5f7fa", paperCard: "#ffffff", slate: "#3a4a5a", line: "#dde4ec" };

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "اسم المستخدم أو كلمة المرور غير صحيحة.");
        return;
      }
      // Full navigation so the /admin server component re-checks the
      // session fresh, rather than relying on client-router cache.
      window.location.assign("/admin");
    } catch (err) {
      setError("تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 360, background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 28, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ background: C.ink, width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={20} color="#fff" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>تسجيل دخول المشرف</div>
        </div>

        <label style={labelStyle}>اسم المستخدم</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} autoComplete="username" />

        <label style={{ ...labelStyle, marginTop: 14 }}>كلمة المرور</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />

        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b3261e" }}>{error}</div>}

        <button type="submit" disabled={submitting} style={{ ...btnPrimary, width: "100%", marginTop: 18, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? <><Loader2 size={16} className="spin-login" /> جارٍ الدخول...</> : "تسجيل الدخول"}
        </button>
      </form>
      <style>{`.spin-login { animation: spin-login 1s linear infinite; display: inline-block; } @keyframes spin-login { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#3a4a5a", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
