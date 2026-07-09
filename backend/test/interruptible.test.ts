import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';
import { DbCheckpointSaver } from '../src/agents/checkpointer.js';
import {
  buildConfirmationGraph,
  startConfirmation,
  resumeConfirmation,
  mintThreadId,
  assertThreadOwnership,
  type ConfirmationRequest,
} from '../src/agents/interruptible.js';

const REQ: ConfirmationRequest = {
  proposalId: 'prop-1',
  satelliteId: 'SAT-42',
  action: { type: 'maneuver', deltaVMs: 0.12 },
  requestedBy: 'op-alice',
};

test('mintThreadId / assertThreadOwnership enforce the tenant boundary', () => {
  const tid = mintThreadId('cust-A');
  assert.match(tid, /^cust-A:[0-9a-f-]{36}$/);
  assert.doesNotThrow(() => assertThreadOwnership('cust-A', tid));
  // Another tenant cannot claim it, nor can a malformed / prefix-spoofed id pass.
  assert.throws(() => assertThreadOwnership('cust-B', tid), /ownership violation/);
  assert.throws(() => assertThreadOwnership('cust-A', 'cust-A'), /ownership violation/);
  assert.throws(() => assertThreadOwnership('cust-A', 'cust-A:'), /ownership violation/);
  assert.throws(() => assertThreadOwnership('cust-A', 'cust-AB:xyz'), /ownership violation/);
});

test('startConfirmation suspends at the human gate with a prompt', async () => {
  const db = await freshDb();
  try {
    const graph = buildConfirmationGraph(new DbCheckpointSaver(db));
    const res = await startConfirmation(graph, 'cust', REQ);
    assert.equal(res.status, 'pending');
    if (res.status !== 'pending') return;
    assert.match(res.threadId, /^cust:/);
    assert.equal(res.prompt.kind, 'execution-confirmation');
    assert.equal(res.prompt.proposalId, 'prop-1');
    assert.deepEqual(res.prompt.action, { type: 'maneuver', deltaVMs: 0.12 });
    assert.equal(res.prompt.requestedBy, 'op-alice');
  } finally {
    await db.close();
  }
});

test('a suspended run resumes to confirmed AFTER a simulated restart (fresh saver + graph)', async () => {
  const db = await freshDb();
  try {
    // Run 1: start and suspend, then throw the graph + saver away.
    const started = await startConfirmation(buildConfirmationGraph(new DbCheckpointSaver(db)), 'cust', REQ);
    assert.equal(started.status, 'pending');
    if (started.status !== 'pending') return;

    // Run 2: a brand-new saver + graph over the SAME db — as if the process
    // restarted — resumes the run purely from persisted checkpoint state.
    const resumed = await resumeConfirmation(
      buildConfirmationGraph(new DbCheckpointSaver(db)),
      'cust',
      started.threadId,
      { approve: true, operatorId: 'op-bob', note: 'geometry re-checked' },
    );
    assert.equal(resumed.status, 'confirmed');
    if (resumed.status === 'confirmed' || resumed.status === 'rejected') {
      assert.ok(resumed.log.some((l) => l.includes('Confirmed by op-bob')));
      // The pre-gate review step ran once and its log survived the suspend.
      assert.ok(resumed.log.some((l) => l.includes('Execution confirmation requested')));
    }
  } finally {
    await db.close();
  }
});

test('a declined decision resumes to rejected with a reason', async () => {
  const db = await freshDb();
  try {
    const graph = buildConfirmationGraph(new DbCheckpointSaver(db));
    const started = await startConfirmation(graph, 'cust', REQ);
    assert.equal(started.status, 'pending');
    if (started.status !== 'pending') return;
    const res = await resumeConfirmation(graph, 'cust', started.threadId, {
      approve: false,
      operatorId: 'op-bob',
      note: 'wait for the next CDM',
    });
    assert.equal(res.status, 'rejected');
    if (res.status === 'rejected') {
      assert.match(res.reason ?? '', /declined by op-bob/);
    }
  } finally {
    await db.close();
  }
});

test('four-eyes: the requester cannot confirm their own execution', async () => {
  const db = await freshDb();
  try {
    const graph = buildConfirmationGraph(new DbCheckpointSaver(db));
    const started = await startConfirmation(graph, 'cust', REQ);
    assert.equal(started.status, 'pending');
    if (started.status !== 'pending') return;
    // Same operator (op-alice) who requested tries to approve → rejected.
    const res = await resumeConfirmation(graph, 'cust', started.threadId, {
      approve: true,
      operatorId: 'op-alice',
    });
    assert.equal(res.status, 'rejected');
    if (res.status === 'rejected') {
      assert.match(res.reason ?? '', /four-eyes/);
    }
  } finally {
    await db.close();
  }
});

test('a tenant cannot resume another tenant’s thread', async () => {
  const db = await freshDb();
  try {
    const graph = buildConfirmationGraph(new DbCheckpointSaver(db));
    const started = await startConfirmation(graph, 'custA', REQ);
    assert.equal(started.status, 'pending');
    if (started.status !== 'pending') return;
    // custB tries to resume custA's minted thread → rejected before any store access.
    await assert.rejects(
      resumeConfirmation(graph, 'custB', started.threadId, { approve: true, operatorId: 'b-op' }),
      /ownership violation/,
    );
  } finally {
    await db.close();
  }
});

test('two tenants running confirmations never cross', async () => {
  const db = await freshDb();
  try {
    const graph = buildConfirmationGraph(new DbCheckpointSaver(db));
    const a0 = await startConfirmation(graph, 'custA', { ...REQ, proposalId: 'A', requestedBy: 'a-req' });
    const b0 = await startConfirmation(graph, 'custB', { ...REQ, proposalId: 'B', requestedBy: 'b-req' });
    assert.ok(a0.status === 'pending' && b0.status === 'pending');
    if (a0.status !== 'pending' || b0.status !== 'pending') return;
    const a = await resumeConfirmation(graph, 'custA', a0.threadId, { approve: true, operatorId: 'a-op' });
    const b = await resumeConfirmation(graph, 'custB', b0.threadId, { approve: false, operatorId: 'b-op' });
    assert.equal(a.status, 'confirmed');
    assert.equal(b.status, 'rejected');
  } finally {
    await db.close();
  }
});
