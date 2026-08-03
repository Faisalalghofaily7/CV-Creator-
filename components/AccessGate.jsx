"use client";

import React, { useState } from "react";
import { KeyRound } from "lucide-react";

const C = { ink: "#000000", paper: "#ffffff", paperCard: "#ffffff", slate: "#333333", line: "#d0d0d0" };

export default function AccessGate({ onContinue }) {
  const [code, setCode] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!code.trim() || !orderNumber.trim()) {
      alert("الرجاء إدخال الكود ورقم الطلب.");
      return;
    }
    onContinue();
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

        <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 20 }}>متابعة</button>
      </form>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 13, fontWeight: 600, color: "#000000", marginBottom: 6 };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #cccccc", background: "#ffffff", fontSize: 13.5, color: "#000000", fontFamily: "inherit", boxSizing: "border-box" };
const btnPrimary = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#000000", color: "#ffffff", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
