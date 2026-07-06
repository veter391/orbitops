-- Idempotency keys: a client that retries a POST (e.g. after a flaky
-- ground-station link times out) can send the same Idempotency-Key header and
-- get the original response back instead of creating a duplicate.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  status      INT NOT NULL,
  body        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, key)
);
