import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeAvoidanceBurn } from '../src/agents/maneuver.js';

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
