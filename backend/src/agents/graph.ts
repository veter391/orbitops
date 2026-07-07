import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { Proposals, Proposal } from '../proposals/index.js';
import { llmAssess, llmEnabled } from '../agent/llm.js';
import { withSpan } from '../observability.js';
import type { Telemetry } from '../telemetry/index.js';
import {
  scoreCandidates,
  RULES,
  FALLBACK_RULE,
  clamp01,
  CONJUNCTION_KINDS,
  ANOMALY_KINDS,
  KNOWN_ACTIONS,
  type Signal,
  type Candidate,
} from './rules.js';
import { probabilityOfCollision, riskBand, bandLikelihood } from './conjunction.js';
import { detectAnomaly } from './anomaly.js';
import { sizeAvoidanceBurn } from './maneuver.js';

/**
 * The multi-agent core (LangGraph): a supervisor routes each event to a
 * specialist, a planner turns the winning hypothesis into an action, a critic
 * checks it, a drafter writes the operator-facing proposal, and the persist
 * step files it as a PENDING proposal — the human-in-the-loop gate. Approval
 * happens through the audited /v1/proposals endpoints; nothing in this graph
 * ever executes an action. All scoring/planning is deterministic (rules.ts);
 * the optional LLM contributes an advisory note only.
 */

export interface ChainStep {
  phase: 'OBSERVE' | 'THINK' | 'SCORE' | 'PLAN' | 'CHECK' | 'AI' | 'PROPOSE';
  agent: string;
  text: string;
}

export interface AgentResult {
  proposal: Proposal;
  chain: ChainStep[];
  llmAugmented: boolean;
  /** Node names in execution order — the route the supervisor chose. */
  path: string[];
}

