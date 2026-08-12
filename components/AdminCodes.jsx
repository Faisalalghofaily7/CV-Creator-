"use client";

import React, { useEffect, useState } from "react";
import { Copy, LogOut, Sparkles, Check, Loader2, FileText, Archive, RefreshCw, ChevronDown, ChevronUp, Mail, Phone, MapPin, Target, Hash, KeyRound, Languages, Clock, Upload, Tag, User, Users, UserPlus, Power, Trash2, Lock, AlertTriangle, Linkedin, AlertCircle } from "lucide-react";
import { LIFECYCLE_STATUSES, MANUAL_LIFECYCLE_STATUSES, LIFECYCLE_STATUS_LABELS, LIFECYCLE_STATUS_COLORS } from "../lib/lifecycleStatus";
import { GENERATION_SOURCE_LABELS, GENERATION_SOURCE_COLORS, creatorLabel } from "../lib/generationSource";
import { STAFF_TYPES, STAFF_TYPE_LABELS, PACKAGE_OPTIONS, isValidStaffEmail } from "../lib/staffAccounts";
import { LINKEDIN_ORDER_STATUSES, LINKEDIN_ORDER_STATUS_LABELS, LINKEDIN_ORDER_STATUS_COLORS } from "../lib/linkedinOrders";

const C = { ink: "#1a3a5c", paper: "#f5f7fa", paperCard: "#ffffff", slate: "#3a4a5a", line: "#dde4ec", soft: "#e8eef4" };

// Real server-side session (httpOnly cookie, checked in app/admin/page.js
// before this component ever renders) — no credentials live here anymore.
function redirectToLogin() {
  window.location.assign("/admin/login");
}

