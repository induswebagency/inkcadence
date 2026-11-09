-- 002_production.sql — SaaS-ready user fields + neural pack metadata.
-- All new columns are nullable / have defaults so self-host keeps working.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_hash TEXT;

ALTER TABLE style_packs ADD COLUMN IF NOT EXISTS render_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE style_packs ADD COLUMN IF NOT EXISTS model_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE style_packs ADD COLUMN IF NOT EXISTS model_uri TEXT;
ALTER TABLE style_packs ADD COLUMN IF NOT EXISTS model_metrics JSONB;

CREATE TABLE IF NOT EXISTS ml_jobs (
  id          TEXT PRIMARY KEY,
  pack_id     TEXT NOT NULL REFERENCES style_packs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'queued',
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ml_jobs_pack_idx ON ml_jobs (pack_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ml_jobs_status_idx ON ml_jobs (status, created_at);
