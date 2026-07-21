// Unit table for the SEO route-metadata resolver shared by the browser and the
// edge worker. Locks the behavior an adversarial review flagged: unknown paths
// — including unregistered /docs/* subpaths, which the SPA renders as the home
// view — must resolve to HOME metadata and a HOME canonical, never a
// self-referential URL the router can't serve.
'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRouteMeta, isKnownRoute, ROUTE_META, CANONICAL_ORIGIN } from '../src/core/route-meta.js';

test('every registered route self-canonicalizes with its own title', () => {
  for (const path of Object.keys(ROUTE_META)) {
    assert.equal(isKnownRoute(path), true, `${path} should be known`);
    const m = resolveRouteMeta(path);
    assert.equal(m.title, ROUTE_META[path][0]);
    assert.equal(m.description, ROUTE_META[path][1]);
    assert.equal(m.canonical, `${CANONICAL_ORIGIN}${path}`);
  }
});

test('home resolves to its own metadata', () => {
  const m = resolveRouteMeta('/');
  assert.equal(m.title, ROUTE_META['/'][0]);
  assert.equal(m.canonical, `${CANONICAL_ORIGIN}/`);
});

test('an unknown top-level path falls back to home metadata + home canonical', () => {
  const m = resolveRouteMeta('/totally-unknown');
  assert.equal(isKnownRoute('/totally-unknown'), false);
  assert.equal(m.title, ROUTE_META['/'][0]);
  assert.equal(m.description, ROUTE_META['/'][1]);
  assert.equal(m.canonical, `${CANONICAL_ORIGIN}/`);
});

test('an unregistered /docs/* subpath is NOT self-canonical — it maps to home', () => {
  // /docs/quickstart is an in-page sidebar switch, not a clean-URL route.
  const m = resolveRouteMeta('/docs/quickstart');
  assert.equal(isKnownRoute('/docs/quickstart'), false);
  assert.equal(m.title, ROUTE_META['/'][0], 'must NOT be the Docs title');
  assert.equal(m.canonical, `${CANONICAL_ORIGIN}/`, 'must NOT self-canonicalize');
});

test('registered /docs subpages keep their own canonical', () => {
  const m = resolveRouteMeta('/docs/going-live');
  assert.equal(isKnownRoute('/docs/going-live'), true);
  assert.equal(m.canonical, `${CANONICAL_ORIGIN}/docs/going-live`);
});

test('a trailing slash is normalized to the registered route', () => {
  assert.equal(isKnownRoute('/cockpit/'), true);
  const m = resolveRouteMeta('/cockpit/');
  assert.equal(m.title, ROUTE_META['/cockpit'][0]);
  assert.equal(m.canonical, `${CANONICAL_ORIGIN}/cockpit`);
});
