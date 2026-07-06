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

test('responses carry helmet security headers and rate-limit headers', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff'); // @fastify/helmet
  assert.ok(res.headers['x-ratelimit-limit'], 'rate-limit headers present'); // @fastify/rate-limit
});

test('oversized request body is rejected with 413, not a crash', async () => {
  const huge = 'x'.repeat(1_200_000); // > 1 MiB default bodyLimit
  const res = await app.inject({
    method: 'POST',
    url: '/v1/audit',
    headers: AUTH,
    payload: { actor: 'u', action: 'a', payload: { blob: huge } },
  });
  assert.equal(res.statusCode, 413);
  // Error shape is the fixed one, no internals leaked.
  assert.ok(!/stack|at .*\.ts:/.test(res.body));
});

test('serves an OpenAPI spec documenting the API and its auth scheme', async () => {
  const res = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(res.statusCode, 200);
  const spec = res.json() as {
    openapi: string;
    paths: Record<string, unknown>;
    components?: { securitySchemes?: Record<string, unknown> };
  };
  assert.match(spec.openapi, /^3\./);
  assert.ok(spec.paths['/v1/proposals'], 'documents the proposals endpoint');
  assert.ok(spec.components?.securitySchemes?.['apiKey'], 'documents the x-api-key scheme');
});

test('auth and validation still behave under the middleware stack', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/v1/proposals' })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/v1/proposals', headers: AUTH })).statusCode,
    200,
  );
});
