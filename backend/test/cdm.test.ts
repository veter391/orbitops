import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { parseCdm, validateCdm, cdmToEncounter } from '../src/conjunction/cdm.js';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';

/**
 * A realistic CCSDS 508.0-B-1 CDM (KVN). High-risk geometry: 145 m miss with
 * ~158 m combined in-plane 1σ, TCA three hours after creation. Includes COMMENT
 * lines and [unit] suffixes so the parser's cleaning is exercised.
 */
const SAMPLE_CDM = `CCSDS_CDM_VERS = 1.0
COMMENT screening for the OrbitOps demo fleet
CREATION_DATE = 2026-07-02T12:00:00.000
ORIGINATOR = 18 SDS
MESSAGE_ID = 00001
TCA = 2026-07-02T15:00:00.000
MISS_DISTANCE = 145 [m]
RELATIVE_SPEED = 14200 [m/s]
OBJECT = OBJECT1
OBJECT_DESIGNATOR = 25544
OBJECT_NAME = DEMOSAT-A
CR_R = 10000 [m**2]
CT_T = 40000 [m**2]
OBJECT = OBJECT2
OBJECT_DESIGNATOR = 33333
OBJECT_NAME = DEBRIS-B
CR_R = 10000 [m**2]
CT_T = 40000 [m**2]
`;

test('parseCdm splits meta and per-object blocks, strips units and comments', () => {
  const cdm = parseCdm(SAMPLE_CDM);
  assert.equal(cdm.meta['CCSDS_CDM_VERS'], '1.0');
  assert.equal(cdm.meta['MISS_DISTANCE'], '145'); // [m] stripped
  assert.equal(cdm.meta['TCA'], '2026-07-02T15:00:00.000');
  assert.equal(cdm.meta['ORIGINATOR'], '18 SDS');
  // COMMENT lines never become keys.
  assert.equal(cdm.meta['COMMENT'], undefined);
  // Per-object context: same keys land in the right bag.
  assert.equal(cdm.object1['OBJECT_DESIGNATOR'], '25544');
  assert.equal(cdm.object2['OBJECT_DESIGNATOR'], '33333');
  assert.equal(cdm.object1['CR_R'], '10000');
  assert.equal(cdm.object2['CT_T'], '40000');
});

test('cdmToEncounter maps geometry, time-to-TCA, and first-order sigma', () => {
  const enc = cdmToEncounter(parseCdm(SAMPLE_CDM));
  assert.equal(enc.missDistanceKm, 0.145);
  assert.equal(enc.timeToTcaSec, 3 * 3600); // 12:00 → 15:00
  assert.equal(enc.combinedRadiusKm, 0.02); // no HBR → default 20 m
  // Combined covariance C1+C2: varR=10000+10000, varT=40000+40000; effective
  // isotropic 1σ = sqrt((varR+varT)/2)/1000 = sqrt(50000)/1000 km.
  assert.ok(enc.sigmaKm !== undefined);
  assert.ok(Math.abs(enc.sigmaKm! - Math.sqrt(50000) / 1000) < 1e-9);
  assert.equal(enc.object1Designator, '25544');
  assert.equal(enc.object2Designator, '33333');
  assert.equal(enc.tca, '2026-07-02T15:00:00.000');
});

test('cdmToEncounter honors per-object HBR when present', () => {
  const withHbr = SAMPLE_CDM.replace('CR_R = 10000 [m**2]\nCT_T = 40000 [m**2]\nOBJECT = OBJECT2',
    'CR_R = 10000 [m**2]\nCT_T = 40000 [m**2]\nHBR = 5 [m]\nOBJECT = OBJECT2');
  const enc = cdmToEncounter(parseCdm(withHbr));
  // object1 HBR 5 m + object2 none → 5 m = 0.005 km.
  assert.equal(enc.combinedRadiusKm, 0.005);
});

test('cdmToEncounter yields no sigma when covariance is absent', () => {
  const noCov = `CCSDS_CDM_VERS = 1.0
CREATION_DATE = 2026-07-02T12:00:00.000
TCA = 2026-07-02T13:00:00.000
MISS_DISTANCE = 500 [m]
OBJECT = OBJECT1
OBJECT_DESIGNATOR = 25544
OBJECT = OBJECT2
OBJECT_DESIGNATOR = 33333
`;
  const enc = cdmToEncounter(parseCdm(noCov));
  assert.equal(enc.sigmaKm, undefined);
  assert.equal(enc.missDistanceKm, 0.5);
});