export default function AdminCodes({ role, staffType }) {
  // Staff accounts can only use the CV archive (and, for 'linkedin'-type
  // staff, the LinkedIn panel) — tabs the current role/type can't reach
  // aren't even shown, though the real boundary is always server-side
  // (requireRole on the codes routes, staffType checks on the LinkedIn
  // routes; this is just so nobody sees a tab that would immediately 403
  // if they clicked it).
  const isAdmin = role === "admin";
  const isLinkedinStaff = role === "staff" && staffType === "linkedin";
  const [tab, setTab] = useState(isAdmin ? "codes" : isLinkedinStaff ? "linkedin" : "archive"); // "codes" | "bulk" | "archive" | "staff" | "linkedin"
  const [loggingOut, setLoggingOut] = useState(false);

  const [codes, setCodes] = useState([]);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [lastGenerated, setLastGenerated] = useState(null);
  const [lastLinkedinOrder, setLastLinkedinOrder] = useState(null);
  const [copiedCode, setCopiedCode] = useState("");
  const [newOrderNumber, setNewOrderNumber] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newPackage, setNewPackage] = useState("");
  const [codesStatusFilter, setCodesStatusFilter] = useState("");

  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState(null);

  const [cvs, setCvs] = useState([]);
  const [loadingCvs, setLoadingCvs] = useState(false);
  const [cvsError, setCvsError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [statusErrors, setStatusErrors] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [historyCache, setHistoryCache] = useState({});

  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [staffError, setStaffError] = useState("");
  const [newStaffUsername, setNewStaffUsername] = useState("");
  const [newStaffDisplayName, setNewStaffDisplayName] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [newStaffType, setNewStaffType] = useState(STAFF_TYPES[0]);
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createStaffError, setCreateStaffError] = useState("");
  const [staffRowErrors, setStaffRowErrors] = useState({});
  const [savingStaffId, setSavingStaffId] = useState(null);
  const [resetPasswordDrafts, setResetPasswordDrafts] = useState({});
  const [deleteWarning, setDeleteWarning] = useState(null); // { id, historyCount, message } | null

  const [linkedinOrders, setLinkedinOrders] = useState([]);
  const [loadingLinkedinOrders, setLoadingLinkedinOrders] = useState(false);
  const [linkedinOrdersError, setLinkedinOrdersError] = useState("");
  const [linkedinStatusFilter, setLinkedinStatusFilter] = useState("");
  const [updatingLinkedinId, setUpdatingLinkedinId] = useState(null);
  const [linkedinStatusErrors, setLinkedinStatusErrors] = useState({});
  const [linkedinExpandedId, setLinkedinExpandedId] = useState(null);
  const [linkedinHistoryCache, setLinkedinHistoryCache] = useState({});

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
    if (isAdmin) loadCodes();
  }, [isAdmin]);

  useEffect(() => {
    if (tab === "archive") loadCvs(statusFilter);
  }, [tab, statusFilter]);

  async function loadStaff() {
    setLoadingStaff(true);
    setStaffError("");
    try {
      const res = await fetch("/api/admin/staff");
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل قائمة الموظفين.");
      setStaffList(data.staff || []);
    } catch (err) {
      setStaffError(err.message || "تعذّر تحميل قائمة الموظفين.");
    } finally {
      setLoadingStaff(false);
    }
  }

  useEffect(() => {
    if (tab === "staff" && isAdmin) loadStaff();
  }, [tab, isAdmin]);

  async function loadLinkedinOrders() {
    setLoadingLinkedinOrders(true);
    setLinkedinOrdersError("");
    try {
      const res = await fetch("/api/admin/linkedin-orders");
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل طلبات لينكدإن.");
      setLinkedinOrders(data.orders || []);
    } catch (err) {
      setLinkedinOrdersError(err.message || "تعذّر تحميل طلبات لينكدإن.");
    } finally {
      setLoadingLinkedinOrders(false);
    }
  }

  useEffect(() => {
    if (tab === "linkedin") loadLinkedinOrders();
  }, [tab]);

  async function updateLinkedinOrderStatus(id, newStatus) {
    const previous = linkedinOrders.find((o) => o.id === id)?.status;
    setUpdatingLinkedinId(id);
    setLinkedinStatusErrors((prev) => ({ ...prev, [id]: "" }));
    setLinkedinOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: newStatus } : o)));
    try {
      const res = await fetch(`/api/admin/linkedin-orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحديث الحالة.");
      if (linkedinExpandedId === id) loadLinkedinHistory(id);
    } catch (err) {
      setLinkedinOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: previous } : o)));
      setLinkedinStatusErrors((prev) => ({ ...prev, [id]: err.message || "تعذّر تحديث الحالة." }));
    } finally {
      setUpdatingLinkedinId(null);
    }
  }

  async function loadLinkedinHistory(id) {
    setLinkedinHistoryCache((prev) => ({ ...prev, [id]: { loading: true, error: "", items: prev[id]?.items || [] } }));
    try {
      const res = await fetch(`/api/admin/linkedin-orders/${id}/history`);
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر تحميل السجل.");
      setLinkedinHistoryCache((prev) => ({ ...prev, [id]: { loading: false, error: "", items: data.history || [] } }));
    } catch (err) {
      setLinkedinHistoryCache((prev) => ({ ...prev, [id]: { loading: false, error: err.message || "تعذّر تحميل السجل.", items: [] } }));
    }
  }

  function toggleLinkedinHistory(id) {
    if (linkedinExpandedId === id) {
      setLinkedinExpandedId(null);
      return;
    }
    setLinkedinExpandedId(id);
    if (!linkedinHistoryCache[id]) loadLinkedinHistory(id);
  }

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

  const canGenerate = newOrderNumber.trim() !== "" && newPhone.trim() !== "" && newName.trim() !== "";

  async function handleGenerate() {
    if (!canGenerate) {
      setGenerateError("رقم طلب سلة ورقم الجوال واسم العميل مطلوبة لتوليد الكود.");
      return;
    }
    setGenerating(true);
    setGenerateError("");
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sallaOrderNumber: newOrderNumber.trim(), applicantPhone: newPhone.trim(), applicantName: newName.trim(), requestedPackage: newPackage || null }),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر إنشاء الكود.");
      // A LinkedIn-only package never gets a code — it's a standalone
      // linkedin_orders record instead (see app/api/admin/codes/route.js),
      // so there's no code to show/copy here; point the admin at the
      // LinkedIn panel instead.
      if (data.linkedinOrder) {
        setLastGenerated(null);
        setLastLinkedinOrder(data.linkedinOrder);
      } else {
        setLastLinkedinOrder(null);
        setLastGenerated(data.code);
        setCodes((prev) => [data.code, ...prev]);
      }
      setNewOrderNumber("");
      setNewPhone("");
      setNewName("");
      setNewPackage("");
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

  async function handleBulkUpload() {
    if (!uploadFile) {
      setUploadError("الرجاء اختيار ملف Excel (.xlsx) أولاً.");
      return;
    }
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const body = new FormData();
      body.append("file", uploadFile);
      const res = await fetch("/api/admin/bulk-upload", { method: "POST", body });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر معالجة الملف.");
      setUploadResult(data);
      // Refetch rather than fabricate rows client-side — the summary
      // response only carries the fields needed for the summary itself,
      // not the full row shape the codes table expects.
      if (data.generated > 0) loadCodes();
      setUploadFile(null);
    } catch (err) {
      setUploadError(err.message || "تعذّر معالجة الملف.");
    } finally {
      setUploading(false);
    }
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

  async function updateLifecycleStatus(id, newStatus) {
    const previous = cvs.find((c) => c.id === id)?.lifecycle_status;
    setUpdatingStatusId(id);
    setStatusErrors((prev) => ({ ...prev, [id]: "" }));
    // Optimistic update — reconciled/reverted below.
    setCvs((prev) => prev.map((c) => (c.id === id ? { ...c, lifecycle_status: newStatus } : c)));
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
      setCvs((prev) => prev.map((c) => (c.id === id ? { ...c, lifecycle_status: previous } : c)));
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

  const canCreateStaff = newStaffUsername.trim() !== "" && newStaffDisplayName.trim() !== "" && newStaffPassword.length >= 8;

  async function handleCreateStaff() {
    if (!canCreateStaff) {
      setCreateStaffError("اسم المستخدم والاسم مطلوبان، وكلمة المرور 8 أحرف على الأقل.");
      return;
    }
    if (newStaffEmail.trim() && !isValidStaffEmail(newStaffEmail)) {
      setCreateStaffError("البريد الإلكتروني غير صالح.");
      return;
    }
    setCreatingStaff(true);
    setCreateStaffError("");
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newStaffUsername.trim(),
          displayName: newStaffDisplayName.trim(),
          password: newStaffPassword,
          staffType: newStaffType,
          email: newStaffEmail.trim(),
        }),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر إنشاء حساب الموظف.");
      setStaffList((prev) => [data.staff, ...prev]);
      setNewStaffUsername("");
      setNewStaffDisplayName("");
      setNewStaffPassword("");
      setNewStaffType(STAFF_TYPES[0]);
      setNewStaffEmail("");
    } catch (err) {
      setCreateStaffError(err.message || "تعذّر إنشاء حساب الموظف.");
    } finally {
      setCreatingStaff(false);
    }
  }

  // Shared by inline field edits, type change, deactivate/reactivate, and
  // password reset — all are just a partial PATCH of one staff account.
  async function patchStaff(id, patch) {
    setSavingStaffId(id);
    setStaffRowErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "تعذّر الحفظ.");
      setStaffList((prev) => prev.map((s) => (s.id === id ? data.staff : s)));
      return true;
    } catch (err) {
      setStaffRowErrors((prev) => ({ ...prev, [id]: err.message || "تعذّر الحفظ." }));
      return false;
    } finally {
      setSavingStaffId(null);
    }
  }

  async function handleResetPassword(id) {
    const newPassword = resetPasswordDrafts[id]?.value || "";
    if (newPassword.length < 8) {
      setStaffRowErrors((prev) => ({ ...prev, [id]: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." }));
      return;
    }
    const ok = await patchStaff(id, { newPassword });
    if (ok) setResetPasswordDrafts((prev) => ({ ...prev, [id]: { open: false, value: "" } }));
  }

  async function handleDeleteStaff(id, force) {
    setSavingStaffId(id);
    setStaffRowErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/staff/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      if (res.status === 401) return redirectToLogin();
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.warning) {
        setDeleteWarning({ id, historyCount: data.historyCount, message: data.error });
        return;
      }
      if (!res.ok) throw new Error(data.error || "تعذّر حذف الحساب.");
      setStaffList((prev) => prev.filter((s) => s.id !== id));
      setDeleteWarning(null);
    } catch (err) {
      setStaffRowErrors((prev) => ({ ...prev, [id]: err.message || "تعذّر حذف الحساب." }));
    } finally {
      setSavingStaffId(null);
    }
  }

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.paper, fontFamily: "'Segoe UI', Tahoma, sans-serif", color: C.ink }}>
      <div style={{ background: C.ink, padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{isAdmin ? "لوحة المشرف — توليد أكواد الطلبات" : "لوحة الموظفين — أرشيف السير الذاتية"}</div>
        <button onClick={handleLogout} disabled={loggingOut} style={{ ...btnGhostOnDark, opacity: loggingOut ? 0.7 : 1 }}>
          <LogOut size={15} /> تسجيل الخروج
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 60px" }}>
        <div style={noteBanner}>
          هذه اللوحة تحتوي بيانات شخصية حقيقية لمتقدمين (أرشيف السير الذاتية) — الوصول محمي بجلسة تسجيل دخول آمنة على الخادم.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
          {isAdmin ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => setTab("codes")} style={tabBtnStyle(tab === "codes")}>
                <Sparkles size={15} /> الأكواد
              </button>
              <button onClick={() => setTab("bulk")} style={tabBtnStyle(tab === "bulk")}>
                <Upload size={15} /> رفع طلبات سلة
              </button>
              <button onClick={() => setTab("archive")} style={tabBtnStyle(tab === "archive")}>
                <Archive size={15} /> أرشيف السير الذاتية
              </button>
              <button onClick={() => setTab("linkedin")} style={tabBtnStyle(tab === "linkedin")}>
                <Linkedin size={15} /> طلبات لينكدإن
              </button>
              <button onClick={() => setTab("staff")} style={tabBtnStyle(tab === "staff")}>
                <Users size={15} /> الموظفون
              </button>
            </div>
          ) : isLinkedinStaff ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setTab("linkedin")} style={tabBtnStyle(tab === "linkedin")}>
                <Linkedin size={15} /> طلبات لينكدإن
              </button>
              <button onClick={() => setTab("archive")} style={tabBtnStyle(tab === "archive")}>
                <Archive size={15} /> أرشيف السير الذاتية
              </button>
            </div>
          ) : (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: C.ink }}>
              <Archive size={16} /> أرشيف السير الذاتية
            </div>
          )}
          {tab !== "bulk" && (
          <button
            onClick={() => (tab === "archive" ? loadCvs(statusFilter) : tab === "staff" ? loadStaff() : tab === "linkedin" ? loadLinkedinOrders() : loadCodes())}
            disabled={tab === "archive" ? loadingCvs : tab === "staff" ? loadingStaff : tab === "linkedin" ? loadingLinkedinOrders : loadingCodes}
            style={tabBtnStyle(false)}
            title="تحديث القائمة — البيانات لا تتحدث تلقائيًا إذا تغيّرت من جلسة أخرى"
          >
            <RefreshCw size={15} className={(tab === "archive" ? loadingCvs : tab === "staff" ? loadingStaff : tab === "linkedin" ? loadingLinkedinOrders : loadingCodes) ? "spin-admin" : ""} /> تحديث
          </button>
          )}
        </div>

        {tab === "codes" && isAdmin ? (
        <>
        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
              اسم العميل *
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثال: عبدالله الفلاني" style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
              رقم طلب سلة *
              <input value={newOrderNumber} onChange={(e) => setNewOrderNumber(e.target.value)} placeholder="مثال: 10234" style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
              رقم جوال العميل *
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="مثال: 05xxxxxxxx" style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
              الخدمة المطلوبة (اختياري)
              <select value={newPackage} onChange={(e) => setNewPackage(e.target.value)} style={inputStyle}>
                <option value="">— بدون تحديد —</option>
                {PACKAGE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
          <button onClick={handleGenerate} disabled={generating || !canGenerate} style={{ ...btnPrimary, opacity: generating || !canGenerate ? 0.7 : 1 }}>
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

          {lastLinkedinOrder && (
            <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 10, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
              <Linkedin size={18} color="#1a3a5c" />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                طلب لينكدإن فقط — لا يوجد كود لهذا الطلب. يظهر الآن في تبويب "طلبات لينكدإن" بحالة "بانتظار المعالجة".
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.slate }}>تصفية حسب الحالة:</span>
          <select value={codesStatusFilter} onChange={(e) => setCodesStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }}>
            <option value="">الكل</option>
            {LIFECYCLE_STATUSES.map((s) => (
              <option key={s} value={s}>{LIFECYCLE_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.soft }}>
                <th style={thStyle}>الكود</th>
                <th style={thStyle}>الحالة</th>
                <th style={thStyle}>اسم العميل</th>
                <th style={thStyle}>رقم طلب سلة</th>
                <th style={thStyle}>رقم الجوال</th>
                <th style={thStyle}>الخدمة المطلوبة</th>
                <th style={thStyle}>المصدر</th>
                <th style={thStyle}>المُنشئ</th>
                <th style={thStyle}>وقت الإنشاء</th>
                <th style={thStyle}>السجل الزمني</th>
              </tr>
            </thead>
            <tbody>
              {loadingCodes ? (
                <tr><td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: C.slate, padding: 24 }}>جارٍ التحميل...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: "#b3261e", padding: 24 }}>{loadError}</td></tr>
              ) : codes.length === 0 ? (
                <tr><td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: C.slate, padding: 24 }}>لا توجد أكواد بعد — اضغط "توليد كود جديد"</td></tr>
              ) : (
                codes
                  .filter((c) => !codesStatusFilter || c.lifecycle_status === codesStatusFilter)
                  .map((c) => {
                    const statusColors = LIFECYCLE_STATUS_COLORS[c.lifecycle_status] || LIFECYCLE_STATUS_COLORS.available;
                    const sourceColors = GENERATION_SOURCE_COLORS[c.generation_source] || GENERATION_SOURCE_COLORS.unknown;
                    const expanded = expandedId === c.id;
                    const history = historyCache[c.id];
                    return (
                    <React.Fragment key={c.id}>
                    <tr style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 700 }}>
                        {c.code}
                        <button onClick={() => handleCopy(c.code)} style={{ ...btnIcon, marginInlineStart: 6 }} title="نسخ">
                          {copiedCode === c.code ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-block", background: statusColors.bg, color: statusColors.fg, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                          {LIFECYCLE_STATUS_LABELS[c.lifecycle_status] || c.lifecycle_status}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12.5 }}>{c.applicant_name ? <CopyField value={c.applicant_name} /> : "—"}</td>
                      <td style={tdStyle}>
                        <input
                          defaultValue={c.salla_order_number || ""}
                          onBlur={(e) => e.target.value !== (c.salla_order_number || "") && updateOrder(c.id, e.target.value)}
                          placeholder="مثال: 10234"
                          style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
                        />
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12.5 }}>{c.applicant_phone ? <CopyField value={c.applicant_phone} /> : "—"}</td>
                      <td style={{ ...tdStyle, fontSize: 12.5 }}>{c.requested_package ? <CopyField value={c.requested_package} /> : "—"}</td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-block", background: sourceColors.bg, color: sourceColors.fg, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap" }}>
                          {GENERATION_SOURCE_LABELS[c.generation_source] || GENERATION_SOURCE_LABELS.unknown}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12.5 }}>{creatorLabel(c)}</td>
                      <td style={{ ...tdStyle, color: C.slate, fontSize: 12 }}>{new Date(c.created_at).toLocaleString("ar-SA")}</td>
                      <td style={tdStyle}>
                        <button onClick={() => toggleHistory(c.id)} style={btnHistoryToggle}>
                          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} السجل
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={10} style={{ padding: "10px 14px", background: C.soft, borderTop: `1px dashed ${C.line}` }}>
                          <TimelineList history={history} />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  })
              )}
            </tbody>
          </table>
          </div>
        </div>
        </>
        ) : tab === "bulk" && isAdmin ? (
        <>
          <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 6 }}>رفع تقرير طلبات سلة (Excel)</div>
            <div style={{ ...hintStyleAdmin, marginBottom: 14 }}>
              يجب أن يحتوي الملف على الأعمدة: "اسم العميل"، "رقم الجوال"، "رقم الطلب"، "حالة الطلب"، "اسماء المنتجات مع SKU" (صف العناوين أولاً). تتم معالجة كل طلب بحالة "بإنتظار المراجعة" فقط، والخدمة المطلوبة تُكتشف تلقائياً من عمود المنتج: سيرة عربي/إنجليزي وباقة متكاملة تولّد كوداً (والمتكاملة تبدأ مسار لينكدإن أيضاً)، وطلبات لينكدإن فقط تُضاف مباشرة إلى تبويب "طلبات لينكدإن" بدون كود أو سيرة ذاتية. أي طلب لا يمكن تصنيفه يظهر في قائمة "يحتاج مراجعة" أدناه بدلاً من تخمينه. رقم الطلب المكرر (بأي نوع سجل) يُتخطى تلقائياً.
            </div>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setUploadError(""); setUploadResult(null); }}
              style={inputStyle}
            />
            <button
              onClick={handleBulkUpload}
              disabled={uploading || !uploadFile}
              style={{ ...btnPrimary, marginTop: 14, opacity: uploading || !uploadFile ? 0.7 : 1 }}
            >
              {uploading ? <><Loader2 size={16} className="spin-admin" /> جارٍ المعالجة...</> : <><Upload size={16} /> رفع ومعالجة الملف</>}
            </button>
            {uploadError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#b3261e" }}>{uploadError}</div>}

            {uploadResult && (
              <div style={{ marginTop: 18, background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                  تمت معالجة {uploadResult.processed} صف — تم توليد {uploadResult.generated} كود جديد — تم إنشاء {uploadResult.linkedinOnlyCreated || 0} طلب لينكدإن فقط — تم تخطي {uploadResult.skippedDuplicate} (موجودة مسبقاً) — {uploadResult.ineligibleStatus} غير مؤهلة (حالة مختلفة)
                  {uploadResult.invalidRows > 0 ? ` — ${uploadResult.invalidRows} صف بدون رقم طلب` : ""}
                  {uploadResult.unrecognized?.length > 0 ? ` — ${uploadResult.unrecognized.length} غير محدد (يحتاج مراجعة)` : ""}
                </div>

                {uploadResult.unrecognized?.length > 0 && (
                  <div style={{ marginBottom: 14, background: "#fdecea", border: "1px solid #f3c9c4", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#8a2e24", marginBottom: 8 }}>
                      <AlertCircle size={15} /> طلبات غير محددة — تحتاج مراجعة يدوية (لم يُنشأ لها أي سجل)
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>رقم الطلب</th>
                            <th style={thStyle}>اسم العميل</th>
                            <th style={thStyle}>نص المنتج الخام</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uploadResult.unrecognized.map((u, i) => (
                            <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                              <td style={tdStyle}><CopyField value={u.sallaOrderNumber} /></td>
                              <td style={tdStyle}>{u.applicantName || "—"}</td>
                              <td style={{ ...tdStyle, maxWidth: 260, overflowWrap: "break-word" }}>{u.rawProduct || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {uploadResult.generatedCodes?.length > 0 && (
                  <div style={{ maxHeight: 220, overflowY: "auto", background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: uploadResult.generatedLinkedinOrders?.length > 0 ? 12 : 0 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: C.soft }}>
                          <th style={thStyle}>الكود</th>
                          <th style={thStyle}>رقم طلب سلة</th>
                          <th style={thStyle}>اسم العميل</th>
                          <th style={thStyle}>الخدمة المكتشفة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.generatedCodes.map((g) => (
                          <tr key={g.code} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 700 }}><CopyField value={g.code} /></td>
                            <td style={tdStyle}><CopyField value={g.sallaOrderNumber} /></td>
                            <td style={tdStyle}>{g.applicantName || "—"}</td>
                            <td style={{ ...tdStyle, fontSize: 11.5 }}>{g.requestedPackage || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {uploadResult.generatedLinkedinOrders?.length > 0 && (
                  <div style={{ maxHeight: 220, overflowY: "auto", background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: C.soft }}>
                          <th style={thStyle}>رقم طلب سلة</th>
                          <th style={thStyle}>اسم العميل</th>
                          <th style={thStyle}>النوع</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.generatedLinkedinOrders.map((g, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                            <td style={tdStyle}><CopyField value={g.sallaOrderNumber} /></td>
                            <td style={tdStyle}>{g.applicantName || "—"}</td>
                            <td style={{ ...tdStyle, fontSize: 11.5 }}>لينكدإن فقط (بدون كود)</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
        ) : tab === "staff" && isAdmin ? (
        <StaffManagement
          staffList={staffList}
          loadingStaff={loadingStaff}
          staffError={staffError}
          newStaffUsername={newStaffUsername} setNewStaffUsername={setNewStaffUsername}
          newStaffDisplayName={newStaffDisplayName} setNewStaffDisplayName={setNewStaffDisplayName}
          newStaffPassword={newStaffPassword} setNewStaffPassword={setNewStaffPassword}
          newStaffType={newStaffType} setNewStaffType={setNewStaffType}
          newStaffEmail={newStaffEmail} setNewStaffEmail={setNewStaffEmail}
          creatingStaff={creatingStaff}
          createStaffError={createStaffError}
          canCreateStaff={canCreateStaff}
          handleCreateStaff={handleCreateStaff}
          patchStaff={patchStaff}
          savingStaffId={savingStaffId}
          staffRowErrors={staffRowErrors}
          resetPasswordDrafts={resetPasswordDrafts} setResetPasswordDrafts={setResetPasswordDrafts}
          handleResetPassword={handleResetPassword}
          deleteWarning={deleteWarning} setDeleteWarning={setDeleteWarning}
          handleDeleteStaff={handleDeleteStaff}
        />
        ) : tab === "linkedin" && (isAdmin || isLinkedinStaff) ? (
        <LinkedinPanel
          orders={linkedinOrders}
          loading={loadingLinkedinOrders}
          error={linkedinOrdersError}
          statusFilter={linkedinStatusFilter}
          setStatusFilter={setLinkedinStatusFilter}
          updatingId={updatingLinkedinId}
          statusErrors={linkedinStatusErrors}
          updateStatus={updateLinkedinOrderStatus}
          expandedId={linkedinExpandedId}
          toggleHistory={toggleLinkedinHistory}
          historyCache={linkedinHistoryCache}
          isAdmin={isAdmin}
        />
        ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.slate }}>تصفية حسب الحالة:</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }}>
              <option value="">الكل</option>
              {MANUAL_LIFECYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>{LIFECYCLE_STATUS_LABELS[s]}</option>
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
                const colors = LIFECYCLE_STATUS_COLORS[v.lifecycle_status] || LIFECYCLE_STATUS_COLORS.awaiting_sending;
                const sourceColors = GENERATION_SOURCE_COLORS[v.generation_source] || GENERATION_SOURCE_COLORS.unknown;
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
                        {LIFECYCLE_STATUS_LABELS[v.lifecycle_status] || v.lifecycle_status}
                      </span>
                    </div>

                    <div style={fieldGrid}>
                      <Field icon={Mail} label="البريد الإلكتروني" value={v.applicant_email} copyable />
                      <Field icon={Phone} label="رقم الجوال" value={v.applicant_phone} copyable />
                      <Field icon={MapPin} label="المدينة" value={v.applicant_city} copyable />
                      <Field icon={Hash} label="رقم طلب سلة" value={v.salla_order_number} copyable />
                      <Field icon={KeyRound} label="كود الدخول" value={v.code} mono copyable />
                      <Field icon={Sparkles} label="الخدمة المطلوبة" value={v.requested_package} copyable />
                      <Field icon={Languages} label="اللغة" value={v.pdf_language === "en" ? "English" : "العربية"} />
                      <Field icon={Tag} label="المصدر" value={GENERATION_SOURCE_LABELS[v.generation_source]} />
                      <Field icon={User} label="المُنشئ" value={creatorLabel(v)} />
                      <Field icon={Clock} label="تاريخ الإنشاء" value={v.generated_at ? new Date(v.generated_at).toLocaleString("ar-SA") : "—"} />
                    </div>
                    <div style={{ ...hintStyleAdmin, marginTop: 8 }}>
                      <span style={{ display: "inline-block", background: sourceColors.bg, color: sourceColors.fg, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px" }}>
                        {GENERATION_SOURCE_LABELS[v.generation_source]}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                      <a href={`/api/admin/cvs/${v.id}/pdf`} target="_blank" rel="noreferrer" style={btnViewLink}>
                        <FileText size={14} /> عرض / تحميل PDF
                      </a>

                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate, fontWeight: 600 }}>
                        الحالة:
                        <select
                          value={v.lifecycle_status}
                          disabled={updatingStatusId === v.id}
                          onChange={(e) => updateLifecycleStatus(v.id, e.target.value)}
                          style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12.5, opacity: updatingStatusId === v.id ? 0.6 : 1 }}
                        >
                          {MANUAL_LIFECYCLE_STATUSES.map((s) => (
                            <option key={s} value={s}>{LIFECYCLE_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </label>

                      <button onClick={() => toggleHistory(v.id)} style={btnHistoryToggle}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} السجل الزمني
                      </button>
                    </div>

                    {statusErrors[v.id] && <div style={{ marginTop: 8, fontSize: 12, color: "#b3261e" }}>{statusErrors[v.id]}</div>}

                    {expanded && (
                      <div style={historyBox}>
                        <TimelineList history={history} />
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

function StaffManagement({
  staffList, loadingStaff, staffError,
  newStaffUsername, setNewStaffUsername,
  newStaffDisplayName, setNewStaffDisplayName,
  newStaffPassword, setNewStaffPassword,
  newStaffType, setNewStaffType,
  newStaffEmail, setNewStaffEmail,
  creatingStaff, createStaffError, canCreateStaff, handleCreateStaff,
  patchStaff, savingStaffId, staffRowErrors,
  resetPasswordDrafts, setResetPasswordDrafts, handleResetPassword,
  deleteWarning, setDeleteWarning, handleDeleteStaff,
}) {
  return (
    <>
      <div style={{ background: C.paperCard, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 14 }}>إضافة موظف جديد</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
            اسم الموظف *
            <input value={newStaffDisplayName} onChange={(e) => setNewStaffDisplayName(e.target.value)} placeholder="مثال: سارة العتيبي" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
            اسم المستخدم *
            <input value={newStaffUsername} onChange={(e) => setNewStaffUsername(e.target.value)} placeholder="مثال: sara.staff" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
            كلمة المرور *
            <input type="password" value={newStaffPassword} onChange={(e) => setNewStaffPassword(e.target.value)} placeholder="8 أحرف على الأقل" style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
            نوع الموظف *
            <select value={newStaffType} onChange={(e) => setNewStaffType(e.target.value)} style={inputStyle}>
              {STAFF_TYPES.map((t) => (
                <option key={t} value={t}>{STAFF_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: C.slate }}>
            البريد الإلكتروني (اختياري)
            <input type="email" value={newStaffEmail} onChange={(e) => setNewStaffEmail(e.target.value)} placeholder="sara@example.com" style={inputStyle} />
          </label>
        </div>
        <div style={{ ...hintStyleAdmin, marginBottom: 12 }}>
          يُستخدم البريد الإلكتروني لإرسال إشعارات الطلبات الجديدة تلقائياً حسب نوع الموظف والخدمة المطلوبة — يمكن تركه فارغاً وتعبئته لاحقاً.
        </div>
        <button onClick={handleCreateStaff} disabled={creatingStaff || !canCreateStaff} style={{ ...btnPrimary, opacity: creatingStaff || !canCreateStaff ? 0.7 : 1 }}>
          {creatingStaff ? <><Loader2 size={16} className="spin-admin" /> جارٍ الإنشاء...</> : <><UserPlus size={16} /> إنشاء حساب موظف</>}
        </button>
        {createStaffError && <div style={{ marginTop: 10, fontSize: 12.5, color: "#b3261e" }}>{createStaffError}</div>}
      </div>

      {loadingStaff ? (
        <div style={emptyStateBox}>جارٍ التحميل...</div>
      ) : staffError ? (
        <div style={{ ...emptyStateBox, color: "#b3261e" }}>{staffError}</div>
      ) : staffList.length === 0 ? (
        <div style={emptyStateBox}>لا يوجد موظفون بعد — أضف أول حساب موظف أعلاه.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {staffList.map((s) => (
            <StaffRow
              key={s.id}
              staff={s}
              saving={savingStaffId === s.id}
              rowError={staffRowErrors[s.id]}
              patchStaff={patchStaff}
              resetDraft={resetPasswordDrafts[s.id]}
              setResetDraft={(draft) => setResetPasswordDrafts((prev) => ({ ...prev, [s.id]: draft }))}
              handleResetPassword={handleResetPassword}
              deleteWarning={deleteWarning?.id === s.id ? deleteWarning : null}
              clearDeleteWarning={() => setDeleteWarning(null)}
              handleDeleteStaff={handleDeleteStaff}
            />
          ))}
        </div>
      )}
    </>
  );
}

function StaffRow({ staff, saving, rowError, patchStaff, resetDraft, setResetDraft, handleResetPassword, deleteWarning, clearDeleteWarning, handleDeleteStaff }) {
  const [username, setUsername] = useState(staff.username);
  const [displayName, setDisplayName] = useState(staff.display_name);
  const [email, setEmail] = useState(staff.email || "");

  return (
    <div style={archiveCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{staff.display_name}</div>
          <span style={{ display: "inline-block", background: staff.active ? "#e6f4ea" : "#fdecea", color: staff.active ? "#1e7d34" : "#b3261e", fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
            {staff.active ? "نشط" : "معطّل"}
          </span>
        </div>
        <span style={{ display: "inline-block", background: C.soft, color: C.ink, fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap" }}>
          {STAFF_TYPE_LABELS[staff.staff_type] || staff.staff_type}
        </span>
      </div>

      <div style={fieldGrid}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600 }}>
          الاسم
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => displayName.trim() && displayName !== staff.display_name && patchStaff(staff.id, { displayName: displayName.trim() })}
            style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600 }}>
          اسم المستخدم
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => username.trim() && username !== staff.username && patchStaff(staff.id, { username: username.trim() })}
            style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5, fontFamily: "monospace" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600 }}>
          نوع الموظف
          <select
            value={staff.staff_type}
            onChange={(e) => patchStaff(staff.id, { staffType: e.target.value })}
            style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
          >
            {STAFF_TYPES.map((t) => (
              <option key={t} value={t}>{STAFF_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600 }}>
          البريد الإلكتروني
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() !== (staff.email || "") && patchStaff(staff.id, { email: email.trim() })}
            placeholder="بدون بريد"
            style={{ ...inputStyle, padding: "6px 8px", fontSize: 12.5 }}
          />
        </label>
        <Field icon={Clock} label="تاريخ الإنشاء" value={new Date(staff.created_at).toLocaleString("ar-SA")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          onClick={() => setResetDraft({ open: !resetDraft?.open, value: "" })}
          style={btnHistoryToggle}
        >
          <Lock size={14} /> إعادة تعيين كلمة المرور
        </button>

        <button
          onClick={() => patchStaff(staff.id, { active: !staff.active })}
          disabled={saving}
          style={{ ...btnHistoryToggle, opacity: saving ? 0.6 : 1 }}
        >
          <Power size={14} /> {staff.active ? "تعطيل الحساب" : "إعادة تفعيل الحساب"}
        </button>

        <button
          onClick={() => handleDeleteStaff(staff.id, false)}
          disabled={saving}
          style={{ ...btnHistoryToggle, color: "#b3261e", borderColor: "#f3c9c4", opacity: saving ? 0.6 : 1 }}
        >
          <Trash2 size={14} /> حذف الحساب
        </button>
      </div>

      {resetDraft?.open && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            type="password"
            value={resetDraft.value}
            onChange={(e) => setResetDraft({ open: true, value: e.target.value })}
            placeholder="كلمة مرور جديدة (8 أحرف على الأقل)"
            style={{ ...inputStyle, width: "auto", flex: "1 1 220px", padding: "8px 10px", fontSize: 12.5 }}
          />
          <button onClick={() => handleResetPassword(staff.id)} disabled={saving} style={{ ...btnPrimary, padding: "8px 16px", fontSize: 12.5, opacity: saving ? 0.7 : 1 }}>
            حفظ كلمة المرور
          </button>
        </div>
      )}

      {deleteWarning && (
        <div style={{ marginTop: 12, background: "#fdecea", border: "1px solid #f3c9c4", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#8a2e24", lineHeight: 1.7 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{deleteWarning.message}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => handleDeleteStaff(staff.id, true)} disabled={saving} style={{ ...btnPrimary, background: "#b3261e", padding: "8px 16px", fontSize: 12.5, opacity: saving ? 0.7 : 1 }}>
              نعم، احذف نهائياً
            </button>
            <button onClick={clearDeleteWarning} style={{ ...btnHistoryToggle, padding: "8px 16px" }}>
              إلغاء (تعطيل بدلاً من ذلك)
            </button>
          </div>
        </div>
      )}

      {rowError && <div style={{ marginTop: 8, fontSize: 12, color: "#b3261e" }}>{rowError}</div>}
    </div>
  );
}

function LinkedinPanel({ orders, loading, error, statusFilter, setStatusFilter, updatingId, statusErrors, updateStatus, expandedId, toggleHistory, historyCache, isAdmin }) {
  const filtered = orders.filter((o) => !statusFilter || o.status === statusFilter);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.slate }}>تصفية حسب الحالة:</span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 12.5 }}>
          <option value="">الكل</option>
          {LINKEDIN_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{LINKEDIN_ORDER_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={emptyStateBox}>جارٍ التحميل...</div>
      ) : error ? (
        <div style={{ ...emptyStateBox, color: "#b3261e" }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={emptyStateBox}>{statusFilter ? "لا توجد طلبات بهذه الحالة." : "لا توجد طلبات لينكدإن بعد."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.map((o) => {
            const colors = LINKEDIN_ORDER_STATUS_COLORS[o.status] || LINKEDIN_ORDER_STATUS_COLORS.awaiting_processing;
            const history = historyCache[o.id];
            const expanded = expandedId === o.id;
            return (
              <div key={o.id} style={archiveCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{o.applicantName || "بدون اسم"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 12, color: C.slate, fontWeight: 600 }}>
                      {o.sourceType === "linkedin_only" ? "لينكدإن فقط (بدون كود/سيرة ذاتية)" : `ضمن الباقة المتكاملة${o.code ? ` — الكود: ${o.code}` : ""}`}
                    </div>
                  </div>
                  <span style={{ display: "inline-block", background: colors.bg, color: colors.fg, fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap" }}>
                    {LINKEDIN_ORDER_STATUS_LABELS[o.status] || o.status}
                  </span>
                </div>

                <div style={fieldGrid}>
                  <Field icon={User} label="اسم العميل" value={o.applicantName} copyable />
                  <Field icon={Phone} label="رقم الجوال" value={o.applicantPhone} copyable />
                  <Field icon={Hash} label="رقم طلب سلة" value={o.sallaOrderNumber} copyable />
                  <Field icon={Sparkles} label="الخدمة المطلوبة" value={o.requestedPackage} copyable />
                  {o.applicantEmail && <Field icon={Mail} label="البريد الإلكتروني" value={o.applicantEmail} copyable />}
                  <Field icon={Tag} label="المصدر" value={GENERATION_SOURCE_LABELS[o.generationSource] || GENERATION_SOURCE_LABELS.unknown} />
                  <Field icon={User} label="المُنشئ" value={creatorLabel({ generation_source: o.generationSource, created_by: o.createdBy })} />
                  <Field icon={Clock} label="تاريخ الإنشاء" value={new Date(o.createdAt).toLocaleString("ar-SA")} />
                  {isAdmin && o.sourceType === "integrated_cv" && (
                    <Field icon={FileText} label="حالة إرسال السيرة" value={LIFECYCLE_STATUS_LABELS[o.cvLifecycleStatus] || o.cvLifecycleStatus} />
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate, fontWeight: 600 }}>
                    الحالة:
                    <select
                      value={o.status}
                      disabled={updatingId === o.id}
                      onChange={(e) => updateStatus(o.id, e.target.value)}
                      style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 12.5, opacity: updatingId === o.id ? 0.6 : 1 }}
                    >
                      {LINKEDIN_ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>{LINKEDIN_ORDER_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </label>

                  <button onClick={() => toggleHistory(o.id)} style={btnHistoryToggle}>
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} السجل الزمني
                  </button>
                </div>

                {statusErrors[o.id] && <div style={{ marginTop: 8, fontSize: 12, color: "#b3261e" }}>{statusErrors[o.id]}</div>}

                {expanded && (
                  <div style={historyBox}>
                    <LinkedinTimelineList history={history} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function LinkedinTimelineList({ history }) {
  if (history?.loading) return <div style={{ fontSize: 12.5, color: C.slate }}>جارٍ التحميل...</div>;
  if (history?.error) return <div style={{ fontSize: 12.5, color: "#b3261e" }}>{history.error}</div>;
  if (!history?.items?.length) return <div style={{ fontSize: 12.5, color: C.slate }}>لا يوجد سجل بعد.</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {history.items.map((h, i) => (
        <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: (LINKEDIN_ORDER_STATUS_COLORS[h.status] || LINKEDIN_ORDER_STATUS_COLORS.awaiting_processing).fg, flexShrink: 0 }} />
          <span style={{ fontWeight: 700, color: C.ink }}>{LINKEDIN_ORDER_STATUS_LABELS[h.status] || h.status}</span>
          <span style={{ color: C.slate }}>{new Date(h.changed_at).toLocaleString("ar-SA")}</span>
          <span style={{ color: C.slate }}>— {h.changed_by || "غير معروف"}</span>
        </li>
      ))}
    </ul>
  );
}

function TimelineList({ history }) {
  if (history?.loading) return <div style={{ fontSize: 12.5, color: C.slate }}>جارٍ التحميل...</div>;
  if (history?.error) return <div style={{ fontSize: 12.5, color: "#b3261e" }}>{history.error}</div>;
  if (!history?.items?.length) return <div style={{ fontSize: 12.5, color: C.slate }}>لا يوجد سجل بعد.</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {history.items.map((h, i) => (
        <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: (LIFECYCLE_STATUS_COLORS[h.status] || LIFECYCLE_STATUS_COLORS.available).fg, flexShrink: 0 }} />
          <span style={{ fontWeight: 700, color: C.ink }}>{LIFECYCLE_STATUS_LABELS[h.status] || h.status}</span>
          <span style={{ color: C.slate }}>{new Date(h.changed_at).toLocaleString("ar-SA")}</span>
          <span style={{ color: C.slate }}>— {h.changed_by || "تلقائي (النظام)"}</span>
        </li>
      ))}
    </ul>
  );
}

function Field({ icon: Icon, label, value, mono, copyable }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.slate, fontWeight: 600, marginBottom: 2 }}>
        <Icon size={12} /> {label}
      </div>
      <div style={{ fontSize: 13, color: C.ink, fontFamily: mono ? "monospace" : "inherit", overflowWrap: "break-word" }}>
        {copyable && value ? <CopyField value={value} mono={mono} /> : value || "—"}
      </div>
    </div>
  );
}

// Small "value + copy button" pair used for every displayed customer field
// across the admin archive, codes table, and LinkedIn panel — copies just
// that one value with a brief "تم النسخ" confirmation.
function CopyField({ value, mono }) {
  const [copied, setCopied] = useState(false);
  if (value === null || value === undefined || value === "") return <span>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontFamily: mono ? "monospace" : "inherit", overflowWrap: "break-word" }}>{value}</span>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(String(value));
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        style={{ ...btnIcon, padding: 2 }}
        title={copied ? "تم النسخ" : "نسخ"}
      >
        {copied ? <Check size={12} color="#1a3a5c" /> : <Copy size={12} />}
      </button>
    </span>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #dde4ec", background: "#ffffff", fontSize: 13.5, color: "#3a4a5a", fontFamily: "inherit", boxSizing: "border-box" };
const hintStyleAdmin = { fontSize: 12, color: "#3a4a5a", lineHeight: 1.7 };
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
