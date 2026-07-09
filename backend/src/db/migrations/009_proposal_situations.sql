-- Similarity-recall store for the semantic-memory layer.
--
-- One row per proposal that has been embedded: the situation text the agent saw
-- (the signals that triggered the run) plus its vector. Retrieval reads the
-- candidate vectors for a tenant (optionally one satellite) and ranks them by
-- cosine similarity in the query layer — backend-agnostic, so it works on pglite
-- (dev) and Postgres (prod) without pgvector. On Postgres, pgvector can later
-- accelerate the SAME ranking; the stored JSON vector remains the source of truth.
--
-- Scoped by customer_id (tenant isolation) and denormalized satellite_id (the
-- common recall filter). Deleting a proposal removes its situation (CASCADE).

CREATE TABLE IF NOT EXISTS proposal_situations (
  proposal_id  UUID PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL,
  satellite_id TEXT,
  situation    TEXT NOT NULL,          -- the human-readable situation string that was embedded
  embedding    TEXT NOT NULL,          -- JSON array of floats (unit-length vector)
  embedder     TEXT NOT NULL,          -- embedder id (e.g. 'lexical-fnv1a-256') — never mix vectors across ids
  dim          INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_situations_scope_idx
  ON proposal_situations (customer_id, satellite_id);
