import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeAvoidanceBurn, avoidanceBurnAlternatives } from '../src/agents/maneuver.js';

test('sizes a positive delta-v and propellant to reach the safe miss distance', () => {
  const b = sizeAvoidanceBurn({ currentMissKm: 0.2, timeToTcaSec: 6 * 3600, safeMissKm: 1.0 });
  assert.equal(b.targetMissKm, 1.0);
  assert.ok(Math.abs(b.addedSeparationKm - 0.8) < 1e-9);
  assert.ok(b.deltaVMs > 0 && b.propellantKg > 0);
  // CW along-track: Δv ≈ Δs/(3Δt) = 800 m / (3·21600 s)
  assert.ok(Math.abs(b.deltaVMs - 800 / (3 * 21600)) < 1e-6);
});

test('already-safe encounters need no burn', () => {
  const b = sizeAvoidanceBurn({ currentMissKm: 5, timeToTcaSec: 3600, safeMissKm: 1.0 });
  assert.equal(b.addedSeparationKm, 0);
  assert.equal(b.deltaVMs, 0);
  assert.equal(b.propellantKg, 0);
});

test('less time to act costs more delta-v (and more propellant)', () => {
  const soon = sizeAvoidanceBurn({ currentMissKm: 0.2, timeToTcaSec: 1800 });
  const later = sizeAvoidanceBurn({ currentMissKm: 0.2, timeToTcaSec: 6 * 3600 });
  assert.ok(soon.deltaVMs > later.deltaVMs);
  assert.ok(soon.propellantKg > later.propellantKg);
});

test('propellant scales with spacecraft mass', () => {
  const light = sizeAvoidanceBurn({ currentMissKm: 0.2, timeToTcaSec: 3600, satMassKg: 100 });
  const heavy = sizeAvoidanceBurn({ currentMissKm: 0.2, timeToTcaSec: 3600, satMassKg: 1000 });
  assert.ok(heavy.propellantKg > light.propellantKg);
  assert.equal(light.deltaVMs, heavy.deltaVMs); // delta-v independent of mass
});

test('ranks avoidance-burn alternatives, cheapest first', () => {
  // With hours of lead time, along-track is the cheapest by far.
  const opts = avoidanceBurnAlternatives({ currentMissKm: 0.2, timeToTcaSec: 6 * 3600, safeMissKm: 1.0 });
  assert.equal(opts.length, 3);
  assert.equal(opts[0]!.direction, 'along-track');
  // Sorted ascending by delta-v.
  assert.ok(opts[0]!.deltaVMs <= opts[1]!.deltaVMs);
  assert.ok(opts[1]!.deltaVMs <= opts[2]!.deltaVMs);
  // Cross-track is the least fuel-efficient of the three.
  assert.equal(opts[2]!.direction, 'cross-track');
  for (const o of opts) assert.ok(o.deltaVMs > 0 && o.propellantKg > 0 && o.rationale.length > 0);
});

test('drops the along-track option when there is no lead time', () => {
  const opts = avoidanceBurnAlternatives({ currentMissKm: 0.2, timeToTcaSec: 0, safeMissKm: 1.0 });
  assert.equal(opts.length, 2); // only radial + cross-track remain
  assert.ok(!opts.some((o) => o.direction === 'along-track'));
});
