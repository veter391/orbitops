-- Multi-tenant isolation: every proposal, telemetry reading, and audit entry is
-- owned by exactly one customer. Isolation is enforced in the app layer (every
-- query is scoped by customer_id); production additionally applies Postgres
-- row-level security as defense-in-depth (see docs/BACKEND-PLAN.md).

CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  api_key_hash TEXT UNIQUE NOT NULL, -- sha256(api_key), hex
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stable demo tenant for local dev, and the owner of any rows created before
-- this migration. api_key_hash = sha256('demo-key').
INSERT INTO customers (id, name, api_key_hash)
VALUES (
  '00000000-0000-0000-0000-0000000000d0',
  'demo',
  'c48a01f49fd0f2cc404bc3cbbc80e91457a3d41bb429a695243de4c61794155c'
)
ON CONFLICT (api_key_hash) DO NOTHING;

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS customer_id UUID;

-- Backfill any pre-existing rows to the demo tenant.
UPDATE proposals SET customer_id = '00000000-0000-0000-0000-0000000000d0' WHERE customer_id IS NULL;
UPDATE telemetry SET customer_id = '00000000-0000-0000-0000-0000000000d0' WHERE customer_id IS NULL;
UPDATE audit_log SET customer_id = '00000000-0000-0000-0000-0000000000d0' WHERE customer_id IS NULL;

ALTER TABLE proposals ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE telemetry ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN customer_id SET NOT NULL;

-- The audit hash chain is per-tenant: seq restarts at 0 per customer and each
-- entry links only to its own tenant's predecessor. Promote the primary key
-- from (seq) to (customer_id, seq) to match.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
ALTER TABLE audit_log ADD PRIMARY KEY (customer_id, seq);

-- Tenant-scoped read paths.
CREATE INDEX IF NOT EXISTS proposals_customer_ts_idx ON proposals (customer_id, ts DESC);
CREATE INDEX IF NOT EXISTS telemetry_customer_sat_metric_ts_idx
  ON telemetry (customer_id, satellite_id, metric, ts DESC);
