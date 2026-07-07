import type { Db } from '../db/index.js';

/**
 * Agent memory: recall of prior decisions so the supervisor carries context into
 * a new run ("last time this satellite had a conjunction, the operator approved
 * a 0.3 m/s burn"). This layer is structured recall over the proposals we already
 * persist — real, deterministic, and fully offline (no embeddings, no API key).
 *
 * A semantic (pgvector) layer that finds *similar* past situations is a planned,
 * env-gated enhancement (it needs an embedding provider); the structured recall
 * here is the always-available baseline.
 */

export interface PriorDecision {
  id: string;
  ts: string;
  actionType: string;
  status: string;
  approvedBy: string | null;
}

export class AgentMemory {
  constructor(private readonly db: Db) {}

  /** Most recent prior proposals for a satellite, newest first. */
  async recall(customerId: string, satelliteId: string, limit = 5): Promise<PriorDecision[]> {
    const rows = await this.db.query<{
      id: string;
      ts: string | Date;
      proposed_action: Record<string, unknown>;
      status: string;
      approved_by: string | null;
    }>(
      `SELECT id, ts, proposed_action, status, approved_by
       FROM proposals WHERE customer_id = $1 AND satellite_id = $2
       ORDER BY ts DESC LIMIT $3`,
      [customerId, satelliteId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      actionType: String(r.proposed_action?.['type'] ?? 'unknown'),
      status: r.status,
      approvedBy: r.approved_by,
    }));
  }

  /** One-line human summary of the recall for the reasoning chain. */
  summarize(satelliteId: string, prior: PriorDecision[]): string {
    if (prior.length === 0) return `No prior proposals on record for ${satelliteId}.`;
    const last = prior[0]!;
    const decided = prior.filter((p) => p.status !== 'pending');
    const approvals = decided.filter((p) => p.status === 'approved').length;
    return (
      `${prior.length} prior proposal(s) for ${satelliteId}; most recent: ${last.actionType} (${last.status})` +
      (decided.length ? `; operator approved ${approvals}/${decided.length} decided.` : '.')
    );
  }
}
