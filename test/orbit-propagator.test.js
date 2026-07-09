import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveKepler, stateToElements, distanceKm, CONSTANTS } from '../src/core/orbit-propagator.js';

const { MU, EARTH_RADIUS_KM } = CONSTANTS;

test('CONSTANTS match WGS84', () => {
  assert.equal(MU, 398600.4418);
  assert.equal(EARTH_RADIUS_KM, 6378.137);
});

test("solveKepler satisfies Kepler's equation E - e·sinE = M", () => {
  for (const M of [0, 0.5, 1, 2, 3, 5, 6]) {
    for (const e of [0, 0.01, 0.1, 0.3, 0.7, 0.9]) {
      const E = solveKepler(M, e);
      const residual = E - e * Math.sin(E) - (((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
      assert.ok(Math.abs(residual) < 1e-8, `M=${M} e=${e} residual=${residual}`);
    }
  }
  assert.ok(Math.abs(solveKepler(1.2345, 0) - 1.2345) < 1e-12, 'e=0 → E=M');
});

test('stateToElements recovers a circular equatorial orbit', () => {
  const R = EARTH_RADIUS_KM + 500; // 500 km altitude
  const vc = Math.sqrt(MU / R); // circular speed
  const el = stateToElements({ x: R, y: 0, z: 0 }, { x: 0, y: vc, z: 0 });
  assert.ok(el.eccentricity < 1e-6, `e=${el.eccentricity}`);
  assert.ok(el.inclination < 1e-6, `i=${el.inclination}`);
  // Mean motion equals sqrt(MU/a^3) with a = R for a circular orbit.
  assert.ok(Math.abs(el.meanMotion - Math.sqrt(MU / (R * R * R))) < 1e-9);
});

test('stateToElements recovers the inclination of an inclined circular orbit', () => {
  const R = EARTH_RADIUS_KM + 800;
  const vc = Math.sqrt(MU / R);
  const inc = (51.6 * Math.PI) / 180;
  const el = stateToElements({ x: R, y: 0, z: 0 }, { x: 0, y: vc * Math.cos(inc), z: vc * Math.sin(inc) });
  assert.ok(Math.abs(el.inclination - inc) < 1e-6, `i=${el.inclination} vs ${inc}`);
  assert.ok(el.eccentricity < 1e-6);
});

test('distanceKm is a correct Euclidean distance', () => {
  assert.equal(distanceKm({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(distanceKm({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), 0);
});
