import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

async function createProposal(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/proposals',
    payload: { satelliteId: 'oo1-01', proposedAction: { burnSeconds: 12 } },
  });
  assert.equal(res.statusCode, 201);
  return (res.json() as { proposal: { id: string } }).proposal.id;
}

test('create → approve → status is approved and audited', async () => {
  const id = await createProposal();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    payload: { operator: 'op1' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'approved');
});

test('double approve is a no-op and does not double-write the audit log', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, payload: { operator: 'op1' } });

  const before = (await app.audit.count?.()) ?? 0;
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/approve`,
    payload: { operator: 'op2' },
  });
  const after = await app.audit.count();

  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string; approvedBy: string } }).proposal.status, 'approved');
  // approvedBy stays op1 (first decision wins); no new audit entry
  assert.equal((res.json() as { proposal: { approvedBy: string } }).proposal.approvedBy, 'op1');
  assert.equal(after, before);
});

test('modify after approve is rejected by the terminal-state guard (no-op)', async () => {
  const id = await createProposal();
  await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, payload: { operator: 'op1' } });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/proposals/${id}/modify`,
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
    payload: { operator: 'op1', reason: 'insufficient margin' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { proposal: { status: string } }).proposal.status, 'rejected');
});

test('audit chain stays valid after the full lifecycle', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/audit/verify' });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { valid: boolean }).valid, true);
});

test('decision on an unknown proposal is 404', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/proposals/00000000-0000-0000-0000-000000000000/approve',
    payload: { operator: 'op1' },
  });
  assert.equal(res.statusCode, 404);
});

test('invalid body is 400', async () => {
  const id = await createProposal();
  const res = await app.inject({ method: 'POST', url: `/v1/proposals/${id}/approve`, payload: {} });
  assert.equal(res.statusCode, 400);
});