test('cdmToEncounter yields no sigma when only one object has covariance', () => {
  // object1 fully covered, object2 covariance absent — must NOT masquerade as a
  // fully-known combined uncertainty; sigma is undefined (severity-hint fallback).
  const oneSided = `CCSDS_CDM_VERS = 1.0
CREATION_DATE = 2026-07-02T12:00:00.000
TCA = 2026-07-02T13:00:00.000
MISS_DISTANCE = 300 [m]
OBJECT = OBJECT1
OBJECT_DESIGNATOR = 25544
CR_R = 10000 [m**2]
CT_T = 40000 [m**2]
OBJECT = OBJECT2
OBJECT_DESIGNATOR = 33333
`;
  assert.equal(cdmToEncounter(parseCdm(oneSided)).sigmaKm, undefined);
});

test('parseCdm routes only OBJECT1/OBJECT2; an unknown tag never corrupts object1', () => {
  const mistagged = `CCSDS_CDM_VERS = 1.0
MISS_DISTANCE = 100 [m]
OBJECT = OBJECT1
OBJECT_DESIGNATOR = 25544
OBJECT = OBJECT3
OBJECT_DESIGNATOR = 99999
`;
  const cdm = parseCdm(mistagged);
  assert.equal(cdm.object1['OBJECT_DESIGNATOR'], '25544'); // object1 intact
  assert.equal(cdm.object2['OBJECT_DESIGNATOR'], undefined); // OBJECT3 discarded
});

test('validateCdm flags missing fields and non-physical values', () => {
  const good = validateCdm(parseCdm(SAMPLE_CDM));
  assert.deepEqual(good, []);

  const negMiss = parseCdm(SAMPLE_CDM.replace('MISS_DISTANCE = 145 [m]', 'MISS_DISTANCE = -50 [m]'));
  assert.ok(validateCdm(negMiss).some((p) => /non-negative/.test(p)));

  const empty = validateCdm(parseCdm('CCSDS_CDM_VERS = 1.0\n'));
  assert.ok(empty.includes('missing TCA'));
  assert.ok(empty.includes('missing MISS_DISTANCE'));
  assert.ok(empty.includes('missing OBJECT1 designator'));
  assert.ok(empty.includes('missing OBJECT2 designator'));
});

test('validateCdm rejects physically-implausible HBR and covariance (DoS/overflow guard)', () => {
  // A huge HBR would blow up the Pc integration domain; a huge covariance would
  // overflow to an Infinity sigma. Both must be rejected before scoring.
  const bigHbr = SAMPLE_CDM.replace('CR_R = 10000 [m**2]', 'HBR = 1e200 [m]\nCR_R = 10000 [m**2]');
  assert.ok(validateCdm(parseCdm(bigHbr)).some((p) => /HBR is implausible/.test(p)));

  const bigCov = SAMPLE_CDM.replace('CR_R = 10000 [m**2]', 'CR_R = 1e300 [m**2]');
  assert.ok(validateCdm(parseCdm(bigCov)).some((p) => /covariance is implausible/.test(p)));
});

// ── Route: POST /v1/conjunctions/cdm ─────────────────────────────────────────
let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

interface CdmRunResult {
  encounter: { missDistanceKm: number; sigmaKm?: number };
  proposal: { status: string; proposedAction: Record<string, unknown> };
  path: string[];
}

test('POST /v1/conjunctions/cdm screens the encounter and returns a pending proposal', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    headers: AUTH,
    payload: { cdm: SAMPLE_CDM },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as CdmRunResult;

  // Real geometry made it through to the agent.
  assert.equal(body.encounter.missDistanceKm, 0.145);
  assert.ok(body.path.includes('conjunctionScreener'), `path: ${body.path.join('→')}`);
  // A real Pc was computed and is a probability.
  const pc = body.proposal.proposedAction['pc'];
  assert.equal(typeof pc, 'number');
  assert.ok((pc as number) > 0 && (pc as number) <= 1);
  // SAFETY INVARIANT — never auto-executes; a human must approve.
  assert.equal(body.proposal.status, 'pending');
});

test('POST /v1/conjunctions/cdm rejects an empty body', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    headers: AUTH,
    payload: { cdm: '' },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /v1/conjunctions/cdm rejects a structurally invalid CDM (400, not a verdict)', async () => {
  // A well-formed string that parses but is missing mandatory fields must be
  // rejected, never silently scored into a default "critical"/"clear" verdict.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    headers: AUTH,
    payload: { cdm: 'CCSDS_CDM_VERS = 1.0\nORIGINATOR = 18 SDS\n' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'invalid CDM');
});

test('POST /v1/conjunctions/cdm rejects a negative miss distance (no fail-open clear)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    headers: AUTH,
    payload: { cdm: SAMPLE_CDM.replace('MISS_DISTANCE = 145 [m]', 'MISS_DISTANCE = -145 [m]') },
  });
  assert.equal(res.statusCode, 400);
});

test('POST /v1/conjunctions/cdm requires authentication', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    payload: { cdm: SAMPLE_CDM },
  });
  assert.equal(res.statusCode, 401);
});
