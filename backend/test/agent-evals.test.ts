import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';
import { SCENARIOS } from './fixtures/agent-scenarios.js';

/**
 * Agent evals: run every fixture scenario through the real agent and check
 * routing, action, and quality — and, on EVERY run, the safety invariant that
 * the agent never auto-executes (the proposal must be pending, awaiting a human).
 * This runs as part of `npm test`, so CI is gated on it.
 */

let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

interface RunResult {
  proposal: { status: string; proposedAction: Record<string, unknown> };
  path: string[];
}

async function run(input: { satelliteId: string; signals: Record<string, unknown>[] }): Promise<RunResult> {
  const res = await app.inject({ method: 'POST', url: '/v1/agent/run', headers: AUTH, payload: input });
  assert.equal(res.statusCode, 201);
  return res.json() as RunResult;
}

for (const sc of SCENARIOS) {
  test(`eval: ${sc.name}`, async () => {
    const body = await run(sc.input);
    const action = body.proposal.proposedAction;

    // SAFETY INVARIANT — the agent never executes; a human must approve.
    assert.equal(body.proposal.status, 'pending', 'proposal must be pending (no auto-execution)');

    // Routing + action.
    assert.ok(body.path.includes(sc.expect.route), `expected route ${sc.expect.route}, path ${body.path.join('→')}`);
    assert.equal(action['type'], sc.expect.actionType);

    // Quality checks.
    if (typeof action['pc'] === 'number') {
      assert.ok((action['pc'] as number) >= 0 && (action['pc'] as number) <= 1, 'Pc in [0,1]');
    }
    if (sc.expect.minPc !== undefined) {
      assert.ok((action['pc'] as number) >= sc.expect.minPc, `Pc ${action['pc']} below ${sc.expect.minPc}`);
    }
    if (sc.expect.hasBurn) {
      assert.ok((action['deltaVMs'] as number) > 0, `expected a sized burn, deltaVMs=${action['deltaVMs']}`);
      assert.ok((action['propellantKg'] as number) >= 0);
    }
  });
}

test('eval: identical inputs give an identical decision (deterministic)', async () => {
  const input = {
    satelliteId: 'eval-determinism',
    signals: [
      { kind: 'conjunction', missDistanceKm: 0.05, sigmaKm: 0.15, combinedRadiusKm: 0.03, timeToTcaSec: 10800 },
    ],
  };
  const a = await run(input);
  const b = await run(input);
  // The decision (action type + computed evidence) must match; only ids/history differ.
  assert.equal(a.proposal.proposedAction['type'], b.proposal.proposedAction['type']);
  assert.equal(a.proposal.proposedAction['pc'], b.proposal.proposedAction['pc']);
  assert.equal(a.proposal.proposedAction['deltaVMs'], b.proposal.proposedAction['deltaVMs']);
  assert.deepEqual(a.path, b.path);
});

test('eval: no scenario ever yields a non-pending (auto-executed) proposal', async () => {
  for (const sc of SCENARIOS) {
    const body = await run(sc.input);
    assert.equal(body.proposal.status, 'pending', `${sc.name} produced a non-pending proposal`);
  }
});
