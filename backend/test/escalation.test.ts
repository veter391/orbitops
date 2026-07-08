import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessEscalation } from '../src/agents/escalation.js';

test('risk band sets the base escalation level', () => {
  assert.equal(assessEscalation({ riskBand: 'clear' }).level, 'routine');
  assert.equal(assessEscalation({ riskBand: 'watch' }).level, 'routine');
  assert.equal(assessEscalation({ riskBand: 'warning' }).level, 'elevated');
  const crit = assessEscalation({ riskBand: 'critical' });
  assert.equal(crit.level, 'urgent');
  assert.equal(crit.notify, true); // urgent+ pages on-call
});

test('an imminent TCA raises urgency', () => {
  // A warning-level risk with a <6h TCA becomes critical (two-step bump).
  const imminent = assessEscalation({ riskBand: 'warning', timeToTcaSec: 3 * 3600 });
  assert.equal(imminent.level, 'critical');
  assert.equal(imminent.notify, true);
  // A watch-level risk with a near-term (<24h) TCA becomes elevated.
  const nearTerm = assessEscalation({ riskBand: 'watch', timeToTcaSec: 12 * 3600 });
  assert.equal(nearTerm.level, 'elevated');
  // Plenty of lead time: no bump.
  assert.equal(assessEscalation({ riskBand: 'warning', timeToTcaSec: 5 * 86400 }).level, 'elevated');
});

test('non-conjunction severity drives the level when no risk band', () => {
  assert.equal(assessEscalation({ severity: 0.9 }).level, 'urgent');
  assert.equal(assessEscalation({ severity: 0.7 }).level, 'elevated');
  assert.equal(assessEscalation({ severity: 0.3 }).level, 'routine');
});

test('compliance flags bump the level and are cited', () => {
  const flagged = assessEscalation({ riskBand: 'warning', complianceFlagCount: 2 });
  assert.equal(flagged.level, 'urgent');
  assert.ok(flagged.reasons.some((r) => /compliance flag/.test(r)));
});

test('a nominal proposal is routine and does not page', () => {
  const nominal = assessEscalation({ riskBand: 'clear' });
  assert.equal(nominal.level, 'routine');
  assert.equal(nominal.notify, false);
  assert.ok(nominal.reasons.length > 0);
});
