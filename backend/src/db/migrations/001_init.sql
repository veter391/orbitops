-- Append-only, hash-chained audit log. The prev_hash/hash linkage plus an
-- app-layer HMAC (see src/audit) make it tamper-evident by construction.
CREATE TABLE IF NOT EXISTS audit_log (
  seq        BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);

-- AI proposals and the human decision recorded against each one.
CREATE TABLE IF NOT EXISTS proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  satellite_id    TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  reasoning_chain JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_action JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'modified')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ
);
