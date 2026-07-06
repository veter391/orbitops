-- Time-series telemetry from customer ground stations.
--
-- In production this table is promoted to a TimescaleDB hypertable partitioned
-- by `ts` (see docs/BACKEND-PLAN.md — a prod-only migration runs
--   SELECT create_hypertable('telemetry', 'ts');
-- once the timescaledb extension is present). In local dev (plain Postgres /
-- pglite) it is an ordinary indexed table: identical schema and queries, just
-- without automatic partitioning. `value` is DOUBLE PRECISION — the standard,
-- fast choice for float sensor readings at hypertable scale.
CREATE TABLE IF NOT EXISTS telemetry (
  satellite_id TEXT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  subsystem    TEXT NOT NULL,
  metric       TEXT NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  unit         TEXT,
  quality      TEXT NOT NULL DEFAULT 'good'
                 CHECK (quality IN ('good', 'suspect', 'bad', 'stale'))
);

-- Primary read path: latest / ranged values for one satellite+metric.
CREATE INDEX IF NOT EXISTS telemetry_sat_metric_ts_idx
  ON telemetry (satellite_id, metric, ts DESC);

-- Secondary: global time scans (dashboards, retention).
CREATE INDEX IF NOT EXISTS telemetry_ts_idx ON telemetry (ts DESC);
