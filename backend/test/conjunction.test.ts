import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probabilityOfCollision, riskBand, bandLikelihood } from '../src/agents/conjunction.js';

test('Pc is in [0,1] and 0 for degenerate inputs', () => {
  const pc = probabilityOfCollision({ missDistanceKm: 0.5, sigmaKm: 0.2, combinedRadiusKm: 0.02 });
  assert.ok(pc >= 0 && pc <= 1);
  assert.equal(probabilityOfCollision({ missDistanceKm: 1, sigmaKm: 0, combinedRadiusKm: 0.02 }), 0); // σ=0
  assert.equal(probabilityOfCollision({ missDistanceKm: 1, sigmaKm: 0.2, combinedRadiusKm: 0 }), 0); // R=0
  assert.equal(probabilityOfCollision({ missDistanceKm: NaN, sigmaKm: 0.2, combinedRadiusKm: 0.02 }), 0);
});

test('Pc falls as miss distance grows and rises as combined radius grows', () => {
  const near = probabilityOfCollision({ missDistanceKm: 0.1, sigmaKm: 0.2, combinedRadiusKm: 0.02 });
  const far = probabilityOfCollision({ missDistanceKm: 2.0, sigmaKm: 0.2, combinedRadiusKm: 0.02 });
  assert.ok(near > far, `near(${near}) should exceed far(${far})`);

  const small = probabilityOfCollision({ missDistanceKm: 0.3, sigmaKm: 0.2, combinedRadiusKm: 0.01 });
  const big = probabilityOfCollision({ missDistanceKm: 0.3, sigmaKm: 0.2, combinedRadiusKm: 0.05 });
  assert.ok(big > small, `bigger combined radius should raise Pc`);
});

test('a near, tight-uncertainty encounter is a real, non-trivial Pc', () => {
  // head-on, σ=100m, combined radius 20m → clearly elevated risk
  const pc = probabilityOfCollision({ missDistanceKm: 0, sigmaKm: 0.1, combinedRadiusKm: 0.02 });
  assert.ok(pc > 1e-3, `expected elevated Pc, got ${pc}`);
  assert.equal(riskBand(pc), 'critical');
});

test('risk bands follow the Pc thresholds', () => {
  assert.equal(riskBand(2e-3), 'critical');
  assert.equal(riskBand(2e-4), 'warning');
  assert.equal(riskBand(2e-5), 'watch');
  assert.equal(riskBand(1e-6), 'clear');
  assert.ok(bandLikelihood('critical') > bandLikelihood('warning'));
  assert.ok(bandLikelihood('warning') > bandLikelihood('watch'));
  assert.ok(bandLikelihood('watch') > bandLikelihood('clear'));
});
