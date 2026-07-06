import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../src/audit/index.js';
import { freshDb } from './helpers.js';

test('append + verify: chain is valid across varied payloads', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append('user:op1', 'proposal.created', { id: 'p1', nested: { a: 1, b: [2, 3] } });
  await audit.append('ai:agent', 'proposal.scored', { score: 0.87, tags: ['conjunction'] });
  await audit.append('user:op1', 'proposal.approved', { id: 'p1' });

  const res = await audit.verify();
  assert.equal(res.valid, true);
  assert.equal(res.valid && res.entries, 3);
  await db.close();
});

test('concurrent appends do not fork the chain (seq 0..N, still valid)', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => audit.append('user:load', 'noise', { i })),
  );
  const entries = await audit.all();
  assert.deepEqual(
    entries.map((e) => e.seq),
    Array.from({ length: 25 }, (_, i) => i),
  );
  const res = await audit.verify();
  assert.equal(res.valid, true);
  await db.close();
});

test('tampering with a middle entry is detected', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append('user:op1', 'a', { v: 1 });
  await audit.append('user:op1', 'b', { v: 2 });
  await audit.append('user:op1', 'c', { v: 3 });

  // Mutate the payload of seq 1 directly, bypassing append().
  await db.query(`UPDATE audit_log SET payload = '{"v":999}'::jsonb WHERE seq = 1`);

  const res = await audit.verify();
  assert.equal(res.valid, false);
  assert.equal(res.valid === false && res.brokenAt, 1);
  await db.close();
});

test('export produces JSON and CSV', async () => {
  const db = await freshDb();
  const audit = new AuditLog(db);
  await audit.append('user:op1', 'a', { v: 1 });
  await audit.append('user:op1', 'b', { v: 2 });

  const json = JSON.parse(await audit.exportJson()) as unknown[];
  assert.equal(json.length, 2);

  const csv = await audit.exportCsv();
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'seq,ts,actor,action,payload,prev_hash,hash');
  assert.equal(lines.length, 3); // header + 2 rows
  await db.close();
});