const AgentState = Annotation.Root({
  customerId: Annotation<string>,
  satelliteId: Annotation<string>,
  signals: Annotation<Signal[]>,
  chain: Annotation<ChainStep[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  path: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  route: Annotation<'conjunctionScreener' | 'anomalyTriager' | 'investigate'>,
  candidates: Annotation<Candidate[]>,
  top: Annotation<Candidate | null>,
  plan: Annotation<Record<string, unknown>>,
  /** Quantitative evidence a specialist computed (e.g. Pc, miss distance) that
   *  the planner folds into the proposal so the operator sees the "why". */
  evidence: Annotation<Record<string, unknown>>,
  criticOk: Annotation<boolean>,
  llmAugmented: Annotation<boolean>,
  proposal: Annotation<Proposal | null>,
});

type S = typeof AgentState.State;

/** Build the compiled agent graph bound to the Proposals (and optional Telemetry) service. */
export function buildAgentGraph(proposals: Proposals, telemetry?: Telemetry) {
  const supervisor = (state: S) => {
    const kinds = state.signals.map((s) => s.kind);
    const route = kinds.some((k) => CONJUNCTION_KINDS.has(k))
      ? ('conjunctionScreener' as const)
      : kinds.some((k) => ANOMALY_KINDS.has(k))
        ? ('anomalyTriager' as const)
        : ('investigate' as const);
    return {
      route,
      path: ['supervisor'],
      chain: [
        {
          phase: 'OBSERVE' as const,
          agent: 'supervisor',
          text: `Received ${state.signals.length} signal(s) for ${state.satelliteId}: ${kinds.join(', ') || 'none'}. Routing to ${route}.`,
        },
      ],
    };
  };

  /**
   * ConjunctionScreener: when close-approach geometry is present, compute a real
   * probability of collision (Pc) per event, rank by it, and band the risk —
   * deterministic, no LLM. Falls back to the severity hint if geometry is absent.
   */
  const conjunctionScreener = (state: S) => {
    const events = state.signals.filter((s) => CONJUNCTION_KINDS.has(s.kind));
    const assessed = events.map((signal) => {
      const hasGeom =
        typeof signal.missDistanceKm === 'number' &&
        typeof signal.sigmaKm === 'number' &&
        typeof signal.combinedRadiusKm === 'number';
      const pc = hasGeom
        ? probabilityOfCollision({
            missDistanceKm: signal.missDistanceKm!,
            sigmaKm: signal.sigmaKm!,
            combinedRadiusKm: signal.combinedRadiusKm!,
          })
        : null;
      return { signal, pc, band: pc === null ? null : riskBand(pc) };
    });
    // Worst first: highest Pc; events without geometry sort last.
    assessed.sort((a, b) => (b.pc ?? -1) - (a.pc ?? -1));
    const worst = assessed[0] ?? { signal: events[0] ?? state.signals[0]!, pc: null, band: null };

    const rule = RULES['conjunction']!;
    const likelihood = worst.band ? bandLikelihood(worst.band) : clamp01(worst.signal.severity ?? 0.6);
    const top: Candidate = { rule, signal: worst.signal, likelihood, score: rule.baseSeverity * likelihood };

    const evidence: Record<string, unknown> =
      worst.pc !== null
        ? {
            pc: worst.pc,
            riskBand: worst.band,
            missDistanceKm: worst.signal.missDistanceKm,
            sigmaKm: worst.signal.sigmaKm,
            combinedRadiusKm: worst.signal.combinedRadiusKm,
          }
        : {};

    const scoreText =
      worst.pc !== null
        ? `Pc = ${worst.pc.toExponential(2)} at ${worst.signal.missDistanceKm} km miss (σ=${worst.signal.sigmaKm} km, R=${worst.signal.combinedRadiusKm} km) → ${worst.band}.`
        : `No encounter geometry supplied; scored from severity hint ${likelihood.toFixed(2)}.`;

    return {
      candidates: [top],
      top,
      evidence,
      path: ['conjunctionScreener'],
      chain: [
        {
          phase: 'THINK' as const,
          agent: 'conjunctionScreener',
          text: `Screening ${events.length} close-approach event(s) for ${state.satelliteId}.`,
        },
        { phase: 'SCORE' as const, agent: 'conjunctionScreener', text: scoreText },
      ],
    };
  };

  /** Shared specialist body: score candidates, emit THINK + SCORE steps. */
  const specialist = (agent: string, framing: string) => (state: S) => {
    const candidates = scoreCandidates(state.signals);
    const top = candidates[0]!;
    return {
      candidates,
      top,
      path: [agent],
      chain: [
        {
          phase: 'THINK' as const,
          agent,
          text: `${framing} Generated ${candidates.length} candidate interpretation(s): ${candidates.map((c) => c.rule.hypothesis).join(' | ')}.`,
        },
        {
          phase: 'SCORE' as const,
          agent,
          text: `Top candidate "${top.rule.hypothesis}" scored ${top.score.toFixed(2)} (severity ${top.rule.baseSeverity} × likelihood ${top.likelihood.toFixed(2)}).`,
        },
      ],
    };
  };

  /**
   * AnomalyTriager: when a signal names a metric and carries a candidate value,
   * score it against that metric's recent telemetry history with a robust
   * modified z-score (real data, no LLM). Falls back to the severity hint when
   * there's no telemetry service or too little history.
   */
  const anomalyTriager = async (state: S) => {
    const sig = state.signals.find((s) => ANOMALY_KINDS.has(s.kind)) ?? state.signals[0]!;
    const rule = RULES[sig.kind] ?? FALLBACK_RULE;

    let likelihood = clamp01(sig.severity ?? 0.6);
    let evidence: Record<string, unknown> = {};
    let detail = `Scored "${rule.hypothesis}" from severity hint ${likelihood.toFixed(2)}.`;

    if (telemetry && sig.metric && typeof sig.value === 'number') {
      const recent = await telemetry.queryRaw({
        customerId: state.customerId,
        satelliteId: state.satelliteId,
        metric: sig.metric,
        limit: 200,
      });
      const a = detectAnomaly(
        sig.value,
        recent.map((r) => r.value),
      );
      if (a.n >= 3) {
        likelihood = clamp01(0.4 + a.severity * 0.6);
        evidence = {
          metric: sig.metric,
          value: sig.value,
          zscore: a.zscore,
          baselineMedian: a.median,
          mad: a.mad,
          baselineN: a.n,
          isAnomaly: a.isAnomaly,
        };
        detail = `${sig.metric}=${sig.value} vs baseline median ${a.median.toFixed(2)} (MAD ${a.mad.toFixed(3)}, n=${a.n}) → z=${a.zscore.toFixed(1)}${a.isAnomaly ? ' — ANOMALY' : ' — nominal'}.`;
      } else {
        detail = `Only ${a.n} baseline sample(s) for ${sig.metric}; scored from severity hint ${likelihood.toFixed(2)}.`;
      }
    }

    const top: Candidate = { rule, signal: sig, likelihood, score: rule.baseSeverity * likelihood };
    return {
      candidates: [top],
      top,
      evidence,
      path: ['anomalyTriager'],
      chain: [
        {
          phase: 'THINK' as const,
          agent: 'anomalyTriager',
          text: `Triaging telemetry anomaly for ${state.satelliteId}.`,
        },
        { phase: 'SCORE' as const, agent: 'anomalyTriager', text: detail },
      ],
    };
  };

  const maneuverPlanner = (state: S) => {
    const top = state.top!;
    // Fold any quantitative evidence (Pc, miss distance, …) into the action so
    // the operator sees the numbers behind the recommendation.
    const evidence = state.evidence ?? {};
    const plan: Record<string, unknown> = { ...top.rule.action, satelliteId: state.satelliteId, ...evidence };

    let burnNote = '';
    // Size a real avoidance burn when this is a maneuver with encounter geometry.
    if (plan['type'] === 'maneuver' && typeof plan['missDistanceKm'] === 'number' && typeof top.signal.timeToTcaSec === 'number') {
      const burn = sizeAvoidanceBurn({
        currentMissKm: plan['missDistanceKm'] as number,
        timeToTcaSec: top.signal.timeToTcaSec,
        ...(top.signal.satMassKg != null ? { satMassKg: top.signal.satMassKg } : {}),
        ...(top.signal.ispSec != null ? { ispSec: top.signal.ispSec } : {}),
      });
      plan['deltaVMs'] = burn.deltaVMs;
      plan['propellantKg'] = burn.propellantKg;
      plan['targetMissKm'] = burn.targetMissKm;
      plan['burnMethod'] = burn.method;
      burnNote = ` Sized avoidance burn: Δv ${burn.deltaVMs.toFixed(3)} m/s, ${burn.propellantKg.toFixed(3)} kg propellant to reach ${burn.targetMissKm.toFixed(2)} km miss.`;
    }

    const pcNote =
      typeof evidence['pc'] === 'number'
        ? ` (Pc ${(evidence['pc'] as number).toExponential(2)}, ${String(evidence['riskBand'])})`
        : '';
    return {
      plan,
      path: ['maneuverPlanner'],
      chain: [
        {
          phase: 'PLAN' as const,
          agent: 'maneuverPlanner',
          text: `Planned action "${top.rule.action.type}" for ${state.satelliteId} from hypothesis "${top.rule.hypothesis}"${pcNote}.${burnNote}`,
        },
      ],
    };
  };

  const complianceChecker = async (state: S) => {
    const type = String(state.plan['type'] ?? '');
    const ok = KNOWN_ACTIONS.has(type);
    const chain: ChainStep[] = [
      {
        phase: 'CHECK',
        agent: 'complianceChecker',
        text: ok
          ? `Action "${type}" is a known playbook; no compliance objections. Requires operator approval before execution.`
          : `Action "${type}" is not a recognized playbook — downgrading to investigate.`,
      },
    ];

    let llmAugmented = false;
    if (llmEnabled()) {
      const note = await llmAssess(
        `Satellite ${state.satelliteId}. Signals: ${JSON.stringify(state.signals)}. ` +
          `Hypothesis: ${state.top?.rule.hypothesis}. In two sentences, state the main risk ` +
          `and one thing the operator should double-check before approving "${type}".`,
      );
      if (note) {
        chain.push({ phase: 'AI', agent: 'complianceChecker', text: note });
        llmAugmented = true;
      }
    }

    return {
      criticOk: ok,
      llmAugmented,
      plan: ok ? state.plan : { type: 'investigate', satelliteId: state.satelliteId },
      path: ['complianceChecker'],
      chain,
    };
  };

  const proposalDrafter = (state: S) => ({
    path: ['proposalDrafter'],
    chain: [
      {
        phase: 'PROPOSE' as const,
        agent: 'proposalDrafter',
        text: `Recommend action: ${String(state.plan['type'])}. Awaiting operator approval.`,
      },
    ],
  });

  const persist = async (state: S) => {
    const proposal = await proposals.create(state.customerId, {
      satelliteId: state.satelliteId,
      reasoningChain: state.chain,
      proposedAction: state.plan,
    });
    return { proposal, path: ['persist'] };
  };

  return new StateGraph(AgentState)
    .addNode('supervisor', supervisor)
    .addNode('conjunctionScreener', conjunctionScreener)
    .addNode('anomalyTriager', anomalyTriager)
    .addNode('investigate', specialist('investigate', 'No specialist matched; general review.'))
    .addNode('maneuverPlanner', maneuverPlanner)
    .addNode('complianceChecker', complianceChecker)
    .addNode('proposalDrafter', proposalDrafter)
    .addNode('persist', persist)
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', (s: S) => s.route, [
      'conjunctionScreener',
      'anomalyTriager',
      'investigate',
    ])
    .addEdge('conjunctionScreener', 'maneuverPlanner')
    .addEdge('anomalyTriager', 'maneuverPlanner')
    .addEdge('investigate', 'maneuverPlanner')
    .addEdge('maneuverPlanner', 'complianceChecker')
    .addEdge('complianceChecker', 'proposalDrafter')
    .addEdge('proposalDrafter', 'persist')
    .addEdge('persist', END)
    // Compiled WITHOUT a checkpointer on purpose: every run is single-shot
    // (START → … → END) and nothing ever resumes a thread, so an in-memory
    // checkpointer would only accumulate per-run state forever (a leak under
    // load). A durable Postgres checkpointer arrives with B3's HITL interrupt,
    // where pausing/resuming mid-graph actually needs saved state.
    .compile();
}

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;

/** Execute one single-shot run through the graph. */
export async function runAgentGraph(
  graph: CompiledAgentGraph,
  customerId: string,
  input: { satelliteId: string; signals: Signal[] },
): Promise<AgentResult> {
  return withSpan(
    'agent.graph.run',
    { 'orbitops.satellite_id': input.satelliteId, 'orbitops.signals': input.signals.length },
    async () => {
      const final = await graph.invoke({
        customerId,
        satelliteId: input.satelliteId,
        signals: input.signals,
        top: null,
        plan: {},
        evidence: {},
        criticOk: false,
        llmAugmented: false,
        proposal: null,
      });
      if (!final.proposal) throw new Error('agent graph finished without a proposal');
      return {
        proposal: final.proposal,
        chain: final.chain,
        llmAugmented: final.llmAugmented,
        path: final.path,
      };
    },
  );
}
