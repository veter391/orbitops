import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, createCustomer, DEMO_ID } from './helpers.js';
import { AgentMemory } from '../src/agents/memory.js';
import { LexicalEmbedder, cosine } from '../src/agents/embedder.js';
import { Proposals } from '../src/proposals/index.js';
import { AuditLog } from '../src/audit/index.js';
import { EventBus } from '../src/events/index.js';
import { buildAgentGraph, runAgentGraph } from '../src/agents/graph.js';
import type { Db } from '../src/db/index.js';

// --- embedder unit properties ---------------------------------------------

test('LexicalEmbedder is deterministic and unit-length', async () => {
  const e = new LexicalEmbedder(128);
  const a = await e.embed('conjunction pc=1.0e-3 miss=0.4km');
  const b = await e.embed('conjunction pc=1.0e-3 miss=0.4km');
  assert.deepEqual(a, b, 'same text → identical vector');
  assert.equal(a.length, 128);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, 'vector is L2-normalized');
});

test('cosine: identical > related > unrelated, empty vector is 0', async () => {
  const e = new LexicalEmbedder();
  const conj1 = await e.embed('conjunction event high risk maneuver required');
  const conj2 = await e.embed('conjunction event elevated risk maneuver considered');
  const power = await e.embed('battery voltage anomaly power subsystem');
  assert.ok(cosine(conj1, conj1) > 0.999);
  assert.ok(cosine(conj1, conj2) > cosine(conj1, power), 'related text is closer than unrelated');
  assert.equal(cosine(conj1, await e.embed('   ')), 0, 'empty text → zero similarity');
});

// --- memory integration ----------------------------------------------------

async function proposalsFor(db: Db): Promise<Proposals> {
  return new Proposals(db, new AuditLog(db), new EventBus());
}

test('no embedder → semantic disabled, recallSimilar/remember are no-ops', async () => {
  const db = await freshDb();
  try {
    const mem = new AgentMemory(db);
    assert.equal(mem.semanticEnabled, false);
    await mem.remember({ proposalId: 'x', customerId: DEMO_ID, satelliteId: 'SAT-1', situation: 'anything' });
    assert.deepEqual(await mem.recallSimilar(DEMO_ID, 'anything'), []);
    // remember was a no-op — nothing stored.
    const rows = await db.query('SELECT count(*)::int AS n FROM proposal_situations');
    assert.equal((rows[0] as { n: number }).n, 0);
  } finally {
    await db.close();
  }
});

test('remember → recallSimilar ranks the closest past situation first', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const mem = new AgentMemory(db, new LexicalEmbedder());
    assert.equal(mem.semanticEnabled, true);

    // Three real proposals, three distinct situations.
    const conj = await props.create(DEMO_ID, { satelliteId: 'SAT-1', reasoningChain: [], proposedAction: { type: 'maneuver' } });
    const power = await props.create(DEMO_ID, { satelliteId: 'SAT-2', reasoningChain: [], proposedAction: { type: 'investigate' } });
    const attitude = await props.create(DEMO_ID, { satelliteId: 'SAT-3', reasoningChain: [], proposedAction: { type: 'investigate' } });
    await mem.remember({ proposalId: conj.id, customerId: DEMO_ID, satelliteId: 'SAT-1', situation: 'conjunction close approach high probability of collision maneuver' });
    await mem.remember({ proposalId: power.id, customerId: DEMO_ID, satelliteId: 'SAT-2', situation: 'battery voltage drop power subsystem anomaly' });
    await mem.remember({ proposalId: attitude.id, customerId: DEMO_ID, satelliteId: 'SAT-3', situation: 'attitude control reaction wheel saturation' });

    const hits = await mem.recallSimilar(DEMO_ID, 'conjunction high collision probability requires avoidance maneuver', { k: 3 });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.proposalId, conj.id, 'the conjunction situation ranks first');
    assert.ok(hits[0]!.similarity > 0, 'positive similarity');
    // Ranking is monotonically decreasing.
    for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1]!.similarity >= hits[i]!.similarity);
  } finally {
    await db.close();
  }
});

test('recallSimilar bounds candidates via candidateCap', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const mem = new AgentMemory(db, new LexicalEmbedder());
    // Three equally-matching situations; all clear minSimilarity for the query.
    for (const sat of ['SAT-1', 'SAT-2', 'SAT-3']) {
      const p = await props.create(DEMO_ID, { satelliteId: sat, reasoningChain: [], proposedAction: { type: 'maneuver' } });
      await mem.remember({ proposalId: p.id, customerId: DEMO_ID, satelliteId: sat, situation: 'conjunction collision avoidance maneuver' });
    }
    // k is high enough to return all matches; the cap is what limits the count.
    const uncapped = await mem.recallSimilar(DEMO_ID, 'conjunction collision avoidance maneuver', { k: 10 });
    assert.equal(uncapped.length, 3, 'all three match without a cap');
    const capped = await mem.recallSimilar(DEMO_ID, 'conjunction collision avoidance maneuver', { k: 10, candidateCap: 2 });
    assert.equal(capped.length, 2, 'candidateCap limits how many rows are ranked');
  } finally {
    await db.close();
  }
});

