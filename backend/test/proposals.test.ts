import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/index.js';
import { buildServer } from '../src/server.js';
import { freshDb, createCustomer, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
let db: Db;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  db = await freshDb();
  await createCustomer(db, 'acme', 'acme-key');
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

test('create → approve → status is approved and audited', async () => {
  const id = await createProposal();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    headers: AUTH,
    payload: { operator: 'op1' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'approved');
});

test('double approve is a no-op and does not double-write the audit log', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH, payload: { operator: 'op1' } });

  const demo = await demoId(app);
  const before = await app.audit.count(demo);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    headers: AUTH,
    payload: { operator: 'op2' },
  });
  const after = await app.audit.count(demo);

  assert.equal(res.statusCode, 200);
  const p = (res.json() as { proposal: { status: string; approvedBy: string } }).proposal;
  assert.equal(p.status, 'approved');
  assert.equal(p.approvedBy, 'op1'); // first decision wins
  assert.equal(after, before);
});

test('modify after approve is rejected by the terminal-state guard (no-op)', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH, payload: { operator: 'op1' } });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/modify`,
    headers: AUTH,
    payload: { operator: 'op2', modifications: { burnSeconds: 99 } },
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
    payload: { operator: 'op1', reason: 'insufficient margin' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'rejected');
});

test('a tenant cannot see or act on another tenant\'s proposal', async () => {
  const id = await createProposal(AUTH); // owned by demo
  const otherAuth = { 'x-api-key': 'acme-key' };

  const get = await app.inject({ method: 'GET', url: `/v1/proposals/${id}`, headers: otherAuth });
  assert.equal(get.statusCode, 404);

  const approve = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    headers: otherAuth,
    payload: { operator: 'intruder' },
  });
  assert.equal(approve.statusCode, 404);

  // still pending for the real owner
  const owner = await app.inject({ method: 'GET', url: `/v1/proposals/${id}`, headers: AUTH });
  assert.equal((owner.json() as { proposal: { status: string } }).proposal.status, 'pending');
});

test('decision on an unknown proposal is 404', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/proposals/00000000-0000-0000-0000-000000000000/approve',
    headers: AUTH,
    payload: { operator: 'op1' },
  });
  assert.equal(res.statusCode, 404);
});

test('invalid body is 400', async () => {
  const id = await createProposal();
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, headers: AUTH, payload: {} });
  assert.equal(res.statusCode, 400);
});

/** Resolve the demo tenant's id from its seeded key (avoids hardcoding twice). */
async function demoId(a: FastifyInstance): Promise<string> {
  const rows = await a.db.query<{ id: string }>('SELECT id FROM customers WHERE name = $1', ['demo']);
  return rows[0]!.id;
}
