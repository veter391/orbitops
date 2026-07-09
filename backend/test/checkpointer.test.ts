import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import type { Checkpoint, CheckpointMetadata, PendingWrite } from '@langchain/langgraph-checkpoint';
import { freshDb } from './helpers.js';
import { DbCheckpointSaver } from '../src/agents/checkpointer.js';

function cfg(threadId: string, checkpointId?: string) {
  return {
    configurable: {
      thread_id: threadId,
      checkpoint_ns: '',
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  };
}

function makeCheckpoint(id: string, values: Record<string, unknown>): Checkpoint {
  return { ...emptyCheckpoint(), id, channel_values: values } as Checkpoint;
}

const META: CheckpointMetadata = { source: 'loop', step: 1, parents: {} };

test('put then getTuple round-trips checkpoint + metadata', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const cp = makeCheckpoint('00000000-0000-6000-8000-000000000001', { plan: { burn: 12.5 } });
    const putCfg = await saver.put(cfg('cust:thread-a'), cp, META, {});
    assert.equal(putCfg.configurable?.checkpoint_id, cp.id);

    const tuple = await saver.getTuple(cfg('cust:thread-a', cp.id));
    assert.ok(tuple, 'tuple should exist');
    assert.equal(tuple.checkpoint.id, cp.id);
    assert.deepEqual(tuple.checkpoint.channel_values, { plan: { burn: 12.5 } });
    assert.deepEqual(tuple.metadata, META);
    assert.equal(tuple.config.configurable?.thread_id, 'cust:thread-a');
  } finally {
    await db.close();
  }
});

test('getTuple without checkpoint_id returns the latest checkpoint', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const c1 = makeCheckpoint('00000000-0000-6000-8000-000000000001', { step: 1 });
    const c2 = makeCheckpoint('00000000-0000-6000-8000-000000000002', { step: 2 });
    // Second put carries the first as parent (id in the inbound config).
    await saver.put(cfg('cust:thread-b'), c1, META, {});
    await saver.put(cfg('cust:thread-b', c1.id), c2, { ...META, step: 2 }, {});

    const latest = await saver.getTuple(cfg('cust:thread-b'));
    assert.ok(latest);
    assert.equal(latest.checkpoint.id, c2.id);
    assert.equal(latest.parentConfig?.configurable?.checkpoint_id, c1.id);
  } finally {
    await db.close();
  }
});

test('putWrites round-trips as pendingWrites on the checkpoint', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const cp = makeCheckpoint('00000000-0000-6000-8000-000000000001', {});
    await saver.put(cfg('cust:thread-c'), cp, META, {});

    const writes: PendingWrite[] = [
      ['messages', { role: 'human', text: 'approve' }],
      ['plan', { burn: 3 }],
    ];
    await saver.putWrites(cfg('cust:thread-c', cp.id), writes, 'task-1');

    const tuple = await saver.getTuple(cfg('cust:thread-c', cp.id));
    assert.ok(tuple);
    assert.equal(tuple.pendingWrites?.length, 2);
    const byChannel = new Map(tuple.pendingWrites!.map((w) => [w[1], w[2]]));
    assert.deepEqual(byChannel.get('messages'), { role: 'human', text: 'approve' });
    assert.deepEqual(byChannel.get('plan'), { burn: 3 });
    assert.equal(tuple.pendingWrites![0]![0], 'task-1');
  } finally {
    await db.close();
  }
});

test('ordinary putWrites are idempotent (a retried task does not clobber)', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const cp = makeCheckpoint('00000000-0000-6000-8000-000000000001', {});
    await saver.put(cfg('cust:thread-d'), cp, META, {});

    await saver.putWrites(cfg('cust:thread-d', cp.id), [['plan', { v: 1 }]], 'task-1');
    // Same task, same positional slot, different value → first write wins.
    await saver.putWrites(cfg('cust:thread-d', cp.id), [['plan', { v: 2 }]], 'task-1');

    const tuple = await saver.getTuple(cfg('cust:thread-d', cp.id));
    assert.equal(tuple?.pendingWrites?.length, 1);
    assert.deepEqual(tuple?.pendingWrites?.[0]?.[2], { v: 1 });
  } finally {
    await db.close();
  }
});

test('deleteThread removes checkpoints and writes for that thread only', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const cp = makeCheckpoint('00000000-0000-6000-8000-000000000001', { keep: true });
    await saver.put(cfg('cust:thread-keep'), cp, META, {});
    await saver.put(cfg('cust:thread-drop'), cp, META, {});
    await saver.putWrites(cfg('cust:thread-drop', cp.id), [['plan', { v: 1 }]], 'task-1');

    await saver.deleteThread('cust:thread-drop');

    assert.equal(await saver.getTuple(cfg('cust:thread-drop')), undefined);
    const kept = await saver.getTuple(cfg('cust:thread-keep'));
    assert.ok(kept, 'unrelated thread survives deleteThread');
    assert.equal(kept.checkpoint.id, cp.id);
  } finally {
    await db.close();
  }
});

test('isolated threads never leak checkpoints across tenants', async () => {
  const db = await freshDb();
  try {
    const saver = new DbCheckpointSaver(db);
    const cpA = makeCheckpoint('00000000-0000-6000-8000-00000000000a', { tenant: 'a' });
    const cpB = makeCheckpoint('00000000-0000-6000-8000-00000000000b', { tenant: 'b' });
    await saver.put(cfg('custA:thread-1'), cpA, META, {});
    await saver.put(cfg('custB:thread-1'), cpB, META, {});

    const a = await saver.getTuple(cfg('custA:thread-1'));
    const b = await saver.getTuple(cfg('custB:thread-1'));
    assert.deepEqual(a?.checkpoint.channel_values, { tenant: 'a' });
    assert.deepEqual(b?.checkpoint.channel_values, { tenant: 'b' });
  } finally {
    await db.close();
  }
});
