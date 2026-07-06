-- Per-operator identity. Until now a single API key authenticated a whole tenant
-- and the operator name was free text in the request body — so the audit trail
-- could record a fabricated identity. Operators are now first-class: an API key
-- resolves to a specific operator (who belongs to a customer), and every decision
-- is attributed to that authenticated operator, not to a string they typed.
CREATE TABLE IF NOT EXISTS operators (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  api_key_hash TEXT UNIQUE NOT NULL, -- sha256(api_key), hex
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operators_customer_idx ON operators (customer_id);

-- Backfill: each existing customer's key becomes its default operator's key, so
-- current credentials keep working but now resolve to a named operator.
INSERT INTO operators (customer_id, name, api_key_hash)
SELECT id, 'default operator', api_key_hash FROM customers
ON CONFLICT (api_key_hash) DO NOTHING;
