import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/index.js';
import { buildServer } from '../src/server.js';
import { freshDb, createCustomer, demoOperatorId, DEMO_ID, DEMO_KEY } from './helpers.js';
import { hashApiKey } from '../src/auth/index.js';

/** Add a second operator to the demo tenant (four-eyes needs two operators). */
async function addDemoOperator(key: string): Promise<{ 'x-api-key': string }> {
  await db.query('INSERT INTO operators (customer_id, name, api_key_hash) VALUES ($1, $2, $3)', [
    DEMO_ID,
    `op-${key}`,
    hashApiKey(key),
  ]);
  return { 'x-api-key': key };
}

async function approve(id: string, headers = AUTH): Promise<void> {
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers });
  assert.equal(res.statusCode, 200);
}

let app: FastifyInstance;
let db: Db;
let demoOp: string;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  db = await freshDb();
  await createCustomer(db, 'acme', 'acme-key');
  demoOp = await demoOperatorId(db);
  app = await buildServer(db);
});
after(async () => {
  await app.close();
});

async function createProposal(headers = AUTH): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/proposals',
    headers,
    payload: { satelliteId: 'oo1-01', proposedAction: { burnSeconds: 12 } },
  });
  assert.equal(res.statusCode, 201);
  return (res.json() as { proposal: { id: string } }).proposal.id;
}

test('requests without an API key are rejected 401', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/proposals' });
  assert.equal(res.statusCode, 401);
});

test('countersign: a second operator four-eyes an approved proposal, audited', async () => {
  const op2 = await addDemoOperator('demo-key-cs1');
  const id = await createProposal(); // approved by the demo operator (AUTH)
  await approve(id);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/countersign`,
    headers: op2,
    payload: { approve: true, note: 'geometry re-checked' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { countersign: { status: string } }).countersign.status, 'confirmed');
  // Recorded in the tamper-evident audit chain.
  const audit = await app.inject({ method: 'GET', url: '/v1/audit', headers: AUTH });
  const actions = (audit.json() as { entries: { action: string }[] }).entries.map((e) => e.action);
  assert.ok(actions.includes('proposal.countersigned'));
});

test('countersign: the approver cannot countersign their own approval (four-eyes)', async () => {
  const id = await createProposal();
  await approve(id); // approved by the demo operator
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/countersign`,
    headers: AUTH, // same operator
    payload: { approve: true },
  });
  assert.equal(res.statusCode, 409);
});

test('countersign: only an approved proposal can be countersigned', async () => {
  const op2 = await addDemoOperator('demo-key-cs2');
  const id = await createProposal(); // still pending
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/countersign`,
    headers: op2,
    payload: { approve: true },
  });
  assert.equal(res.statusCode, 409);
});

test('countersign: a declined countersign is recorded as declined', async () => {
  const op2 = await addDemoOperator('demo-key-cs3');
  const id = await createProposal();
  await approve(id);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/countersign`,
    headers: op2,
    payload: { approve: false, note: 'wait for next CDM' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { countersign: { status: string } }).countersign.status, 'rejected');
});

test('list pagination is gapless even when proposals share an exact timestamp', async () => {
  // Isolated tenant so only these rows exist. Create 5, then force them all to
  // the SAME ts to reproduce the timestamp-tie that a ts-only cursor would skip.
  await createCustomer(db, 'pgpage', 'pgpage-key');
  const H = { 'x-api-key': 'pgpage-key' };
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) ids.push(await createProposal(H));
  await db.query(`UPDATE proposals SET ts = '2020-01-01T00:00:00Z' WHERE id = ANY($1)`, [ids]);

  // Page through with limit=2, following the opaque cursor.
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const url: string = `/v1/proposals?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await app.inject({ method: 'GET', url, headers: H });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { proposals: { id: string }[]; nextCursor: string | null };
    seen.push(...body.proposals.map((p) => p.id));
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  const unique = new Set(seen);
  assert.equal(seen.length, unique.size, 'no duplicate rows across pages');
  for (const id of ids) assert.ok(unique.has(id), `proposal ${id} was skipped by pagination`);
  assert.equal(unique.size, 5, 'all five tied-timestamp proposals paged through exactly once');
});

test('create → approve → attributed to the authenticated operator, audited', async () => {
  const id = await createProposal();
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH });
  assert.equal(res.statusCode, 200);
  const p = (res.json() as { proposal: { status: string; approvedBy: string } }).proposal;
  assert.equal(p.status, 'approved');
  assert.equal(p.approvedBy, demoOp); // identity comes from auth, not a body string
});

test('double approve is a no-op and does not double-write the audit log', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH });

  const before = await app.audit.count(DEMO_ID);
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH });
  const after = await app.audit.count(DEMO_ID);

  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'approved');
  assert.equal(after, before);
});

test('modify after approve is rejected by the terminal-state guard (no-op)', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/modify`,
    headers: AUTH,
    payload: { modifications: { burnSeconds: 99 } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'approved');
});

test('reject transitions a pending proposal to rejected', async () => {
  const id = await createProposal();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/reject`,
    headers: AUTH,
    payload: { reason: 'insufficient margin' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'rejected');
});

test('a tenant cannot see or act on another tenant\'s proposal', async () => {
  const id = await createProposal(AUTH); // owned by demo
  const otherAuth = { 'x-api-key': 'acme-key' };

  const get = await app.inject({ method: 'GET', url: `/v1/proposals/${id}`, headers: otherAuth });
  assert.equal(get.statusCode, 404);

  const approve = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: otherAuth });
  assert.equal(approve.statusCode, 404);

  const owner = await app.inject({ method: 'GET', url: `/v1/proposals/${id}`, headers: AUTH });
  assert.equal((owner.json() as { proposal: { status: string } }).proposal.status, 'pending');
});

test('decision on an unknown proposal is 404', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/proposals/00000000-0000-0000-0000-000000000000/approve',
    headers: AUTH,
  });
  assert.equal(res.statusCode, 404);
});

test('a client-supplied operator in the body is ignored (identity comes from auth)', async () => {
  const id = await createProposal();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    headers: AUTH,
    payload: { operator: 'hacker', approvedBy: 'hacker' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { approvedBy: string } }).proposal.approvedBy, demoOp);
});

test('a malformed decision body is 400', async () => {
  const id = await createProposal();
  // modify requires `modifications`; omitting it must be rejected.
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/modify`, headers: AUTH, payload: {} });
  assert.equal(res.statusCode, 400);
});
