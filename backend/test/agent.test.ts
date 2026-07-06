import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_ID, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

interface RunResult {
  proposal: { id: string; status: string; proposedAction: { type: string } };
  chain: { phase: string; agent: string; text: string }[];
  llmAugmented: boolean;
  path: string[];
}

test('multi-agent graph: supervisor routes a conjunction through screener → planner → critic → drafter', async () => {
  const auditBefore = await app.audit.count(DEMO_ID);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: {
      satelliteId: 'oo1-01',
      signals: [
        { kind: 'comms_degradation', severity: 0.5 },
        { kind: 'conjunction', severity: 0.9 },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;

  // Conjunction (0.9 × 0.9) outranks comms (0.55 × 0.5) → maneuver.
  assert.equal(body.proposal.proposedAction.type, 'maneuver');
  assert.equal(body.proposal.status, 'pending'); // HITL: nothing executes without approval

  // The supervisor routed to the conjunction specialist; full path recorded.
  assert.deepEqual(body.path, [
    'supervisor',
    'conjunctionScreener',
    'maneuverPlanner',
    'complianceChecker',
    'proposalDrafter',
    'persist',
  ]);

  // Full reasoning chain across the agents; no AI step without an LLM key.
  assert.deepEqual(
    body.chain.map((s) => s.phase),
    ['OBSERVE', 'THINK', 'SCORE', 'PLAN', 'CHECK', 'PROPOSE'],
  );
  assert.equal(body.llmAugmented, false);

  // The proposal was recorded in the tenant's audit chain.
  assert.equal(await app.audit.count(DEMO_ID), auditBefore + 1);
});

test('an anomaly signal routes through the anomaly triager', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: 'oo1-05', signals: [{ kind: 'battery_degradation', severity: 0.7 }] },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;
  assert.ok(body.path.includes('anomalyTriager'), `path was ${body.path.join('→')}`);
  assert.equal(body.proposal.proposedAction.type, 'load_shed');
});

test('unknown signals fall back to an investigate proposal', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: 'oo1-02', signals: [{ kind: 'mystery' }] },
  });
  assert.equal(res.statusCode, 201);
  assert.equal((res.json() as RunResult).proposal.proposedAction.type, 'investigate');
});

test('an agent proposal flows into the normal approve lifecycle', async () => {
  const run = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: 'oo1-03', signals: [{ kind: 'thermal_anomaly', severity: 0.8 }] },
  });
  const id = (run.json() as RunResult).proposal.id;

  const approve = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    headers: AUTH,
  });
  assert.equal(approve.statusCode, 200);
  assert.equal((approve.json() as { proposal: { status: string } }).proposal.status, 'approved');

  assert.equal((await app.audit.verify(DEMO_ID)).valid, true);
});

test('agent run requires authentication', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    payload: { satelliteId: 'oo1-01', signals: [] },
  });
  assert.equal(res.statusCode, 401);
});
