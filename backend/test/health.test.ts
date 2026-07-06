import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../src/db/migrate.js';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;

before(async () => {
  await migrate();
  app = await buildServer();
});

after(async () => {
  await app.close();
  await app.db.close();
});

test('GET /health reports ok with the database up', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { status: string; db: string; ts: string };
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'up');
  assert.ok(!Number.isNaN(Date.parse(body.ts)), 'ts is an ISO timestamp');
});

test('migrate() is idempotent — a second run applies nothing', async () => {
  const applied = await migrate();
  assert.deepEqual(applied, []);
});
