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

-- Admin sessions: opaque random tokens (the unguessable value IS the
-- credential — there is nothing to sign/verify beyond an exact DB match),
-- issued on successful login and stored in an httpOnly cookie.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

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
