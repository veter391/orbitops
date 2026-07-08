import type { Db } from '../db/index.js';

/** A single product-feedback submission (e.g. a pricing "should we build this?" brief). */
export interface FeedbackInput {
  kind: string;
  source?: string | null;
  tier?: string | null;
  wantsCloud?: string | null;
  fleetSize?: string | null;
  note?: string | null;
}

export interface FeedbackRow {
  id: string;
  createdAt: string;
  kind: string;
  source: string | null;
  tier: string | null;
  wantsCloud: string | null;
  fleetSize: string | null;
  note: string | null;
}

/**
 * Product feedback capture. Not tenant-scoped — it comes from anonymous
 * prospects on the public site, so there is no customer_id. Writes are public
 * (the route is rate-limited and validated); reads are authenticated.
 */
export class Feedback {
  constructor(private readonly db: Db) {}

  /** Store one submission; returns the created row. */
  async create(input: FeedbackInput): Promise<FeedbackRow> {
    const rows = await this.db.query<{
      id: string;
      created_at: string;
      kind: string;
      source: string | null;
      tier: string | null;
      wants_cloud: string | null;
      fleet_size: string | null;
      note: string | null;
    }>(
      `INSERT INTO feedback (kind, source, tier, wants_cloud, fleet_size, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, kind, source, tier, wants_cloud, fleet_size, note`,
      [
        input.kind,
        input.source ?? null,
        input.tier ?? null,
        input.wantsCloud ?? null,
        input.fleetSize ?? null,
        input.note ?? null,
      ],
    );
    return this.#map(rows[0]!);
  }

  /** Most-recent submissions first, capped by `limit`. */
  async recent(limit = 100): Promise<FeedbackRow[]> {
    const rows = await this.db.query<{
      id: string;
      created_at: string;
      kind: string;
      source: string | null;
      tier: string | null;
      wants_cloud: string | null;
      fleet_size: string | null;
      note: string | null;
    }>(
      `SELECT id, created_at, kind, source, tier, wants_cloud, fleet_size, note
       FROM feedback ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.#map(r));
  }

  #map(r: {
    id: string;
    created_at: string;
    kind: string;
    source: string | null;
    tier: string | null;
    wants_cloud: string | null;
    fleet_size: string | null;
    note: string | null;
  }): FeedbackRow {
    return {
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      kind: r.kind,
      source: r.source,
      tier: r.tier,
      wantsCloud: r.wants_cloud,
      fleetSize: r.fleet_size,
      note: r.note,
    };
  }
}
