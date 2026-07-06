import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

test('a retried POST with the same Idempotency-Key does not create a duplicate', async () => {
  const headers = { ...AUTH, 'idempotency-key': 'retry-abc' };
  const payload = { satelliteId: 'oo1-01', proposedAction: { burnSeconds: 7 } };

  const first = await app.inject({ method: 'POST', url: '/v1/proposals', headers, payload });
  const second = await app.inject({ method: 'POST', url: '/v1/proposals', headers, payload });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  const id1 = (first.json() as { proposal: { id: string } }).proposal.id;
  const id2 = (second.json() as { proposal: { id: string } }).proposal.id;
  assert.equal(id1, id2, 'replay returns the original proposal');

  // Exactly one proposal exists for this tenant.
  const list = await app.inject({ method: 'GET', url: '/v1/proposals', headers: AUTH });
  const proposals = (list.json() as { proposals: unknown[] }).proposals;
  assert.equal(proposals.length, 1);
});

test('a telemetry ingest retried with the same key ingests once', async () => {
  const headers = { ...AUTH, 'idempotency-key': 'tel-1' };
  const payload = { readings: [{ satelliteId: 's', subsystem: 'p', metric: 'm', value: 1 }] };
  await app.inject({ method: 'POST', url: '/v1/telemetry', headers, payload });
  await app.inject({ method: 'POST', url: '/v1/telemetry', headers, payload });

  const q = await app.inject({ method: 'GET', url: '/v1/telemetry?satelliteId=s', headers: AUTH });
  assert.equal((q.json() as { points: unknown[] }).points.length, 1);
});

test('without a key, two POSTs create two proposals (no idempotency)', async () => {
  const count = async () =>
    (
      (await app.inject({ method: 'GET', url: '/v1/proposals?limit=500', headers: AUTH })).json() as {
        proposals: unknown[];
      }
    ).proposals.length;
  const before = await count();
  await app.inject({ method: 'POST', url: '/v1/proposals', headers: AUTH, payload: { satelliteId: 'x' } });
  await app.inject({ method: 'POST', url: '/v1/proposals', headers: AUTH, payload: { satelliteId: 'x' } });
  assert.equal(await count(), before + 2);
});
