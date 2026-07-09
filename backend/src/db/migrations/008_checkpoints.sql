-- Durable LangGraph checkpoints — the persistence layer behind native HITL.
--
-- When the agent graph runs in interruptible mode it compiles WITH a
-- BaseCheckpointSaver so that an `interrupt()` human-gate can suspend a run,
-- survive a process restart, and resume later via `Command({ resume })`. These
-- two tables ARE that saver's storage (see src/agents/checkpointer.ts).
--
-- Tenancy: rows are keyed by `thread_id`, and the route layer mints a thread as
-- `<customerId>:<uuid>` and refuses to resume a thread whose prefix does not
-- match the authenticated operator's customer. So the customer boundary is
-- carried inside `thread_id` and enforced above this table; the saver itself is
-- a generic keyed store, exactly like LangGraph's own Postgres saver.
--
-- Serialized blobs (`checkpoint`, `metadata`, `value`) are the checkpoint
-- serde's typed bytes stored as base64 TEXT — portable across pglite (dev) and
-- Postgres (prod) without a bytea/encoding split.

CREATE TABLE IF NOT EXISTS graph_checkpoints (
  thread_id            TEXT NOT NULL,
  checkpoint_ns        TEXT NOT NULL DEFAULT '',
  checkpoint_id        TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint           TEXT NOT NULL,   -- base64(serde typed bytes) of the checkpoint
  metadata             TEXT NOT NULL,   -- base64(serde typed bytes) of the metadata
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- Latest-checkpoint lookups and thread history both walk a single thread newest
-- first; checkpoint ids are monotonic (UUIDv6-style) so ordering by id is valid.
CREATE INDEX IF NOT EXISTS graph_checkpoints_thread_idx
  ON graph_checkpoints (thread_id, checkpoint_ns, checkpoint_id DESC);

CREATE TABLE IF NOT EXISTS graph_checkpoint_writes (
  thread_id     TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  idx           INTEGER NOT NULL,       -- WRITES_IDX_MAP[channel] ?? position; may be negative for special channels
  channel       TEXT NOT NULL,
  value         TEXT NOT NULL,          -- base64(serde typed bytes) of the written value
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
