import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoise, NOISE_FLOOR_PC } from '../src/agents/conjunction.js';
import { buildAgentGraph, runAgentGraph } from '../src/agents/graph.js';
import type { Proposals } from '../src/proposals/index.js';

test('isNoise flags a Pc below the noise floor', () => {
  assert.equal(isNoise(NOISE_FLOOR_PC / 10), true);
  assert.equal(isNoise(NOISE_FLOOR_PC), false); // at the floor is not noise
  assert.equal(isNoise(1e-3), false);
  assert.equal(isNoise(null), false);
});

/** Minimal Proposals stub so the graph can run without a database. */
function stubProposals(): Proposals {
  return {
    create: async (_customerId: string, p: unknown) => ({ id: 'stub', status: 'pending', ...(p as object) }),
  } as unknown as Proposals;
}

test('a sub-noise-floor conjunction is auto-dismissed (monitor, routine, still pending)', async () => {
  const g = buildAgentGraph(stubProposals());
  // Large miss, tight covariance → Pc far below the noise floor.
  const res = await runAgentGraph(g, 'cust', {
    satelliteId: 'NOISE-SAT',
    signals: [{ kind: 'conjunction', missDistanceKm: 50, sigmaKm: 1, combinedRadiusKm: 0.02, timeToTcaSec: 10800 }],
  });
  const a = res.proposal.proposedAction as Record<string, unknown>;
  assert.equal(a['noise'], true);
  assert.equal(a['type'], 'monitor'); // no maneuver
  assert.equal(a['deltaVMs'], undefined); // no burn sized
  const esc = a['escalation'] as { level: string; notify: boolean } | undefined;
  assert.equal(esc?.level, 'routine'); // an imminent TCA on noise does NOT page
  assert.equal(esc?.notify, false);
  // SAFETY INVARIANT — even a dismissal is filed pending, never auto-executed.
  assert.equal(res.proposal.status, 'pending');
});

test('a real (above-floor) conjunction is NOT dismissed — it still proposes a maneuver', async () => {
  const g = buildAgentGraph(stubProposals());
  const res = await runAgentGraph(g, 'cust', {
    satelliteId: 'REAL-SAT',
    signals: [{ kind: 'conjunction', missDistanceKm: 0.05, sigmaKm: 0.13, combinedRadiusKm: 0.03, timeToTcaSec: 10800 }],
  });
  const a = res.proposal.proposedAction as Record<string, unknown>;
  assert.equal(a['noise'], false);
  assert.equal(a['type'], 'maneuver');
});
