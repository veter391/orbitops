import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, createCustomer, DEMO_KEY } from './helpers.js';
import type { Db } from '../src/db/index.js';

/**
 * Feedback capture: the pricing "should we build this?" brief. The POST is
 * public (a prospect has no operator account); the GET is admin-only. The demo
 * operator is intentionally NOT an admin (migration 012 downgraded it so the
 * auto-shipped demo key can't read the feedback table), so a separate real admin
 * operator is created here to exercise the read path.
 */
let app: FastifyInstance;
let db: Db;
const ADMIN = { 'x-api-key': 'admin-key' }; // promoted to the admin role in before()

before(async () => {
  db = await freshDb();
  await createCustomer(db, 'regular-co', 'regular-key'); // default role 'operator'
  await createCustomer(db, 'owner-co', 'admin-key');
  // Promote owner-co's operator to admin (createCustomer names it '<name> operator').
  await db.query("UPDATE operators SET role = 'admin' WHERE name = 'owner-co operator'");
  app = await buildServer(db);
});
after(async () => {
  await app.close();
});

test('POST /v1/feedback is public (no API key) and stores the submission', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/feedback',
    payload: {
      kind: 'pricing',
      source: 'pricing-page',
      tier: 'Growth',
      wantsCloud: 'Yes, hosted',
      fleetSize: '40 satellites',
      note: 'Only if SOC 2 ships.',
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(typeof body.id === 'string' && body.id.length > 0);
});

test('GET /v1/feedback requires the admin role; non-admins (incl. the demo operator) are forbidden', async () => {
  const unauth = await app.inject({ method: 'GET', url: '/v1/feedback' });
  assert.equal(unauth.statusCode, 401);

  // A regular operator → 403.
  const regular = await app.inject({ method: 'GET', url: '/v1/feedback', headers: { 'x-api-key': 'regular-key' } });
  assert.equal(regular.statusCode, 403);

  // The demo operator is intentionally NOT admin (migration 012) → 403. This is the
  // security guarantee: the auto-shipped demo key can never reach the feedback table.
  const demo = await app.inject({ method: 'GET', url: '/v1/feedback', headers: { 'x-api-key': DEMO_KEY } });
  assert.equal(demo.statusCode, 403);

  // A real admin operator → 200 with the data.
  const res = await app.inject({ method: 'GET', url: '/v1/feedback', headers: ADMIN });
  assert.equal(res.statusCode, 200);
  const { feedback } = res.json();
  assert.ok(Array.isArray(feedback) && feedback.length >= 1);
  const found = feedback.find((f: { tier: string }) => f.tier === 'Growth');
  assert.ok(found, 'the submitted feedback is returned');
  assert.equal(found.wantsCloud, 'Yes, hosted');
  assert.equal(found.note, 'Only if SOC 2 ships.');
});

test('POST /v1/feedback rejects an invalid body (missing kind)', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { note: 'hi' } });
  assert.equal(res.statusCode, 400);
});

test('POST /v1/feedback rejects an over-long note', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/feedback',
    payload: { kind: 'pricing', note: 'x'.repeat(2001) },
  });
  assert.equal(res.statusCode, 400);
});

test('feedback is not tenant-scoped: stored payload is returned verbatim, not HTML-executed', async () => {
  // A script-like note must be stored and returned as plain data (JSON), never
  // interpreted — the API returns JSON, and the browser escapes on render.
  const payloadNote = '<script>alert(1)</script>';
  await app.inject({ method: 'POST', url: '/v1/feedback', payload: { kind: 'pricing', note: payloadNote } });
  const res = await app.inject({ method: 'GET', url: '/v1/feedback', headers: ADMIN });
  const { feedback } = res.json();
  const found = feedback.find((f: { note: string }) => f.note === payloadNote);
  assert.ok(found, 'stored verbatim as data');
});
