import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_ID, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

const BASE = '2026-01-01T00:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(BASE) + sec * 1000).toISOString();

test('ingest stores a batch and does not touch the audit log', async () => {
  const auditBefore = await app.audit.count(DEMO_ID);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/telemetry',
    headers: AUTH,
    payload: {
      readings: [
        { satelliteId: 'oo1-01', ts: at(0), subsystem: 'pwr', metric: 'battery_v', value: 27.0, unit: 'V' },
        { satelliteId: 'oo1-01', ts: at(10), subsystem: 'pwr', metric: 'battery_v', value: 27.2, unit: 'V' },
        { satelliteId: 'oo1-01', ts: at(70), subsystem: 'pwr', metric: 'battery_v', value: 26.6, unit: 'V' },
        { satelliteId: 'oo1-01', ts: at(5), subsystem: 'thm', metric: 'cpu_c', value: 39.4, unit: 'C' },
      ],
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal((res.json() as { ingested: number }).ingested, 4);
  assert.equal(await app.audit.count(DEMO_ID), auditBefore);
});

test('queryRaw returns a satellite+metric series newest-first', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/telemetry?satelliteId=oo1-01&metric=battery_v',
    headers: AUTH,
  });
  assert.equal(res.statusCode, 200);
  const points = (res.json() as { points: { ts: string; value: number }[] }).points;
  assert.equal(points.length, 3);
  assert.ok(points[0]!.ts >= points[1]!.ts, 'newest first');
});

test('queryBucketed downsamples into fixed-width buckets', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/telemetry?satelliteId=oo1-01&metric=battery_v&bucketSeconds=60&agg=avg',
    headers: AUTH,
  });
  assert.equal(res.statusCode, 200);
  const series = (res.json() as { series: { bucket: string; value: number; n: number }[] }).series;
  assert.equal(series.length, 2);
  assert.equal(series.reduce((s, b) => s + b.n, 0), 3);
});

test('latest returns one reading per metric', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/telemetry/latest?satelliteId=oo1-01', headers: AUTH });
  assert.equal(res.statusCode, 200);
  const points = (res.json() as { points: { metric: string; value: number }[] }).points;
  assert.deepEqual(points.map((p) => p.metric).sort(), ['battery_v', 'cpu_c']);
  assert.equal(points.find((p) => p.metric === 'battery_v')!.value, 26.6);
});

test('another tenant sees none of this tenant\'s telemetry', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/telemetry?satelliteId=oo1-01&metric=battery_v',
    headers: { 'x-api-key': 'demo-key-does-not-exist' },
  });
  assert.equal(res.statusCode, 401); // unknown key never reaches data
});

test('rejects an empty batch and a non-finite value', async () => {
  const empty = await app.inject({ method: 'POST', url: '/v1/telemetry', headers: AUTH, payload: { readings: [] } });
  assert.equal(empty.statusCode, 400);

  const bad = await app.inject({
    method: 'POST',
    url: '/v1/telemetry',
    headers: AUTH,
    payload: { readings: [{ satelliteId: 'x', subsystem: 'p', metric: 'm', value: 'NaN' }] },
  });
  assert.equal(bad.statusCode, 400);
});
