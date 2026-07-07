import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import type { Proposals, Proposal } from '../proposals/index.js';
import { llmAssess, llmEnabled } from '../agent/llm.js';
import { withSpan } from '../observability.js';
import {
  scoreCandidates,
  CONJUNCTION_KINDS,
  ANOMALY_KINDS,
  KNOWN_ACTIONS,
  type Signal,
  type Candidate,
} from './rules.js';

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
  criticOk: Annotation<boolean>,
  llmAugmented: Annotation<boolean>,
  proposal: Annotation<Proposal | null>,
});

type S = typeof AgentState.State;

/** Build the compiled agent graph bound to the Proposals service. */
export function buildAgentGraph(proposals: Proposals) {
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

  const maneuverPlanner = (state: S) => {
    const top = state.top!;
    const plan = { ...top.rule.action, satelliteId: state.satelliteId };
    return {
      plan,
      path: ['maneuverPlanner'],
      chain: [
        {
          phase: 'PLAN' as const,
          agent: 'maneuverPlanner',
          text: `Planned action "${top.rule.action.type}" for ${state.satelliteId} from hypothesis "${top.rule.hypothesis}".`,
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
    .addNode('conjunctionScreener', specialist('conjunctionScreener', 'Screening close-approach geometry.'))
    .addNode('anomalyTriager', specialist('anomalyTriager', 'Triaging telemetry anomaly pattern.'))
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
