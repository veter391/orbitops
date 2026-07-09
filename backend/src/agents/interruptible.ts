// Native blocking HITL on the durable checkpointer.
//
// The main agent graph (graph.ts) is deliberately NON-blocking: it files a
// PENDING proposal and returns, and the human decides later through the audited
// /v1/proposals endpoints. That is the right shape for a fleet console that must
// keep triaging while a human deliberates.
//
// This module adds the OTHER human-in-the-loop shape LangGraph supports: a graph
// that BLOCKS mid-run at a human gate, durably suspends (via DbCheckpointSaver),
// and resumes only when an operator supplies a decision. The concrete workflow
// is a four-eyes execution confirmation — before an approved action is handed
// toward uplink, a SECOND operator must explicitly confirm. Nothing here ever
// actuates hardware; the graph records the human go/no-go and stops. It is the
// reusable interrupt/resume primitive, proven durable across a process restart
// (see test/interruptible.test.ts), that a concrete execution surface can adopt.

import { randomUUID } from 'node:crypto';
import { StateGraph, Annotation, START, END, interrupt, Command, isInterrupted, INTERRUPT } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

// --- Tenant ownership of durable threads -----------------------------------
//
// DbCheckpointSaver is a generic keyed store: LangGraph drives it with whatever
// thread_id is in the run config, so the saver cannot self-enforce tenancy. The
// boundary is therefore enforced HERE, at the only entry points that mint and
// resume threads, and these two helpers make it code (not a comment): a thread
// id is `<customerId>:<uuid>`, and a resume must prove the caller owns it.

/** Mint a durable thread id owned by `customerId`. Callers must not hand-build ids. */
export function mintThreadId(customerId: string): string {
  return `${customerId}:${randomUUID()}`;
}

/** Throw unless `threadId` was minted for `customerId`. Called before every resume. */
export function assertThreadOwnership(customerId: string, threadId: string): void {
  const sep = threadId.indexOf(':');
  const owner = sep === -1 ? '' : threadId.slice(0, sep);
  if (owner !== customerId || sep === threadId.length - 1) {
    throw new Error('thread ownership violation: threadId does not belong to this customer');
  }
}

export interface ConfirmationRequest {
  proposalId: string;
  satelliteId: string;
  /** The proposed action being confirmed (the proposal's proposedAction). */
  action: Record<string, unknown>;
  /** Operator who APPROVED the proposal and is requesting execution. */
  requestedBy: string;
}

export interface ConfirmationDecision {
  approve: boolean;
  /** The confirming operator — must differ from `requestedBy` (four-eyes). */
  operatorId: string;
  note?: string;
}

/** What the gate hands the operator when it suspends, mirroring the interrupt value. */
export interface ConfirmationPrompt {
  kind: 'execution-confirmation';
  proposalId: string;
  satelliteId: string;
  action: Record<string, unknown>;
  requestedBy: string;
  question: string;
}

export interface PendingConfirmation {
  status: 'pending';
  threadId: string;
  prompt: ConfirmationPrompt;
}

export interface SettledConfirmation {
  status: 'confirmed' | 'rejected';
  threadId: string;
  /** Present when rejected: why (declined, or a four-eyes violation). */
  reason?: string;
  log: string[];
}

export type ConfirmationResult = PendingConfirmation | SettledConfirmation;

