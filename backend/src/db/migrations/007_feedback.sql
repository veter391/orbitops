-- Product feedback captured from the public site (e.g. the pricing page's
-- "should we build this tier?" brief). This is NOT tenant data — it comes from
-- anonymous prospects who have no operator account — so it is deliberately not
-- customer-scoped. Writes are public (rate-limited); reads require auth.
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,           -- category, e.g. 'pricing'
  source      TEXT,                    -- where it came from, e.g. 'pricing-page'
  tier        TEXT,                    -- Pilot / Growth / Mega / Any
  wants_cloud TEXT,                    -- Yes, hosted / Self-host only / Not sure
  fleet_size  TEXT,                    -- free text, optional
  note        TEXT                     -- free text, optional
);

CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
