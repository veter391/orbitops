import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_ID, DEMO_KEY } from './helpers.js';

let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
  for (let i = 0; i < 5; i++) await app.audit.append(DEMO_ID, 'user:t', `evt-${i}`, { i });
});
after(async () => {
  await app.close();
});

interface Page {
  entries: { seq: number }[];
  nextCursor: number | null;
}

test('audit list is seek-paginated by cursor with full, non-overlapping coverage', async () => {
  const seen: number[] = [];
  let cursor: number | null = null;
  let pages = 0;

  do {
    const url = `/v1/audit?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
    const page = (await app.inject({ method: 'GET', url, headers: AUTH })).json() as Page;
    seen.push(...page.entries.map((e) => e.seq));
    cursor = page.nextCursor;
    if (++pages > 10) throw new Error('pagination did not terminate');
  } while (cursor !== null);

  // Newest-first, every seq exactly once, no gaps.
  assert.deepEqual(seen, [4, 3, 2, 1, 0]);
});

test('a full page yields a cursor; the last (partial) page yields null', async () => {
  const first = (await app.inject({ method: 'GET', url: '/v1/audit?limit=2', headers: AUTH })).json() as Page;
  assert.equal(first.nextCursor, 3); // full page → cursor is the last seq

  const last = (await app.inject({ method: 'GET', url: '/v1/audit?limit=99', headers: AUTH })).json() as Page;
  assert.equal(last.nextCursor, null); // partial page → no more
});
