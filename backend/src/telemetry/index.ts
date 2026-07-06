import type { Db } from '../db/index.js';
import type { EventBus } from '../events/index.js';

export type Quality = 'good' | 'suspect' | 'bad' | 'stale';

export interface Reading {
  satelliteId: string;
  ts?: string; // ISO-8601; defaults to ingest time if omitted
  subsystem: string;
  metric: string;
  value: number;
  unit?: string | null;
  quality?: Quality;
}

export interface TelemetryPoint {
  satelliteId: string;
  ts: string;
  subsystem: string;
  metric: string;
  value: number;
  unit: string | null;
  quality: string;
}

export interface BucketPoint {
  bucket: string; // ISO-8601 bucket start
  value: number;
  n: number;
}

export type Agg = 'avg' | 'min' | 'max' | 'last';

const COLS = 8; // customer_id + 7 reading columns
/** Cap per request so a bulk insert stays well under Postgres' 65535 bind-param limit. */
export const MAX_BATCH = 5000;

/**
 * Telemetry ingest + read. The schema is production-shaped (promoted to a
 * TimescaleDB hypertable in prod); every query here is plain, portable SQL that
 * behaves identically on local pglite. Ingest is high-volume machine data, so it
 * is deliberately NOT written to the audit log — that chain records human/AI
 * decisions, not sensor readings.
 */
export class Telemetry {
  constructor(
    private readonly db: Db,
    private readonly bus?: EventBus,
  ) {}

  /** Bulk-insert a batch of readings for one tenant. Returns the number stored. */
  async ingest(customerId: string, readings: Reading[]): Promise<number> {
    if (readings.length === 0) return 0;
    if (readings.length > MAX_BATCH) {
      throw new RangeError(`batch too large: ${readings.length} > ${MAX_BATCH}`);
    }
    const nowIso = new Date().toISOString();
    const params: unknown[] = [];
    const tuples = readings.map((r, i) => {
      const b = i * COLS;
      params.push(
        customerId,
        r.satelliteId,
        r.ts ?? nowIso,
        r.subsystem,
        r.metric,
        r.value,
        r.unit ?? null,
        r.quality ?? 'good',
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
    });
    await this.db.query(
      `INSERT INTO telemetry (customer_id, satellite_id, ts, subsystem, metric, value, unit, quality)
       VALUES ${tuples.join(', ')}`,
      params,
    );
    this.#publish(customerId, readings);
    return readings.length;
  }

  /** Emit one telemetry event per distinct satellite in the batch. */
  #publish(customerId: string, readings: Reading[]): void {
    if (!this.bus) return;
    const bySat = new Map<string, Set<string>>();
    for (const r of readings) {
      const set = bySat.get(r.satelliteId) ?? new Set<string>();
      set.add(r.metric);
      bySat.set(r.satelliteId, set);
    }
    for (const [satelliteId, metrics] of bySat) {
      const count = readings.reduce((n, r) => n + (r.satelliteId === satelliteId ? 1 : 0), 0);
      this.bus.emit('telemetry', { customerId, satelliteId, count, metrics: [...metrics] });
    }
  }

  /** Raw readings for one satellite, newest first, optionally filtered. */
  async queryRaw(spec: {
    customerId: string;
    satelliteId: string;
    metric?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<TelemetryPoint[]> {
    const { whereSql, params } = buildWhere(spec);
    params.push(spec.limit ?? 500);
    const rows = await this.db.query<Row>(
      `SELECT satellite_id, ts, subsystem, metric, value, unit, quality
       FROM telemetry WHERE ${whereSql}
       ORDER BY ts DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toPoint);
  }

  /**
   * Downsampled series: values aggregated into fixed-width time buckets.
   * `time_bucket` is emulated portably by flooring epoch seconds to the bucket
   * boundary, so it runs on plain pglite as well as a Timescale hypertable.
   */
  async queryBucketed(spec: {
    customerId: string;
    satelliteId: string;
    metric?: string;
    from?: string;
    to?: string;
    bucketSeconds: number;
    agg?: Agg;
    limit?: number;
  }): Promise<BucketPoint[]> {
    const bs = Math.floor(spec.bucketSeconds);
    if (!Number.isInteger(bs) || bs <= 0) throw new RangeError('bucketSeconds must be a positive integer');
    const agg: Agg = spec.agg ?? 'avg';
    const aggExpr =
      agg === 'last' ? '(array_agg(value ORDER BY ts DESC))[1]' : `${agg}(value)`;
    // bs is a validated integer, safe to inline; all user text goes via params.
    const bucketExpr = `to_timestamp(floor(extract(epoch from ts) / ${bs}) * ${bs})`;
    const { whereSql, params } = buildWhere(spec);
    params.push(spec.limit ?? 1000);
    const rows = await this.db.query<{ bucket: string | Date; value: number; n: string | number }>(
      `SELECT ${bucketExpr} AS bucket, ${aggExpr} AS value, count(*) AS n
       FROM telemetry WHERE ${whereSql}
       GROUP BY bucket ORDER BY bucket DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      bucket: r.bucket instanceof Date ? r.bucket.toISOString() : String(r.bucket),
      value: Number(r.value),
      n: Number(r.n),
    }));
  }

  /** The newest reading for each metric of one satellite (dashboard snapshot). */
  async latestPerMetric(customerId: string, satelliteId: string): Promise<TelemetryPoint[]> {
    const rows = await this.db.query<Row>(
      `SELECT DISTINCT ON (metric) satellite_id, ts, subsystem, metric, value, unit, quality
       FROM telemetry WHERE customer_id = $1 AND satellite_id = $2
       ORDER BY metric, ts DESC`,
      [customerId, satelliteId],
    );
    return rows.map(toPoint);
  }
}

interface Row {
  satellite_id: string;
  ts: string | Date;
  subsystem: string;
  metric: string;
  value: number;
  unit: string | null;
  quality: string;
}

function toPoint(r: Row): TelemetryPoint {
  return {
    satelliteId: r.satellite_id,
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    subsystem: r.subsystem,
    metric: r.metric,
    value: Number(r.value),
    unit: r.unit,
    quality: r.quality,
  };
}

/** Shared WHERE builder — tenant + satellite required, the rest optional. */
function buildWhere(spec: {
  customerId: string;
  satelliteId: string;
  metric?: string;
  from?: string;
  to?: string;
}): { whereSql: string; params: unknown[] } {
  const where = ['customer_id = $1', 'satellite_id = $2'];
  const params: unknown[] = [spec.customerId, spec.satelliteId];
  if (spec.metric) {
    params.push(spec.metric);
    where.push(`metric = $${params.length}`);
  }
  if (spec.from) {
    params.push(spec.from);
    where.push(`ts >= $${params.length}`);
  }
  if (spec.to) {
    params.push(spec.to);
    where.push(`ts <= $${params.length}`);
  }
  return { whereSql: where.join(' AND '), params };
}
