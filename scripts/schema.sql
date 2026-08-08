-- Access-code system for gating the CV builder behind a Salla order.
CREATE TABLE IF NOT EXISTS access_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  salla_order_number TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

-- CV archive: each generated PDF is uploaded to a private Vercel Blob store
-- and linked back to the access code that unlocked it. pdf_url stores the
-- blob's pathname (not a fetchable public URL — the store is private, so
-- reads always go through the authenticated admin API route).
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pdf_language TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_name TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

-- Applicant contact/targeting fields, captured at export time so admin staff
-- can review a full record without opening the PDF — applicant_target_role
-- in particular is intentionally never rendered into the CV/PDF itself, but
-- staff need it to know which type of company to send the CV to.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_email TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_phone TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_city TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_target_role TEXT;

-- Sending status: tracks whether staff have sent this applicant's CV out
-- yet. Defaults to 'pending' so every newly archived CV starts there.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS sending_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (sending_status IN ('pending', 'in_progress', 'on_hold', 'sent'));

-- Timestamped audit trail of every sending-status change, so staff can see
-- when a record moved between states and (best-effort) who changed it —
-- there's currently a single shared admin login, not per-admin accounts, so
-- changed_by records that shared admin username rather than a user id.
CREATE TABLE IF NOT EXISTS sending_status_history (
  id SERIAL PRIMARY KEY,
  access_code_id INTEGER NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sending_status_history_access_code_id_idx ON sending_status_history (access_code_id);

-- Admin sessions: opaque random tokens (the unguessable value IS the
-- credential — there is nothing to sign/verify beyond an exact DB match),
-- issued on successful login and stored in an httpOnly cookie.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Role decided at login time by which credential set matched (ADMIN_* vs
-- STAFF_*, see lib/adminAuth.js) and gates which API routes the session may
-- call — 'staff' can use the CV archive but not the codes endpoints.
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff'));

-- User sessions: lets someone who already validated a code at the gate
-- resume their form after a page refresh without re-entering it. The code
-- itself stays 'available' (not consumed) until a PDF is actually exported
-- successfully — see /api/generate-pdf.
CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
