import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import {
  orbitalLifetimeYears,
  ballisticCoefficient,
  assessDeorbitCompliance,
} from '../src/orbital/decay.js';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';

/**
 * Orbital-lifetime estimates are order-of-magnitude by nature (published sources
 * disagree by up to ~10× because solar activity and the ballistic coefficient
 * dominate). So these tests pin ORDER-OF-MAGNITUDE bands and monotonicity, not
 * tight point values — the model is calibrated to the AgentCalc closed-form
 * table (400 km, B=100 → ~10 yr) and cross-checked against SpaceAcademy.
 */
test('orbital lifetime lands in the right order-of-magnitude band per altitude', () => {
  // 200 km: days to ~a year.
  const low = orbitalLifetimeYears(200, 45);
  assert.ok(low > 0.02 && low < 1, `200 km ${low} yr`);
  // 400 km, B=100: ~a decade (the calibration anchor).
  const mid = orbitalLifetimeYears(400, 100);
  assert.ok(mid > 3 && mid < 30, `400 km ${mid} yr`);
  // 500 km, B=100: decades.
  const hi = orbitalLifetimeYears(500, 100);
  assert.ok(hi > 10 && hi < 200, `500 km ${hi} yr`);
  // 800 km: centuries or more.
  const veryHi = orbitalLifetimeYears(800, 100);
  assert.ok(veryHi > 100, `800 km ${veryHi} yr`);
});

test('lifetime is monotonic in altitude and in ballistic coefficient', () => {
  assert.ok(orbitalLifetimeYears(300, 100) < orbitalLifetimeYears(600, 100), 'higher orbit lives longer');
  assert.ok(orbitalLifetimeYears(400, 50) < orbitalLifetimeYears(400, 200), 'higher B (less drag/mass) lives longer');
  // Degenerate inputs return 0, not NaN.
  assert.equal(orbitalLifetimeYears(0, 100), 0);
  assert.equal(orbitalLifetimeYears(400, 0), 0);
});

test('ballistic coefficient is m/(Cd·A)', () => {
  assert.ok(Math.abs(ballisticCoefficient(220, 1, 2.2) - 100) < 1e-9);
  assert.equal(ballisticCoefficient(0, 1), 45); // default on bad input
});

test('deorbit compliance: a low orbit clears the 5-year rule, a high orbit does not', () => {
  const low = assessDeorbitCompliance({ altitudeKm: 200, ballisticKgM2: 45, appliesFiveYearRule: true });
  assert.equal(low.compliantPassively, true);
  assert.equal(low.regime, '5-year');
  assert.equal(low.disposalWindowYears, 5);

  const high = assessDeorbitCompliance({ altitudeKm: 600, ballisticKgM2: 100, appliesFiveYearRule: true });
  assert.equal(high.compliantPassively, false);
  assert.equal(high.requiresActiveDisposal, true);
});

test('deorbit compliance flags a borderline case (band straddles the deadline)', () => {
  // ~400 km, B=45 → lifetime ~4.8 yr: point estimate clears 5 yr, but the
  // uncertainty band spans it, so it must not be reported as safely compliant.
  const a = assessDeorbitCompliance({ altitudeKm: 400, ballisticKgM2: 45, appliesFiveYearRule: true });
  assert.ok(a.lifetimeBandYears[0] <= 5 && a.lifetimeBandYears[1] > 5, 'band straddles the deadline');
  assert.equal(a.borderline, true);
  assert.equal(a.requiresActiveDisposal, true);
});

test('the grandfathered 25-year regime is more permissive than the 5-year rule', () => {
  const params = { altitudeKm: 450, ballisticKgM2: 100 } as const;
  const fiveYr = assessDeorbitCompliance({ ...params, appliesFiveYearRule: true });
  const legacy = assessDeorbitCompliance({ ...params, appliesFiveYearRule: false });
  assert.equal(fiveYr.regime, '5-year');
  assert.equal(legacy.regime, '25-year');
  assert.equal(legacy.disposalWindowYears, 25);
  // Same orbit: the legacy window is at least as forgiving.
  assert.ok(!(fiveYr.compliantPassively && !legacy.compliantPassively));
});

// ── Route ────────────────────────────────────────────────────────────────────
let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

test('POST /v1/compliance/deorbit returns an assessment (auth required)', async () => {
  const unauth = await app.inject({ method: 'POST', url: '/v1/compliance/deorbit', payload: { altitudeKm: 500 } });
  assert.equal(unauth.statusCode, 401);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/compliance/deorbit',
    headers: AUTH,
    payload: { altitudeKm: 600, ballisticKgM2: 100, appliesFiveYearRule: true },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.regime, '5-year');
  assert.equal(body.compliantPassively, false);
  assert.ok(body.lifetimeYears > 100);

  // mass + area compute the ballistic coefficient.
  const withMass = await app.inject({
    method: 'POST',
    url: '/v1/compliance/deorbit',
    headers: AUTH,
    payload: { altitudeKm: 400, massKg: 220, areaM2: 1, cd: 2.2 },
  });
  assert.equal(withMass.statusCode, 200);
  assert.ok(withMass.json().lifetimeYears > 3);

  const bad = await app.inject({ method: 'POST', url: '/v1/compliance/deorbit', headers: AUTH, payload: { altitudeKm: -1 } });
  assert.equal(bad.statusCode, 400);
});
