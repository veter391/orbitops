import type { Db } from '../db/index.js';
import { entryInput, signEntry, hashesEqual, GENESIS_HASH } from './hash.js';

/** Minimal logger surface (Fastify's `app.log` satisfies it). */
interface Logger {
  error(obj: unknown, msg?: string): void;
}

export interface AuditEntry {
  seq: number;
  ts: string; // ISO-8601
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export type VerifyResult =
  | { valid: true; entries: number }
  | { valid: false; brokenAt: number; reason: string };

/**
 * Server-authoritative, HMAC-signed, append-only audit log.
 *
 * Appends are serialized through an in-process promise chain so that reading the
 * previous hash, computing the new one, and inserting happen atomically relative
 * to other appends — the single-process backend can otherwise interleave them
 * and fork the chain (the same race that was fixed on the frontend).
 */
export class AuditLog {
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly log?: Logger,
  ) {}

  /** Append one entry to a tenant's chain. Serialized; returns the persisted entry. */
  append(
    customerId: string,
    actor: string,
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<AuditEntry> {
    const run = this.#tail.then(() => this.#appendOne(customerId, actor, action, payload));
    // Keep the queue alive even if one append rejects — and surface the failure
    // in server logs (otherwise it's only visible to the awaiting caller).
    this.#tail = run.catch((err) => {
      this.log?.error({ err, customerId, action }, 'audit append failed');
    });
    return run;
  }

  async #appendOne(
    customerId: string,
    actor: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<AuditEntry> {
    // Serialize per-tenant at the DATABASE level, not just in-process: a
    // transaction-scoped advisory lock keyed by customer means two backend
    // processes (or pooled connections) can't both read the same last seq and
    // fork the chain. The in-process #tail still prevents concurrent transactions
    // on a single (pglite) connection.
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [customerId]);
      const last = await tx.query<{ seq: string | number; hash: string }>(
        'SELECT seq, hash FROM audit_log WHERE customer_id = $1 ORDER BY seq DESC LIMIT 1',
        [customerId],
      );
      const prev = last[0];
      const seq = prev ? Number(prev.seq) + 1 : 0;
      const prevHash = prev ? prev.hash : GENESIS_HASH;
      const now = new Date();
      const tsMs = now.getTime();
      const ts = now.toISOString();
      const hash = signEntry(entryInput({ prevHash, seq, tsMs, actor, action, payload }));

      await tx.query(
        `INSERT INTO audit_log (customer_id, seq, ts, actor, action, payload, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [customerId, seq, ts, actor, action, JSON.stringify(payload), prevHash, hash],
      );
      return { seq, ts, actor, action, payload, prevHash, hash };
    });
  }

  /** Most recent entries for a tenant, newest first. */
  async recent(customerId: string, limit = 50): Promise<AuditEntry[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT seq, ts, actor, action, payload, prev_hash, hash
       FROM audit_log WHERE customer_id = $1 ORDER BY seq DESC LIMIT $2`,
      [customerId, limit],
    );
    return rows.map(toEntry);
  }

  /** Entry count for a tenant. */
  async count(customerId: string): Promise<number> {
    const rows = await this.db.query<{ n: string | number }>(
      'SELECT COUNT(*) AS n FROM audit_log WHERE customer_id = $1',
      [customerId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Re-derive every entry's HMAC and confirm each links to its predecessor,
   * within one tenant's chain. Detects any tampered field, reordering, or
   * broken linkage.
   */
  async verify(customerId: string): Promise<VerifyResult> {
    const rows = await this.db.query<VerifyRow>(
      `SELECT seq, (EXTRACT(EPOCH FROM ts) * 1000)::bigint AS ts_ms,
              actor, action, payload, prev_hash, hash
       FROM audit_log WHERE customer_id = $1 ORDER BY seq ASC`,
      [customerId],
    );
    let prevHash = GENESIS_HASH;
    let expectedSeq = 0;
    for (const r of rows) {
      const seq = Number(r.seq);
      if (seq !== expectedSeq) return { valid: false, brokenAt: seq, reason: 'sequence gap' };
      if (r.prev_hash !== prevHash) return { valid: false, brokenAt: seq, reason: 'prevHash mismatch' };
      const expected = signEntry(
        entryInput({
          prevHash: r.prev_hash,
          seq,
          tsMs: Number(r.ts_ms),
          actor: r.actor,
          action: r.action,
          payload: r.payload,
        }),
      );
      if (!hashesEqual(expected, r.hash)) return { valid: false, brokenAt: seq, reason: 'hash mismatch' };
      prevHash = r.hash;
      expectedSeq += 1;
    }
    return { valid: true, entries: rows.length };
  }

  /** A tenant's full chain oldest-first, for export. */
  async all(customerId: string): Promise<AuditEntry[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT seq, ts, actor, action, payload, prev_hash, hash
       FROM audit_log WHERE customer_id = $1 ORDER BY seq ASC`,
      [customerId],
    );
    return rows.map(toEntry);
  }

  /** Export a tenant's whole chain as a pretty JSON decision pack. */
  async exportJson(customerId: string): Promise<string> {
    return JSON.stringify(await this.all(customerId), null, 2);
  }

  /** Export a tenant's whole chain as CSV (payload JSON-encoded in one column). */
  async exportCsv(customerId: string): Promise<string> {
    const rows = await this.all(customerId);
    const head = 'seq,ts,actor,action,payload,prev_hash,hash';
    const lines = rows.map((e) =>
      [e.seq, e.ts, e.actor, e.action, JSON.stringify(e.payload), e.prevHash, e.hash]
        .map(csvCell)
        .join(','),
    );
    return [head, ...lines].join('\n');
  }
}

interface AuditRow {
  seq: string | number;
  ts: string | Date;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

interface VerifyRow {
  seq: string | number;
  ts_ms: string | number;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

function toEntry(r: AuditRow): AuditEntry {
  return {
    seq: Number(r.seq),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    actor: r.actor,
    action: r.action,
    payload: r.payload,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

/** RFC-4180-ish CSV escaping. */
function csvCell(v: unknown): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
