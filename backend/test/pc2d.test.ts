import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probabilityOfCollision2D, rDotV, type ObjectState } from '../src/conjunction/pc2d.js';

/**
 * Validate the full-covariance 2D Pc against NASA CARA's own reference unit-test
 * vector (the "Omitron" case, D. Plakalovic — nasa/CARA_Analysis_Tools,
 * Pc2D_Foster_UnitTest.m). The inputs and the expected Pc are transcribed
 * verbatim from that self-contained test; NASA's own tolerance is 1e-3 relative.
 */
const OMITRON_1: ObjectState = {
  r: [378.39559, 4305.721887, 5752.767554],
  v: [2.360800244, 5.580331936, -4.322349039],
  cov: [
    [44.5757544811362, 81.6751751052616, -67.8687662707124],
    [81.6751751052616, 158.453402956163, -128.616921644857],
    [-67.8687662707124, -128.616921644858, 105.490542562701],
  ],
};
const OMITRON_2: ObjectState = {
  r: [374.5180598, 4307.560983, 5751.130418],
  v: [-5.388125081, -3.946827739, 3.322820358],
  cov: [
    [2.31067077720423, 1.69905293875632, -1.4170164577661],
    [1.69905293875632, 1.24957388457206, -1.04174164279599],
    [-1.4170164577661, -1.04174164279599, 0.869260558223714],
  ],
};
const OMITRON_HBR_KM = 0.02; // 20 m combined
const OMITRON_EXPECTED_PC = 2.70601573490125e-5;

test('pc2d matches the NASA CARA Omitron reference vector', () => {
  const res = probabilityOfCollision2D(OMITRON_1, OMITRON_2, OMITRON_HBR_KM);
  const relErr = Math.abs(res.pc - OMITRON_EXPECTED_PC) / OMITRON_EXPECTED_PC;
  assert.ok(relErr < 1e-4, `Pc ${res.pc} vs ${OMITRON_EXPECTED_PC} (rel err ${relErr})`);
  // Projection sanity: miss and encounter-plane principal sigmas from the source.
  assert.ok(Math.abs(res.missKm - 4.59323) < 1e-3, `missKm ${res.missKm}`);
  assert.ok(Math.abs(res.sigmaMinKm - 0.808) < 5e-3, `sigmaMin ${res.sigmaMinKm}`);
  assert.ok(Math.abs(res.sigmaMaxKm - 3.398) < 5e-3, `sigmaMax ${res.sigmaMaxKm}`);
});

test('the Omitron states are at TCA (relative position ⟂ relative velocity)', () => {
  // |r·v| ≪ |r||v|, confirming the short-term-encounter TCA assumption holds.
  const rv = Math.abs(rDotV(OMITRON_1, OMITRON_2));
  assert.ok(rv < 1e-1, `r·v = ${rv} should be ~0 at TCA`);
});

test('pc2d stays a probability and handles degenerate inputs', () => {
  const res = probabilityOfCollision2D(OMITRON_1, OMITRON_2, OMITRON_HBR_KM);
  assert.ok(res.pc >= 0 && res.pc <= 1);
  // Zero combined radius → zero collision probability (no hard-body area).
  assert.equal(probabilityOfCollision2D(OMITRON_1, OMITRON_2, 0).pc, 0);
});

test('pc2d rises monotonically with a larger hard-body radius', () => {
  const small = probabilityOfCollision2D(OMITRON_1, OMITRON_2, 0.02).pc;
  const large = probabilityOfCollision2D(OMITRON_1, OMITRON_2, 0.1).pc;
  assert.ok(large > small, `Pc should grow with HBR: ${small} -> ${large}`);
});