test('recallSimilar is tenant-scoped — no cross-customer leakage', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const mem = new AgentMemory(db, new LexicalEmbedder());
    const other = await createCustomer(db, 'other-co', 'other-key');

    const mine = await props.create(DEMO_ID, { satelliteId: 'SAT-1', reasoningChain: [], proposedAction: { type: 'maneuver' } });
    const theirs = await props.create(other, { satelliteId: 'SAT-9', reasoningChain: [], proposedAction: { type: 'maneuver' } });
    await mem.remember({ proposalId: mine.id, customerId: DEMO_ID, satelliteId: 'SAT-1', situation: 'conjunction collision avoidance maneuver' });
    await mem.remember({ proposalId: theirs.id, customerId: other, satelliteId: 'SAT-9', situation: 'conjunction collision avoidance maneuver' });

    const hits = await mem.recallSimilar(DEMO_ID, 'conjunction collision avoidance maneuver');
    assert.equal(hits.length, 1, 'only my own tenant matches');
    assert.equal(hits[0]!.proposalId, mine.id);
  } finally {
    await db.close();
  }
});

test('graph wiring: a run remembers its situation; a later run recalls it in the chain', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const mem = new AgentMemory(db, new LexicalEmbedder());
    const graph = buildAgentGraph(props, undefined, mem);
    const input = {
      satelliteId: 'SAT-7',
      signals: [{ kind: 'conjunction', missDistanceKm: 0.05, sigmaKm: 0.1, combinedRadiusKm: 0.02, timeToTcaSec: 21600 }],
    };

    const first = await runAgentGraph(graph, DEMO_ID, input);
    // First run had nothing to recall — the similarity step says so.
    const firstSim = first.chain.find((s) => s.phase === 'RECALL' && s.text.startsWith('Similarity:'));
    assert.ok(firstSim, 'a Similarity recall step is present when semantic memory is on');
    assert.match(firstSim.text, /No similar past situations/);

    // The situation was persisted for future recall.
    const stored = await db.query('SELECT count(*)::int AS n FROM proposal_situations');
    assert.equal((stored[0] as { n: number }).n, 1);

    const second = await runAgentGraph(graph, DEMO_ID, input);
    const secondSim = second.chain.find((s) => s.phase === 'RECALL' && s.text.startsWith('Similarity:'));
    assert.ok(secondSim, 'second run has a similarity step');
    assert.match(secondSim.text, /similar past situation/, 'second run recalls the first situation');
  } finally {
    await db.close();
  }
});

test('graph wiring: with no embedder there is no Similarity step and nothing is stored', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const graph = buildAgentGraph(props, undefined, new AgentMemory(db));
    const out = await runAgentGraph(graph, DEMO_ID, {
      satelliteId: 'SAT-7',
      signals: [{ kind: 'conjunction', missDistanceKm: 0.05, sigmaKm: 0.1, combinedRadiusKm: 0.02, timeToTcaSec: 21600 }],
    });
    assert.ok(!out.chain.some((s) => s.text.startsWith('Similarity:')), 'no similarity step when off');
    const stored = await db.query('SELECT count(*)::int AS n FROM proposal_situations');
    assert.equal((stored[0] as { n: number }).n, 0);
  } finally {
    await db.close();
  }
});

test('recallSimilar filters by satellite and excludes a given proposal', async () => {
  const db = await freshDb();
  try {
    const props = await proposalsFor(db);
    const mem = new AgentMemory(db, new LexicalEmbedder());
    const p1 = await props.create(DEMO_ID, { satelliteId: 'SAT-1', reasoningChain: [], proposedAction: { type: 'maneuver' } });
    const p2 = await props.create(DEMO_ID, { satelliteId: 'SAT-2', reasoningChain: [], proposedAction: { type: 'maneuver' } });
    await mem.remember({ proposalId: p1.id, customerId: DEMO_ID, satelliteId: 'SAT-1', situation: 'conjunction maneuver' });
    await mem.remember({ proposalId: p2.id, customerId: DEMO_ID, satelliteId: 'SAT-2', situation: 'conjunction maneuver' });

    const onlySat1 = await mem.recallSimilar(DEMO_ID, 'conjunction maneuver', { satelliteId: 'SAT-1' });
    assert.equal(onlySat1.length, 1);
    assert.equal(onlySat1[0]!.satelliteId, 'SAT-1');

    const excluded = await mem.recallSimilar(DEMO_ID, 'conjunction maneuver', { excludeProposalId: p1.id });
    assert.ok(!excluded.some((h) => h.proposalId === p1.id), 'excluded proposal is absent');
  } finally {
    await db.close();
  }
});
