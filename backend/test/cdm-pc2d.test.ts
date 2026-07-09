import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { parseCdm, cdmToPc2dInput } from '../src/conjunction/cdm.js';
import { probabilityOfCollision2D, type Vec3, type Mat3 } from '../src/conjunction/pc2d.js';
import { buildServer } from '../src/server.js';
import { freshDb, DEMO_KEY } from './helpers.js';

/**
 * End-to-end validation of the CDM → full-covariance Pc pipeline. We take NASA
 * CARA's Omitron reference states + ECI covariances, convert the covariances to
 * the RTN frame (the inverse of what the parser does), embed everything in a
 * real CDM (KVN), and confirm that parsing it back — states + RTN→ECI covariance
 * rotation — and running pc2d reproduces NASA's reference Pc. This exercises the
 * whole chain (state parse, frame construction, RTN→ECI rotation, integration).
 */
const O1 = {
  r: [378.39559, 4305.721887, 5752.767554] as Vec3,
  v: [2.360800244, 5.580331936, -4.322349039] as Vec3,
  cov: [
    [44.5757544811362, 81.6751751052616, -67.8687662707124],
    [81.6751751052616, 158.453402956163, -128.616921644857],
    [-67.8687662707124, -128.616921644858, 105.490542562701],
  ] as Mat3,
};
const O2 = {
  r: [374.5180598, 4307.560983, 5751.130418] as Vec3,
  v: [-5.388125081, -3.946827739, 3.322820358] as Vec3,
  cov: [
    [2.31067077720423, 1.69905293875632, -1.4170164577661],
    [1.69905293875632, 1.24957388457206, -1.04174164279599],
    [-1.4170164577661, -1.04174164279599, 0.869260558223714],
  ] as Mat3,
};
const NASA_PC = 2.70601573490125e-5;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const abcT = (A: Mat3, C: Mat3): Mat3 => {
  const mul = (r: Vec3): Vec3 => [
    r[0] * C[0][0] + r[1] * C[1][0] + r[2] * C[2][0],
    r[0] * C[0][1] + r[1] * C[1][1] + r[2] * C[2][1],
    r[0] * C[0][2] + r[1] * C[1][2] + r[2] * C[2][2],
  ];
  const m = [mul(A[0]), mul(A[1]), mul(A[2])] as Mat3;
  const d = (x: Vec3, y: Vec3): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  return [
    [d(m[0], A[0]), d(m[0], A[1]), d(m[0], A[2])],
    [d(m[1], A[0]), d(m[1], A[1]), d(m[1], A[2])],
    [d(m[2], A[0]), d(m[2], A[1]), d(m[2], A[2])],
  ];
};

/** Emit one CDM object block, converting the ECI covariance to RTN (m²). */
function objBlock(tag: string, o: { r: Vec3; v: Vec3; cov: Mat3 }, des: number): string {
  const Rh = unit(o.r);
  const Nh = unit(cross(o.r, o.v));
  const Th = cross(Nh, Rh);
  const Crtn = abcT([Rh, Th, Nh], o.cov); // ECI → RTN, km²
  const s = 1e6; // km² → m²
  return [
    `OBJECT = ${tag}`,
    `OBJECT_DESIGNATOR = ${des}`,
    `X = ${o.r[0]} [km]`,
    `Y = ${o.r[1]} [km]`,
    `Z = ${o.r[2]} [km]`,
    `X_DOT = ${o.v[0]} [km/s]`,
    `Y_DOT = ${o.v[1]} [km/s]`,
    `Z_DOT = ${o.v[2]} [km/s]`,
    `CR_R = ${Crtn[0][0] * s} [m**2]`,
    `CT_R = ${Crtn[1][0] * s} [m**2]`,
    `CT_T = ${Crtn[1][1] * s} [m**2]`,
    `CN_R = ${Crtn[2][0] * s} [m**2]`,
    `CN_T = ${Crtn[2][1] * s} [m**2]`,
    `CN_N = ${Crtn[2][2] * s} [m**2]`,
  ].join('\n');
}

const FULL_CDM = [
  'CCSDS_CDM_VERS = 1.0',
  'CREATION_DATE = 2026-07-02T12:00:00.000',
  'TCA = 2026-07-02T12:00:00.000',
  'MISS_DISTANCE = 4593.2 [m]',
  objBlock('OBJECT1', O1, 25544),
  objBlock('OBJECT2', O2, 33333),
  '',
].join('\n');

test('CDM full-covariance extraction + pc2d reproduces the NASA Omitron Pc', () => {
  const input = cdmToPc2dInput(parseCdm(FULL_CDM));
  assert.ok(input, 'full state + covariance extracted from the CDM');
  const res = probabilityOfCollision2D(input!.o1, input!.o2, 0.02);
  const relErr = Math.abs(res.pc - NASA_PC) / NASA_PC;
  assert.ok(relErr < 1e-4, `round-trip Pc ${res.pc} vs ${NASA_PC} (rel err ${relErr})`);
  assert.ok(Math.abs(res.missKm - 4.5932) < 1e-3, `missKm ${res.missKm}`);
});

test('cdmToPc2dInput returns null when a CDM lacks full state/covariance', () => {
  // A CDM with only designators + a partial covariance (no state vectors).
  const partial = [
    'CCSDS_CDM_VERS = 1.0',
    'TCA = 2026-07-02T13:00:00.000',
    'MISS_DISTANCE = 300 [m]',
    'OBJECT = OBJECT1',
    'OBJECT_DESIGNATOR = 25544',
    'CR_R = 10000 [m**2]',
    'OBJECT = OBJECT2',
    'OBJECT_DESIGNATOR = 33333',
    '',
  ].join('\n');
  assert.equal(cdmToPc2dInput(parseCdm(partial)), null);
});

// ── Route: the full-covariance Pc drives the proposal ────────────────────────
let app: FastifyInstance;
const AUTH = { 'x-api-key': DEMO_KEY };

before(async () => {
  app = await buildServer(await freshDb());
});
after(async () => {
  await app.close();
});

test('POST /v1/conjunctions/cdm uses the full-covariance Pc when the CDM carries it', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conjunctions/cdm',
    headers: AUTH,
    payload: { cdm: FULL_CDM },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as {
    pc2d?: { pc: number; missKm: number };
    proposal: { status: string; proposedAction: Record<string, unknown> };
  };
  // The high-fidelity Pc is computed and returned.
  assert.ok(body.pc2d, 'response carries the full-covariance pc2d result');
  assert.ok(Math.abs(body.pc2d!.pc - NASA_PC) / NASA_PC < 1e-4, `pc2d.pc ${body.pc2d!.pc}`);
  // And it drove the decision (the proposed action records the method + Pc).
  assert.equal(body.proposal.status, 'pending');
  assert.equal(body.proposal.proposedAction['pcMethod'], 'full-covariance 2D (Foster/CARA)');
  assert.ok(Math.abs((body.proposal.proposedAction['pc'] as number) - NASA_PC) / NASA_PC < 1e-4);
});
