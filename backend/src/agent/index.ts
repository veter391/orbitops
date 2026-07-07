import type { Proposals } from '../proposals/index.js';
import type { Telemetry } from '../telemetry/index.js';
import { buildAgentGraph, runAgentGraph, type CompiledAgentGraph } from '../agents/graph.js';
import type { Signal } from '../agents/rules.js';

export type { Signal } from '../agents/rules.js';
export type { ChainStep, AgentResult } from '../agents/graph.js';

export interface AgentInput {
  satelliteId: string;
  signals: Signal[];
}

/**
 * Public agent service: a stable facade over the LangGraph multi-agent core
 * (supervisor → specialist → planner → critic → drafter → pending proposal).
 * See src/agents/graph.ts for the graph itself and src/agents/rules.ts for the
 * deterministic safety core.
 */
export class Agent {
  readonly #graph: CompiledAgentGraph;

  constructor(proposals: Proposals, telemetry?: Telemetry) {
    this.#graph = buildAgentGraph(proposals, telemetry);
  }

  run(customerId: string, input: AgentInput) {
    return runAgentGraph(this.#graph, customerId, input);
  }
}
