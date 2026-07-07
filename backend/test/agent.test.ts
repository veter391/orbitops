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
  proposal: { id: string; status: string; proposedAction: Record<string, unknown> };
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
    'memory',
    'conjunctionScreener',
    'maneuverPlanner',
    'complianceChecker',
    'proposalDrafter',
    'persist',
  ]);

  // Full reasoning chain across the agents; no AI step without an LLM key.
  assert.deepEqual(
    body.chain.map((s) => s.phase),
    ['OBSERVE', 'RECALL', 'THINK', 'SCORE', 'PLAN', 'CHECK', 'PROPOSE'],
  );
  assert.equal(body.llmAugmented, false);

  // The proposal was recorded in the tenant's audit chain.
  assert.equal(await app.audit.count(DEMO_ID), auditBefore + 1);
});

test('conjunction with real geometry: screener computes Pc, evidence rides in the proposal', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: {
      satelliteId: 'oo1-09',
      signals: [
        { kind: 'conjunction', missDistanceKm: 0.05, sigmaKm: 0.1, combinedRadiusKm: 0.02, timeToTcaSec: 21600 },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;

  assert.equal(body.proposal.proposedAction['type'], 'maneuver');
  // Real Pc computed and surfaced in the reasoning chain (operator explainability).
  const scoreStep = body.chain.find((s) => s.phase === 'SCORE' && s.agent === 'conjunctionScreener');
  assert.ok(scoreStep && /Pc = /.test(scoreStep.text), `expected a Pc score step, got ${scoreStep?.text}`);
  // Evidence (Pc, miss distance, band) folded into the proposed action.
  const action = body.proposal.proposedAction;
  assert.equal(typeof action['pc'], 'number');
  assert.ok((action['pc'] as number) > 0);
  assert.equal(action['missDistanceKm'], 0.05);
  assert.ok(['warning', 'critical'].includes(String(action['riskBand'])), `band was ${action['riskBand']}`);
  // A real avoidance burn was sized (delta-v + propellant) and rides in the proposal.
  assert.ok((action['deltaVMs'] as number) > 0, `deltaVMs=${action['deltaVMs']}`);
  assert.ok((action['propellantKg'] as number) > 0);
  assert.ok((action['targetMissKm'] as number) >= 1.0);
  const planStep = body.chain.find((s) => s.phase === 'PLAN');
  assert.ok(planStep && /Δv .* m\/s/.test(planStep.text), `plan step: ${planStep?.text}`);
});

test('compliance critic flags a maneuver that overruns the propellant budget (still proposed for a human)', async () => {
  // Short time-to-TCA → large delta-v/propellant; tiny budget → flagged.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: {
      satelliteId: 'oo1-flag',
      signals: [
        {
          kind: 'conjunction',
          missDistanceKm: 0.02,
          sigmaKm: 0.1,
          combinedRadiusKm: 0.02,
          timeToTcaSec: 120,
          propellantBudgetKg: 0.0001,
        },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;
  const action = body.proposal.proposedAction;

  assert.equal(action['type'], 'maneuver'); // still a maneuver — a needed avoidance is not suppressed
  const flags = action['complianceFlags'] as string[] | undefined;
  assert.ok(Array.isArray(flags) && flags.length >= 1, `expected compliance flags, got ${JSON.stringify(flags)}`);
  const check = body.chain.find((s) => s.phase === 'CHECK');
  assert.ok(check && /compliance flag/.test(check.text), `check step: ${check?.text}`);
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
  assert.equal(body.proposal.proposedAction['type'], 'load_shed');
});

test('anomaly triager scores a reading against real telemetry history (robust z-score)', async () => {
  // Seed an in-family baseline for cpu_c on this satellite.
  const baseline = [39.4, 40.1, 39.8, 40.0, 39.6, 40.2, 39.9, 40.05];
  await app.telemetry.ingest(
    DEMO_ID,
    baseline.map((v) => ({ satelliteId: 'oo1-therm', subsystem: 'thm', metric: 'cpu_c', value: v })),
  );

  // Now assess a clearly out-of-family reading.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: {
      satelliteId: 'oo1-therm',
      signals: [{ kind: 'thermal_anomaly', metric: 'cpu_c', value: 85 }],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;

  assert.ok(body.path.includes('anomalyTriager'));
  const action = body.proposal.proposedAction;
  assert.equal(action['isAnomaly'], true);
  assert.ok(Math.abs(action['zscore'] as number) >= 3.5, `z=${action['zscore']}`);
  assert.equal(action['baselineN'], baseline.length);
  const score = body.chain.find((s) => s.agent === 'anomalyTriager' && s.phase === 'SCORE');
  assert.ok(score && /z=.*ANOMALY/.test(score.text), `score step: ${score?.text}`);
});

test('memory: a later run recalls prior decisions for the same satellite', async () => {
  const sat = 'oo1-mem';
  // First run creates a prior proposal for this satellite.
  await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: sat, signals: [{ kind: 'battery_degradation', severity: 0.6 }] },
  });

  // Second run should recall it in the reasoning chain.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: sat, signals: [{ kind: 'thermal_anomaly', severity: 0.6 }] },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as RunResult;

  assert.ok(body.path.includes('memory'), `path was ${body.path.join('→')}`);
  const recall = body.chain.find((s) => s.phase === 'RECALL' && s.agent === 'memory');
  assert.ok(recall, 'a RECALL step is present');
  assert.ok(/prior proposal/.test(recall!.text), `recall text: ${recall!.text}`);
});

test('memory: a satellite with no history reports no prior proposals', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agent/run',
    headers: AUTH,
    payload: { satelliteId: 'oo1-fresh-xyz', signals: [{ kind: 'comms_degradation', severity: 0.5 }] },
  });
  const body = res.json() as RunResult;
  const recall = body.chain.find((s) => s.phase === 'RECALL');
  assert.ok(recall && /No prior proposals/.test(recall.text), `recall: ${recall?.text}`);
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
