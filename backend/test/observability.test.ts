import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { withSpan } from '../src/observability.js';
import { Telemetry } from '../src/telemetry/index.js';
import { freshDb, DEMO_ID } from './helpers.js';

let app: FastifyInstance;

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

test('every response carries x-request-id; an inbound id is honored', async () => {
  const minted = await app.inject({ method: 'GET', url: '/health' });
  assert.ok(minted.headers['x-request-id'], 'a request id is minted');

  const echoed = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { 'x-request-id': 'corr-test-123' },
  });
  assert.equal(echoed.headers['x-request-id'], 'corr-test-123');
});

test('withSpan is a transparent pass-through without an OTel SDK (no-op mode)', async () => {
  const value = await withSpan('test.op', { a: 1 }, async () => 42);
  assert.equal(value, 42);

  await assert.rejects(
    withSpan('test.fail', {}, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
});

test('telemetry retention purges only rows older than the cutoff', async () => {
  const db = await freshDb();
  const tel = new Telemetry(db);
  const oldTs = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(); // 10 days ago
  await tel.ingest(DEMO_ID, [
    { satelliteId: 's', ts: oldTs, subsystem: 'p', metric: 'm', value: 1 },
    { satelliteId: 's', subsystem: 'p', metric: 'm', value: 2 }, // now
  ]);

  const removed = await tel.purgeOlderThan(7);
  assert.equal(removed, 1);

  const left = await tel.queryRaw({ customerId: DEMO_ID, satelliteId: 's' });
  assert.equal(left.length, 1);
  assert.equal(left[0]!.value, 2);

  // 0 = retention disabled → no-op
  assert.equal(await tel.purgeOlderThan(0), 0);
  await db.close();
});
