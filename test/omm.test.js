import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleChecksum, isOmm, parseOmm, parseOmmJson, ommToTle } from '../src/core/omm.js';

// Canonical ISS TLE (Vallado / CelesTrak textbook example); both lines' final
// digit is the mod-10 checksum over columns 1-68.
const ISS_L1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
const ISS_L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';

test('tleChecksum reproduces the canonical checksum digit', () => {
  assert.equal(tleChecksum(ISS_L1.slice(0, 68)), 7);
  assert.equal(tleChecksum(ISS_L2.slice(0, 68)), 7);
  // A minus sign counts as 1 in the checksum.
  assert.equal(tleChecksum('-'), 1);
});

test('isOmm recognizes OMM (json + kvn) and rejects a raw TLE', () => {
  assert.equal(isOmm('[{"NORAD_CAT_ID":25544}]'), true);
  assert.equal(isOmm('CCSDS_OMM_VERS = 1.0\nMEAN_MOTION = 15.5'), true);
  assert.equal(isOmm(`${ISS_L1}\n${ISS_L2}`), false);
});

const ISS_OMM = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2024-01-01T00:00:00.000000',
  MEAN_MOTION: 15.5,
  ECCENTRICITY: 0.0007,
  INCLINATION: 51.64,
  RA_OF_ASC_NODE: 247.46,
  ARG_OF_PERICENTER: 130.53,
  MEAN_ANOMALY: 325.02,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  BSTAR: 0.0001,
  MEAN_MOTION_DOT: -0.00002182,
  MEAN_MOTION_DDOT: 0,
};

test('ommToTle emits a well-formed, self-consistent TLE', () => {
  const { line1, line2, noradId, name } = ommToTle(ISS_OMM);
  assert.equal(name, 'ISS (ZARYA)');
  assert.equal(noradId, 25544);
  assert.ok(line1.startsWith('1 25544U'), `line1: ${line1}`);
  assert.ok(line2.startsWith('2 25544'), `line2: ${line2}`);
  // Each generated line's final digit must equal its own checksum (never fabricated).
  assert.equal(Number(line1[68]), tleChecksum(line1.slice(0, 68)));
  assert.equal(Number(line2[68]), tleChecksum(line2.slice(0, 68)));
  // Inclination is encoded in columns 9-16 of line 2.
  assert.equal(line2.slice(8, 16).trim(), '51.6400');
  // Both lines are exactly 69 columns.
  assert.equal(line1.length, 69);
  assert.equal(line2.length, 69);
});

test('ommToTle throws on non-finite elements (never fabricate a NaN TLE)', () => {
  assert.throws(() => ommToTle({ ...ISS_OMM, MEAN_MOTION: NaN }), /non-finite/);
  assert.throws(() => ommToTle({ ...ISS_OMM, EPOCH: 'not-a-date' }), /EPOCH/);
});

test('parseOmmJson round-trips a catalog and skips malformed records', () => {
  const bad = { ...ISS_OMM, NORAD_CAT_ID: null };
  const recs = parseOmmJson(JSON.stringify([ISS_OMM, bad]));
  assert.equal(recs.length, 1, 'the malformed record is dropped, not fabricated');
  assert.equal(recs[0].noradId, 25544);
});

test('parseOmm dispatches json vs kvn by content', () => {
  const viaJson = parseOmm(JSON.stringify([ISS_OMM]));
  assert.equal(viaJson.length, 1);
  assert.equal(viaJson[0].noradId, 25544);
});
