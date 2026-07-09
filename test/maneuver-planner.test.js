import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avoidanceBurn, phasingBurn, stationKeepingBurn } from '../src/core/maneuver-planner.js';

test('avoidanceBurn: Δv scales linearly with altitude change; fuel is Tsiolkovsky', () => {
  const b = avoidanceBurn({}, 5);
  assert.equal(b.dvMs, 15); // 5 km × 3.0 m/s/km (demo model)
  assert.equal(b.direction, 'prograde');
  // Tsiolkovsky: dm = m·(e^(dv/ve) − 1), m = 200 kg dry, ve = 220 m/s.
  const expectedFuel = Number((200 * (Math.exp(15 / 220) - 1)).toFixed(3));
  assert.equal(b.fuelKg, expectedFuel);
});

test('avoidanceBurn: direction and monotonicity by sign/magnitude', () => {
  assert.equal(avoidanceBurn({}, -3).direction, 'retrograde');
  assert.equal(avoidanceBurn({}, 0).dvMs, 0);
  assert.ok(avoidanceBurn({}, 10).dvMs > avoidanceBurn({}, 4).dvMs, 'larger Δalt → larger Δv');
  // Fuel grows monotonically with Δv (convex, via the exponential).
  assert.ok(avoidanceBurn({}, 10).fuelKg > avoidanceBurn({}, 4).fuelKg);
});

test('avoidanceBurn output is always finite and well-formed', () => {
  for (const d of [-50, -1, 0, 1, 50]) {
    const b = avoidanceBurn({}, d);
    assert.ok(Number.isFinite(b.dvMs) && b.dvMs >= 0);
    assert.ok(Number.isFinite(b.fuelKg) && b.fuelKg >= 0);
    assert.ok(Number.isFinite(b.alternative.dvMs) && b.alternative.dvMs >= b.dvMs);
  }
});

test('phasingBurn and stationKeepingBurn return finite maneuvers', () => {
  const p = phasingBurn(30, {});
  assert.ok(Number.isFinite(p.dvMs) && p.dvMs >= 0, `phasing dvMs=${p.dvMs}`);
  const s = stationKeepingBurn({ altitude: 500 }, 505);
  assert.ok(Number.isFinite(s.dvMs) && s.dvMs >= 0, `stationkeeping dvMs=${s.dvMs}`);
});
