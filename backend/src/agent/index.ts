import type { Proposals, Proposal } from '../proposals/index.js';
import { llmAssess, llmEnabled } from './llm.js';
import { withSpan } from '../observability.js';

export interface Signal {
  kind: string;
  detail?: string;
  metric?: string;
  value?: number;
  /** Caller's likelihood/confidence hint, 0..1. */
  severity?: number;
}

export interface AgentInput {
  satelliteId: string;
  signals: Signal[];
}

export interface ChainStep {
  phase: 'OBSERVE' | 'THINK' | 'SCORE' | 'AI' | 'PROPOSE';
  text: string;
}

export interface AgentResult {
  proposal: Proposal;
  chain: ChainStep[];
  llmAugmented: boolean;
}

interface Rule {
  hypothesis: string;
  action: { type: string; params?: Record<string, unknown> };
  baseSeverity: number; // 0..1
}

/** Signal kind → working hypothesis + recommended action. */
const RULES: Record<string, Rule> = {
  conjunction: {
    hypothesis: 'Predicted close approach below safe miss distance',
    action: { type: 'maneuver', params: { profile: 'avoidance_burn' } },
    baseSeverity: 0.9,
  },
  battery_degradation: {
    hypothesis: 'Battery capacity fading faster than model',
    action: { type: 'load_shed', params: { profile: 'conserve' } },
    baseSeverity: 0.7,
  },
  thermal_anomaly: {
    hypothesis: 'Subsystem temperature outside safe envelope',
    action: { type: 'thermal_mitigation', params: { profile: 'reorient_radiators' } },
    baseSeverity: 0.75,
  },
  attitude_drift: {
    hypothesis: 'Attitude drifting beyond the pointing budget',
    action: { type: 'attitude_correction', params: { profile: 'wheel_desaturation' } },
    baseSeverity: 0.6,
  },
  comms_degradation: {
    hypothesis: 'Downlink margin degrading',
    action: { type: 'link_handoff', params: { profile: 'switch_ground_station' } },
    baseSeverity: 0.55,
  },
};

const FALLBACK_RULE: Rule = {
  hypothesis: 'Unclassified anomaly requires operator review',
  action: { type: 'investigate' },
  baseSeverity: 0.4,
};

/**
 * The agent loop (ReAct): observe → think → score → propose → wait. The
 * reasoning chain is the product; the LLM (if configured) only augments the
 * "think" step with an advisory note and never changes the chosen action. The
 * loop is fully deterministic and offline-capable without an LLM key.
 */
export class Agent {
  constructor(private readonly proposals: Proposals) {}

  run(customerId: string, input: AgentInput): Promise<AgentResult> {
    return withSpan(
      'agent.run',
      { 'orbitops.satellite_id': input.satelliteId, 'orbitops.signals': input.signals.length },
      () => this.#run(customerId, input),
    );
  }

  async #run(customerId: string, input: AgentInput): Promise<AgentResult> {
    const chain: ChainStep[] = [];

    // 1. OBSERVE
    const kinds = input.signals.map((s) => s.kind).join(', ') || 'none';
    chain.push({
      phase: 'OBSERVE',
      text: `Received ${input.signals.length} signal(s) for ${input.satelliteId}: ${kinds}.`,
    });

    // 2. THINK — deterministic candidate generation
    const observed = input.signals.length ? input.signals : [{ kind: 'unknown' } as Signal];
    const candidates = observed.map((sig) => {
      const rule = RULES[sig.kind] ?? FALLBACK_RULE;
      const likelihood = clamp01(sig.severity ?? 0.6);
      return { rule, likelihood, score: rule.baseSeverity * likelihood };
    });
    chain.push({
      phase: 'THINK',
      text: `Generated ${candidates.length} candidate interpretation(s): ${candidates
        .map((c) => c.rule.hypothesis)
        .join(' | ')}.`,
    });

    // 3. SCORE — highest score wins; V8's stable sort keeps first-listed on ties
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0]!;
    chain.push({
      phase: 'SCORE',
      text: `Top candidate "${top.rule.hypothesis}" scored ${top.score.toFixed(2)} (severity ${top.rule.baseSeverity} × likelihood ${top.likelihood.toFixed(2)}).`,
    });

    // Optional LLM augmentation — advisory only, never changes the action.
    let llmAugmented = false;
    if (llmEnabled()) {
      const note = await llmAssess(assessPrompt(input, top.rule));
      if (note) {
        chain.push({ phase: 'AI', text: note });
        llmAugmented = true;
      }
    }

    // 4. PROPOSE
    const proposedAction = { ...top.rule.action, satelliteId: input.satelliteId };
    chain.push({
      phase: 'PROPOSE',
      text: `Recommend action: ${top.rule.action.type}. Awaiting operator approval.`,
    });

    // 5. WAIT — persist as a pending proposal (audited + published downstream)
    const proposal = await this.proposals.create(customerId, {
      satelliteId: input.satelliteId,
      reasoningChain: chain,
      proposedAction,
    });

    return { proposal, chain, llmAugmented };
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
}

function assessPrompt(input: AgentInput, rule: Rule): string {
  return (
    `Satellite ${input.satelliteId}. Signals: ${JSON.stringify(input.signals)}. ` +
    `Working hypothesis: ${rule.hypothesis}. In two sentences, state the main risk ` +
    `and one thing the operator should double-check before approving "${rule.action.type}".`
  );
}
