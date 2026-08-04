"use client";

import React, { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

const C = { ink: "#1a3a5c", paper: "#f5f7fa", paperCard: "#ffffff", slate: "#3a4a5a", line: "#dde4ec" };

export default function AccessGate({ onContinue }) {
  const [code, setCode] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!code.trim() || !orderNumber.trim()) {
      alert("الرجاء إدخال الكود ورقم الطلب.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), sallaOrderNumber: orderNumber.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "الكود غير صحيح أو مستخدم من قبل.");
        return;
      }
      onContinue();
    } catch (err) {
      setError("تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 400, background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 28, boxShadow: "0 1px 3px rgba(20,40,60,.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ background: C.ink, width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <KeyRound size={20} color="#fff" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>الدخول إلى منشئ السيرة الذاتية</div>
        </div>
        <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 20 }}>أدخل الكود المُرسَل إليك ورقم طلبك في سلة للمتابعة.</div>

        <label style={labelStyle}>كود الدخول</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} placeholder="CV-XXXX-XXXX" />

        <label style={{ ...labelStyle, marginTop: 14 }}>رقم طلب سلة</label>
        <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} style={inputStyle} placeholder="مثال: 10234" />

        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: "#b3261e", fontWeight: 600 }}>{error}</div>}

        <button type="submit" disabled={submitting} style={{ ...btnPrimary, width: "100%", marginTop: 20, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? <><Loader2 size={16} className="spin-gate" /> جارٍ التحقق...</> : "متابعة"}
        </button>
      </form>
      <style>{`.spin-gate { animation: spin-gate 1s linear infinite; } @keyframes spin-gate { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#3a4a5a", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a3a5c", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
