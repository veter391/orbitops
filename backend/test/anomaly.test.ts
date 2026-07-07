import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomaly } from '../src/agents/anomaly.js';

const NOMINAL = [27.0, 27.1, 26.9, 27.05, 26.95, 27.02, 26.98, 27.03];

test('a reading far outside the baseline is flagged with a large z-score', () => {
  const a = detectAnomaly(20.0, NOMINAL); // battery collapsed from ~27V
  assert.equal(a.isAnomaly, true);
  assert.ok(Math.abs(a.zscore) >= 3.5, `|z|=${a.zscore}`);
  assert.ok(a.severity > 0.5 && a.severity <= 1);
});

test('a reading in family is nominal, low z-score', () => {
  const a = detectAnomaly(27.02, NOMINAL);
  assert.equal(a.isAnomaly, false);
  assert.ok(Math.abs(a.zscore) < 3.5);
});

test('too little history does not fire (n reported)', () => {
  const a = detectAnomaly(100, [1, 2]);
  assert.equal(a.isAnomaly, false);
  assert.equal(a.n, 2);
});

test('a constant baseline still flags a deviation (no divide-by-zero)', () => {
  const a = detectAnomaly(5, [1, 1, 1, 1, 1]); // MAD = 0
  assert.equal(a.isAnomaly, true);
  assert.ok(Number.isFinite(a.zscore));
});

test('severity grows with deviation and stays in [0,1]', () => {
  const near = detectAnomaly(28, NOMINAL).severity;
  const far = detectAnomaly(15, NOMINAL).severity;
  assert.ok(far >= near);
  assert.ok(far >= 0 && far <= 1 && near >= 0 && near <= 1);
});
