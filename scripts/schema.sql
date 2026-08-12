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

-- Raw order-status slug as last reported by Salla's order.status.updated
-- webhook (e.g. 'completed', 'cancelled', 'refunded') — informational only,
-- shown to staff for context. Deliberately separate from `status` (whether
-- this code has been redeemed to generate a CV) and `sending_status`
-- (whether staff have sent the CV out): Salla's order lifecycle is not the
-- same thing as either, and driving those from it would risk locking a
-- paying customer out of a code that was never actually used.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS salla_order_status TEXT;

-- Requested service/package, captured when an admin manually generates a
-- code (optional — webhook-generated codes don't set this, since Salla's
-- payload doesn't carry a package selection). Free text rather than a CHECK
-- constraint so the admin UI's dropdown options can change without a migration.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS requested_package TEXT;

-- Timestamped audit trail of every status change, so staff can see when a
-- record moved between states and (best-effort) who changed it — there's
-- currently a single shared admin login, not per-admin accounts, so
-- changed_by records that shared admin username rather than a user id.
-- Originally scoped to just the staff sending-status; now holds the full
-- unified lifecycle_status timeline below (automatic stages get
-- changed_by = NULL, manual staff stages get the acting username) —
-- kept under its original name to avoid a destructive table rename.
CREATE TABLE IF NOT EXISTS sending_status_history (
  id SERIAL PRIMARY KEY,
  access_code_id INTEGER NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sending_status_history_access_code_id_idx ON sending_status_history (access_code_id);

-- Unified code/order lifecycle status, replacing the old split of `status`
-- (available/used) + `sending_status` (pending/in_progress/on_hold/sent)
-- with one field spanning the whole life of a code:
--   available            - AUTOMATIC: code generated, not yet redeemed.
--   customer_in_progress - AUTOMATIC: customer redeemed the code and is
--                          filling in the CV.
--   awaiting_sending     - AUTOMATIC: PDF successfully exported; the code
--                          is consumed (single-use) as of this stage.
--   staff_processing     - MANUAL: staff started sending it out.
--   on_hold              - MANUAL: staff paused it temporarily.
--   sent                 - MANUAL: staff finished sending it.
-- The old `status`/`sending_status` columns are left in place (unused by
-- the app going forward) rather than dropped, so this migration stays
-- non-destructive and reversible.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'available'
  CHECK (lifecycle_status IN ('available', 'customer_in_progress', 'awaiting_sending', 'staff_processing', 'on_hold', 'sent'));

-- One-time backfill from the old split fields for rows that predate this
-- column. Scoped to `lifecycle_status = 'available' AND status = 'used'`
-- so it only ever touches rows still sitting at the just-added default
-- whose old fields show they were actually used — safe to re-run this
-- whole script later without clobbering lifecycle_status the app has
-- since progressed via normal use (those rows no longer match the WHERE).
UPDATE access_codes SET lifecycle_status = CASE
  WHEN sending_status = 'in_progress' THEN 'staff_processing'
  WHEN sending_status = 'on_hold' THEN 'on_hold'
  WHEN sending_status = 'sent' THEN 'sent'
  ELSE 'awaiting_sending' -- sending_status = 'pending' (or any other value)
END
WHERE lifecycle_status = 'available' AND status = 'used';

-- How each code was generated, and by whom (if a human triggered it) — shown
-- to staff so they can tell at a glance where a code came from. Existing
-- codes predate this tracking, so they default to 'unknown'/NULL rather
-- than falsely claiming a specific source or creator.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS generation_source TEXT NOT NULL DEFAULT 'unknown'
  CHECK (generation_source IN ('manual', 'bulk_excel', 'salla_webhook', 'unknown'));
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS created_by TEXT;

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

-- Individual staff accounts, created and managed by the admin (list/edit/
-- reset password/deactivate/delete) — replaces the old single shared
-- STAFF_USERNAME/STAFF_PASSWORD_HASH login with real per-person accounts.
-- staff_type decides which archive records a staff member may view/update
-- (see lib/staffAccounts.js): 'linkedin' staff are scoped to CVs whose
-- requested_package is the LinkedIn package; 'sending' staff get everything
-- else. `active = false` is a soft disable — the row (and their name in
-- sending_status_history.changed_by, which is plain text, not a foreign
-- key) stays intact so history/timelines are never broken by deactivating
-- or deleting a staff account.
CREATE TABLE IF NOT EXISTS staff_accounts (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('sending', 'linkedin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notification recipient for this staff member — set/edited by the admin
-- in the staff management tab, replacing the old fixed
-- STAFF_NOTIFICATION_EMAIL/STAFF2_NOTIFICATION_EMAIL env vars as the
-- source of notification recipients (see lib/cvArchive.js). NULL/blank
-- until the admin sets it — an account with no email configured is simply
-- skipped when routing notifications, never a crash.
ALTER TABLE staff_accounts ADD COLUMN IF NOT EXISTS email TEXT;

-- Which staff account (if any) a staff session belongs to — NULL for admin
-- sessions and for a session created via the legacy STAFF_USERNAME/
-- STAFF_PASSWORD_HASH env-var login (kept working for backward
-- compatibility; treated as unrestricted, same as before this table
-- existed). ON DELETE SET NULL so deleting a staff_accounts row can never
-- fail on a lingering session row — the session simply stops resolving to
-- an active staff account on its next use (see lib/adminAuth.js).
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS staff_account_id INTEGER REFERENCES staff_accounts(id) ON DELETE SET NULL;

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

-- Separate LinkedIn-work status track (see lib/linkedinOrders.js), decoupled
-- from lifecycle_status: NULL means this code has no LinkedIn work
-- attached; a value means the Integrated package's LinkedIn portion is
-- being tracked here, starting at 'awaiting_processing' the moment the
-- code is created (bulk-upload/webhook/manual) — independent of whether
-- the customer has generated their CV yet, since LinkedIn staff can start
-- that work immediately.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS linkedin_status TEXT
  CHECK (linkedin_status IS NULL OR linkedin_status IN ('awaiting_processing', 'in_progress', 'on_hold', 'done'));

-- Standalone LinkedIn-only orders: the "إعداد صفحة على لينكدإن احترافية"
-- package involves no CV at all, so it never gets an access_codes row (no
-- code is generated, no CV builder is ever touched) — this table is its
-- entire record, visible directly in LinkedIn staff's panel from creation.
CREATE TABLE IF NOT EXISTS linkedin_orders (
  id SERIAL PRIMARY KEY,
  salla_order_number TEXT UNIQUE NOT NULL,
  applicant_name TEXT,
  applicant_phone TEXT,
  requested_package TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_processing'
    CHECK (status IN ('awaiting_processing', 'in_progress', 'on_hold', 'done')),
  generation_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (generation_source IN ('manual', 'bulk_excel', 'salla_webhook', 'unknown')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timestamped audit trail for the LinkedIn-work track, covering BOTH kinds
-- of record it can apply to — an Integrated access_codes row (via
-- linkedin_status) or a standalone linkedin_orders row — so the merged
-- LinkedIn panel can show one consistent timeline regardless of which
-- table a given item actually lives in. Exactly one of the two FKs is set
-- per row.
CREATE TABLE IF NOT EXISTS linkedin_status_history (
  id SERIAL PRIMARY KEY,
  access_code_id INTEGER REFERENCES access_codes(id) ON DELETE CASCADE,
  linkedin_order_id INTEGER REFERENCES linkedin_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((access_code_id IS NOT NULL)::int + (linkedin_order_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS linkedin_status_history_access_code_id_idx ON linkedin_status_history (access_code_id);
CREATE INDEX IF NOT EXISTS linkedin_status_history_linkedin_order_id_idx ON linkedin_status_history (linkedin_order_id);

-- Visibility into whether the LinkedIn-staff notification email for THIS
-- record actually went out — computed once, right after the send attempt
-- at creation time (linkedin_orders) or at CV-generation time for an
-- Integrated code (access_codes), and shown directly in the admin's
-- merged LinkedIn panel instead of only ever existing in server logs.
-- 'sent' = at least one active recipient got the email; 'failed' = at
-- least one recipient existed but every send attempt errored (e.g. Resend
-- misconfigured); 'no_recipient' = no active 'linkedin'-type staff account
-- had an email set at all, so nothing was ever attempted. NULL means no
-- notification was ever due for this record.
ALTER TABLE linkedin_orders ADD COLUMN IF NOT EXISTS notification_status TEXT
  CHECK (notification_status IS NULL OR notification_status IN ('sent', 'failed', 'no_recipient'));
ALTER TABLE linkedin_orders ADD COLUMN IF NOT EXISTS notified_email TEXT;
ALTER TABLE linkedin_orders ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- Same tracking for the LinkedIn portion of an Integrated-package code —
-- kept as separate columns (not reusing the linkedin_orders ones, which
-- don't apply to this row at all) so the merged panel can show identical
-- status for both kinds of record it lists.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS linkedin_notification_status TEXT
  CHECK (linkedin_notification_status IS NULL OR linkedin_notification_status IN ('sent', 'failed', 'no_recipient'));
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS linkedin_notified_email TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS linkedin_notified_at TIMESTAMPTZ;
