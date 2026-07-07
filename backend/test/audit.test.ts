import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../src/audit/index.js';
import { buildServer } from '../src/server.js';
import { freshDb, createCustomer, demoOperatorId, DEMO_ID, DEMO_KEY } from './helpers.js';

test('append + verify: chain is valid across varied payloads', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append(DEMO_ID, 'user:op1', 'proposal.created', { id: 'p1', nested: { a: 1, b: [2, 3] } });
  await audit.append(DEMO_ID, 'ai:agent', 'proposal.scored', { score: 0.87, tags: ['conjunction'] });
  await audit.append(DEMO_ID, 'user:op1', 'proposal.approved', { id: 'p1' });

  const res = await audit.verify(DEMO_ID);
  assert.equal(res.valid, true);
  assert.equal(res.valid && res.entries, 3);
  await db.close();
});

test('concurrent appends do not fork the chain (seq 0..N, still valid)', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => audit.append(DEMO_ID, 'user:load', 'noise', { i })),
  );
  const entries = await audit.all(DEMO_ID);
  assert.deepEqual(
    entries.map((e) => e.seq),
    Array.from({ length: 25 }, (_, i) => i),
  );
  const res = await audit.verify(DEMO_ID);
  assert.equal(res.valid, true);
  await db.close();
});

test('tampering with a middle entry is detected', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append(DEMO_ID, 'user:op1', 'a', { v: 1 });
  await audit.append(DEMO_ID, 'user:op1', 'b', { v: 2 });
  await audit.append(DEMO_ID, 'user:op1', 'c', { v: 3 });

  await db.query(`UPDATE audit_log SET payload = '{"v":999}'::jsonb WHERE customer_id = $1 AND seq = 1`, [
    DEMO_ID,
  ]);

  const res = await audit.verify(DEMO_ID);
  assert.equal(res.valid, false);
  assert.equal(res.valid === false && res.brokenAt, 1);
  await db.close();
});

test('each tenant keeps an independent chain (seq restarts, verify is per-tenant)', async () => {
  const db = await freshDb();
  const other = await createCustomer(db, 'acme', 'acme-key');
  const audit = new AuditLog(db);

  await audit.append(DEMO_ID, 'user:op1', 'a', { v: 1 });
  await audit.append(other, 'user:op2', 'x', { v: 1 });
  await audit.append(other, 'user:op2', 'y', { v: 2 });

  assert.equal(await audit.count(DEMO_ID), 1);
  assert.equal(await audit.count(other), 2);
  const otherEntries = await audit.all(other);
  assert.deepEqual(otherEntries.map((e) => e.seq), [0, 1]); // seq restarts per tenant
  assert.equal((await audit.verify(DEMO_ID)).valid, true);
  assert.equal((await audit.verify(other)).valid, true);
  await db.close();
});

test('POST /v1/audit forces the actor from auth — a client-supplied actor is ignored', async () => {
  const db = await freshDb();
  const demoOp = await demoOperatorId(db);
  const app = await buildServer(db);
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audit',
      headers: { 'x-api-key': DEMO_KEY },
      payload: {
        actor: 'ai:agent', // spoof attempt — must be ignored
        action: 'note.added',
        payload: { note: 'x', operatorId: 'fake', operatorName: 'Mallory' },
      },
    });
    assert.equal(res.statusCode, 201);
    const entry = (res.json() as { entry: { actor: string; payload: Record<string, unknown> } }).entry;
    assert.equal(entry.actor, `user:${demoOp}`); // identity from auth, not body
    assert.equal(entry.payload['operatorId'], demoOp); // payload spoof overridden too
    assert.notEqual(entry.payload['operatorName'], 'Mallory');
  } finally {
    await app.close();
  }
});

test('export produces JSON and CSV', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append(DEMO_ID, 'user:op1', 'a', { v: 1 });
  await audit.append(DEMO_ID, 'user:op1', 'b', { v: 2 });

  const json = JSON.parse(await audit.exportJson(DEMO_ID)) as unknown[];
  assert.equal(json.length, 2);

  const csv = await audit.exportCsv(DEMO_ID);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'seq,ts,actor,action,payload,prev_hash,hash');
  assert.equal(lines.length, 3);
  await db.close();
});
