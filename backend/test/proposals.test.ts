import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/index.js';
import { buildServer } from '../src/server.js';
import { freshDb, createCustomer, demoOperatorId, DEMO_ID, DEMO_KEY } from './helpers.js';

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
