import type { Db } from '../db/index.js';
import { cosine, type Embedder } from './embedder.js';

/**
 * Agent memory: recall of prior decisions so the supervisor carries context into
 * a new run ("last time this satellite had a conjunction, the operator approved
 * a 0.3 m/s burn"). The always-available baseline is structured recall over the
 * proposals we already persist — real, deterministic, and fully offline (no
 * embeddings, no API key).
 *
 * When an {@link Embedder} is injected, a SIMILARITY layer is also active: each
 * proposal's "situation" (the signals that triggered it) is embedded and stored
 * (proposal_situations), and `recallSimilar` finds past situations close to the
 * current one by cosine similarity — backend-agnostic, no pgvector required (see
 * migration 009). Without an embedder the class behaves exactly as before.
 */

export interface PriorDecision {
  id: string;
  ts: string;
  actionType: string;
  status: string;
  approvedBy: string | null;
}

export interface SimilarSituation {
  proposalId: string;
  satelliteId: string | null;
  situation: string;
  actionType: string;
  status: string;
  similarity: number;
}

export class AgentMemory {
  constructor(
    private readonly db: Db,
    private readonly embedder?: Embedder,
  ) {}

  /** True when a similarity (semantic) layer is active. */
  get semanticEnabled(): boolean {
    return this.embedder !== undefined;
  }

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

  /**
   * Embed and store the situation behind a proposal so future runs can recall it
   * by similarity. No-op when no embedder is configured. Best-effort: a storage
   * failure must never break proposal creation, so callers may ignore rejections.
   */
  async remember(input: {
    proposalId: string;
    customerId: string;
    satelliteId: string | null;
    situation: string;
  }): Promise<void> {
    if (!this.embedder) return;
    const vec = await this.embedder.embed(input.situation);
    await this.db.query(
      `INSERT INTO proposal_situations
         (proposal_id, customer_id, satellite_id, situation, embedding, embedder, dim)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (proposal_id) DO UPDATE SET
         situation = EXCLUDED.situation, embedding = EXCLUDED.embedding,
         embedder = EXCLUDED.embedder, dim = EXCLUDED.dim`,
      [
        input.proposalId,
        input.customerId,
        input.satelliteId,
        input.situation,
        JSON.stringify(vec),
        this.embedder.id,
        this.embedder.dim,
      ],
    );
  }

  /**
   * Find past situations most similar to `situation` for this tenant, ranked by
   * cosine similarity. Returns [] when no embedder is configured. Only vectors
   * from the SAME embedder id are comparable, so the query filters on it.
   */
  async recallSimilar(
    customerId: string,
    situation: string,
    opts: {
      satelliteId?: string;
      k?: number;
      minSimilarity?: number;
      excludeProposalId?: string;
      candidateCap?: number;
    } = {},
  ): Promise<SimilarSituation[]> {
    if (!this.embedder) return [];
    const { satelliteId, k = 3, minSimilarity = 0.1, excludeProposalId, candidateCap = 500 } = opts;
    const query = await this.embedder.embed(situation);

    const params: unknown[] = [customerId, this.embedder.id];
    let sql =
      `SELECT s.proposal_id, s.satellite_id, s.situation, s.embedding, p.proposed_action, p.status
       FROM proposal_situations s JOIN proposals p ON p.id = s.proposal_id
       WHERE s.customer_id = $1 AND s.embedder = $2`;
    if (satelliteId !== undefined) {
      params.push(satelliteId);
      sql += ` AND s.satellite_id = $${params.length}`;
    }
    if (excludeProposalId !== undefined) {
      params.push(excludeProposalId);
      sql += ` AND s.proposal_id <> $${params.length}`;
    }
    // Bound the work: rank only the most-recent `candidateCap` situations in JS,
    // so cost is fixed regardless of how large a tenant's history grows. (Prod
    // can push the ranking into pgvector as the module docstring anticipates.)
    params.push(candidateCap);
    sql += ` ORDER BY s.created_at DESC LIMIT $${params.length}`;

    const rows = await this.db.query<{
      proposal_id: string;
      satellite_id: string | null;
      situation: string;
      embedding: string;
      proposed_action: Record<string, unknown>;
      status: string;
    }>(sql, params);

    return rows
      .map((r) => ({
        proposalId: r.proposal_id,
        satelliteId: r.satellite_id,
        situation: r.situation,
        actionType: String(r.proposed_action?.['type'] ?? 'unknown'),
        status: r.status,
        similarity: cosine(query, safeParseVector(r.embedding)),
      }))
      .filter((m) => m.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
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

  /** One-line summary of a similarity recall for the reasoning chain. */
  summarizeSimilar(matches: SimilarSituation[]): string {
    if (matches.length === 0) return 'No similar past situations found.';
    const top = matches[0]!;
    return (
      `${matches.length} similar past situation(s); closest (${(top.similarity * 100).toFixed(0)}% match): ` +
      `${top.actionType} (${top.status}) on ${top.satelliteId ?? 'unknown'}.`
    );
  }
}

/** Parse a stored JSON vector defensively; a malformed row contributes nothing. */
function safeParseVector(s: string): number[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.every((n) => typeof n === 'number') ? (v as number[]) : [];
  } catch {
    return [];
  }
}
