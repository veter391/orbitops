import type { Db } from '../db/index.js';
import type { AuditLog } from '../audit/index.js';
import type { EventBus, ProposalEvent } from '../events/index.js';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'modified';

export interface Proposal {
  id: string;
  satelliteId: string | null;
  ts: string;
  reasoningChain: unknown[];
  proposedAction: Record<string, unknown>;
  status: ProposalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
}

/** Thrown when a proposal id does not exist; routes map it to 404. */
export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown proposal: ${id}`);
    this.name = 'NotFoundError';
  }
}

/**
 * Proposal lifecycle, server-authoritative. Every decision is guarded against
 * a non-pending state *atomically in SQL* (`WHERE status = 'pending'`), so two
 * concurrent approvals — or an approve racing a reject — cannot both win or
 * double-write the audit log. A decision on an already-terminal proposal is a
 * no-op that returns the current row (mirrors the frontend's guard semantics).
 */
export class Proposals {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    private readonly bus?: EventBus,
  ) {}

  async create(input: {
    satelliteId?: string | null;
    reasoningChain?: unknown[];
    proposedAction?: Record<string, unknown>;
  }): Promise<Proposal> {
    const rows = await this.db.query<ProposalRow>(
      `INSERT INTO proposals (satellite_id, reasoning_chain, proposed_action)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING *`,
      [
        input.satelliteId ?? null,
        JSON.stringify(input.reasoningChain ?? []),
        JSON.stringify(input.proposedAction ?? {}),
      ],
    );
    const p = toProposal(rows[0]!);
    await this.audit.append('ai:agent', 'proposal.created', {
      proposalId: p.id,
      satelliteId: p.satelliteId,
    });
    this.#publish('created', p);
    return p;
  }

  async get(id: string): Promise<Proposal | null> {
    const rows = await this.db.query<ProposalRow>('SELECT * FROM proposals WHERE id = $1', [id]);
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async list(limit = 50): Promise<Proposal[]> {
    const rows = await this.db.query<ProposalRow>(
      'SELECT * FROM proposals ORDER BY ts DESC LIMIT $1',
      [limit],
    );
    return rows.map(toProposal);
  }

  approve(id: string, operator: string): Promise<Proposal> {
    return this.#decide(
      id,
      `UPDATE proposals SET status = 'approved', approved_by = $2, approved_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, operator],
      'proposal.approved',
      { proposalId: id, operator },
    );
  }

  reject(id: string, operator: string, reason = ''): Promise<Proposal> {
    return this.#decide(
      id,
      `UPDATE proposals SET status = 'rejected', approved_by = $2, approved_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, operator],
      'proposal.rejected',
      { proposalId: id, operator, reason },
    );
  }

  modify(id: string, operator: string, modifications: Record<string, unknown>): Promise<Proposal> {
    return this.#decide(
      id,
      `UPDATE proposals SET status = 'modified', approved_by = $2, approved_at = now(),
              proposed_action = proposed_action || $3::jsonb
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, operator, JSON.stringify(modifications)],
      'proposal.modified',
      { proposalId: id, operator, modifications },
    );
  }

  /**
   * Apply a guarded transition. If the conditional UPDATE touches no row, the
   * proposal is either missing (→ NotFoundError) or already terminal (→ current
   * row, no audit entry).
   */
  async #decide(
    id: string,
    sql: string,
    params: unknown[],
    action: string,
    payload: Record<string, unknown>,
  ): Promise<Proposal> {
    const rows = await this.db.query<ProposalRow>(sql, params);
    if (rows[0]) {
      await this.audit.append(`user:${payload['operator'] as string}`, action, payload);
      const p = toProposal(rows[0]);
      this.#publish(action.replace('proposal.', '') as ProposalEvent['type'], p);
      return p;
    }
    const current = await this.get(id);
    if (!current) throw new NotFoundError(id);
    return current; // already decided — no-op
  }

  #publish(type: ProposalEvent['type'], p: Proposal): void {
    this.bus?.emit('proposal', {
      type,
      proposal: { id: p.id, satelliteId: p.satelliteId, status: p.status },
    });
  }
}

interface ProposalRow {
  id: string;
  satellite_id: string | null;
  ts: string | Date;
  reasoning_chain: unknown[];
  proposed_action: Record<string, unknown>;
  status: ProposalStatus;
  approved_by: string | null;
  approved_at: string | Date | null;
  executed_at: string | Date | null;
}

function toIso(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    satelliteId: r.satellite_id,
    ts: toIso(r.ts) ?? '',
    reasoningChain: r.reasoning_chain,
    proposedAction: r.proposed_action,
    status: r.status,
    approvedBy: r.approved_by,
    approvedAt: toIso(r.approved_at),
    executedAt: toIso(r.executed_at),
  };
}