const ConfirmationState = Annotation.Root({
  proposalId: Annotation<string>,
  satelliteId: Annotation<string>,
  action: Annotation<Record<string, unknown>>,
  requestedBy: Annotation<string>,
  decision: Annotation<ConfirmationDecision | null>,
  outcome: Annotation<'confirmed' | 'rejected' | null>,
  reason: Annotation<string | null>,
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

type CS = typeof ConfirmationState.State;

/**
 * Build the compiled confirmation graph. MUST be compiled with a checkpointer:
 * the human gate suspends the run, and resuming reads the saved state back.
 */
export function buildConfirmationGraph(checkpointer: BaseCheckpointSaver) {
  // Summarize what is about to be confirmed. Runs once, before the gate, so it
  // is not re-executed on resume.
  const review = (state: CS) => ({
    log: [
      `Execution confirmation requested for proposal ${state.proposalId} ` +
        `(${state.satelliteId}, action "${String(state.action['type'] ?? 'unknown')}") by ${state.requestedBy}.`,
    ],
  });

  // The blocking gate. `interrupt()` suspends the run and persists it; on resume
  // it returns the value passed to Command({ resume }). Everything BEFORE the
  // interrupt call re-runs on resume, so this node stays side-effect-free.
  const confirmGate = (state: CS) => {
    const decision = interrupt<ConfirmationPrompt, ConfirmationDecision>({
      kind: 'execution-confirmation',
      proposalId: state.proposalId,
      satelliteId: state.satelliteId,
      action: state.action,
      requestedBy: state.requestedBy,
      question:
        `Confirm execution of "${String(state.action['type'] ?? 'unknown')}" for ${state.satelliteId}? ` +
        `A different operator than ${state.requestedBy} must approve (four-eyes).`,
    });
    return { decision };
  };

  // Record the human go/no-go. Enforces four-eyes: the confirming operator must
  // differ from the requester. Never actuates anything — outcome is a record.
  const record = (state: CS) => {
    const d = state.decision;
    if (!d) {
      return { outcome: 'rejected' as const, reason: 'no decision supplied', log: ['Rejected: no decision supplied.'] };
    }
    if (d.operatorId === state.requestedBy) {
      const reason = 'four-eyes violation: the confirming operator must differ from the requester';
      return {
        outcome: 'rejected' as const,
        reason,
        log: [`Rejected: ${reason} (both ${state.requestedBy}).`],
      };
    }
    if (!d.approve) {
      const reason = d.note ? `declined by ${d.operatorId}: ${d.note}` : `declined by ${d.operatorId}`;
      return { outcome: 'rejected' as const, reason, log: [`Rejected: ${reason}.`] };
    }
    return {
      outcome: 'confirmed' as const,
      reason: null,
      log: [`Confirmed by ${d.operatorId}${d.note ? ` (${d.note})` : ''}.`],
    };
  };

  return new StateGraph(ConfirmationState)
    .addNode('review', review)
    .addNode('confirmGate', confirmGate)
    .addNode('record', record)
    .addEdge(START, 'review')
    .addEdge('review', 'confirmGate')
    .addEdge('confirmGate', 'record')
    .addEdge('record', END)
    .compile({ checkpointer });
}

export type CompiledConfirmationGraph = ReturnType<typeof buildConfirmationGraph>;

function settledFrom(state: CS, threadId: string): SettledConfirmation {
  return {
    status: state.outcome === 'confirmed' ? 'confirmed' : 'rejected',
    threadId,
    ...(state.reason ? { reason: state.reason } : {}),
    log: state.log ?? [],
  };
}

/**
 * Start a confirmation run for `customerId`. Mints a tenant-owned thread id (the
 * caller never supplies one, so cross-tenant ids cannot be introduced) and
 * returns it on the result. Returns `pending` (with the gate's prompt) when the
 * graph suspends at the human gate, or a settled result if it ran to the end.
 */
export async function startConfirmation(
  graph: CompiledConfirmationGraph,
  customerId: string,
  req: ConfirmationRequest,
): Promise<ConfirmationResult> {
  const threadId = mintThreadId(customerId);
  const res = await graph.invoke(
    {
      proposalId: req.proposalId,
      satelliteId: req.satelliteId,
      action: req.action,
      requestedBy: req.requestedBy,
      decision: null,
      outcome: null,
      reason: null,
    },
    { configurable: { thread_id: threadId } },
  );
  if (isInterrupted<ConfirmationPrompt>(res)) {
    return { status: 'pending', threadId, prompt: res[INTERRUPT][0]!.value as ConfirmationPrompt };
  }
  return settledFrom(res as CS, threadId);
}

/**
 * Resume a suspended confirmation with the operator's decision. Enforces that
 * `threadId` belongs to `customerId` BEFORE touching the store, so one tenant
 * cannot resume/inspect another's thread. Reads the saved state from the
 * checkpointer — the graph/saver need not be the same instances that started the
 * run, so a run started before a restart still resumes.
 */
export async function resumeConfirmation(
  graph: CompiledConfirmationGraph,
  customerId: string,
  threadId: string,
  decision: ConfirmationDecision,
): Promise<ConfirmationResult> {
  assertThreadOwnership(customerId, threadId);
  const res = await graph.invoke(new Command({ resume: decision }), {
    configurable: { thread_id: threadId },
  });
  if (isInterrupted<ConfirmationPrompt>(res)) {
    return { status: 'pending', threadId, prompt: res[INTERRUPT][0]!.value as ConfirmationPrompt };
  }
  return settledFrom(res as CS, threadId);
}
