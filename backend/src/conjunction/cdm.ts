/**
 * CCSDS Conjunction Data Message (CDM) parser — KVN (Keyword=Value Notation),
 * per CCSDS 508.0-B-1. This is what operators actually receive from the 18th/19th
 * Space Defense Squadron, LeoLabs, and other SSA providers. No maintained
 * permissive JS/TS CDM parser exists, so this is our own; it parses the flat KVN
 * into a structured message and maps it to the encounter geometry the
 * ConjunctionScreener consumes. Deterministic, dependency-free.
 */

import type { Vec3, Mat3, ObjectState } from './pc2d.js';

export interface CdmMessage {
  /** Header + relative-metadata keys (everything before the first OBJECT block). */
  meta: Record<string, string>;
  /** Per-object key/value bags (state, covariance, dimensions). */
  object1: Record<string, string>;
  object2: Record<string, string>;
}

/** Strip a trailing `[unit]` and surrounding whitespace from a KVN value. */
function cleanValue(v: string): string {
  return v.replace(/\[[^\]]*\]\s*$/, '').trim();
}

export function parseCdm(text: string): CdmMessage {
  const meta: Record<string, string> = {};
  const object1: Record<string, string> = {};
  const object2: Record<string, string> = {};
  let current: Record<string, string> = meta;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('COMMENT')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const value = cleanValue(line.slice(eq + 1));
    if (key === 'OBJECT') {
      // Route strictly by the CCSDS OBJECT1 / OBJECT2 tags. An unknown or
      // mistyped tag must not silently merge into object1's bag and corrupt it,
      // so it goes to a throwaway sink (and validateCdm will reject the message
      // for the missing designator).
      const tag = value.toUpperCase();
      current = tag === 'OBJECT1' ? object1 : tag === 'OBJECT2' ? object2 : {};
      current['OBJECT'] = value;
      continue;
    }
    current[key] = value;
  }
  return { meta, object1, object2 };
}

function num(bag: Record<string, string>, key: string): number | undefined {
  const v = bag[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Combined in-plane 1σ position uncertainty (km), first-order from the RTN
 *  position covariance diagonals (radial + transverse) of both objects. */
function combinedSigmaKm(o1: Record<string, string>, o2: Record<string, string>): number | undefined {
  // Covariance is in m² (CR_R, CT_T are position variances in the RTN frame).
  const rr1 = num(o1, 'CR_R');
  const tt1 = num(o1, 'CT_T');
  const rr2 = num(o2, 'CR_R');
  const tt2 = num(o2, 'CT_T');
  // Require a full in-plane covariance diagonal from BOTH objects. One-sided or
  // partial covariance must not masquerade as fully-known combined uncertainty:
  // if either object's covariance is missing we return undefined, and the
  // screener falls back to a severity hint rather than a fabricated Pc.
  if (rr1 === undefined || tt1 === undefined || rr2 === undefined || tt2 === undefined) return undefined;
  if (rr1 < 0 || tt1 < 0 || rr2 < 0 || tt2 < 0) return undefined;
  // The relative-position covariance is C1 + C2 (RTN frame), so the combined
  // radial/transverse variances add. Effective isotropic 1σ = RMS over the two
  // in-plane axes. m → km.
  const varRadial = rr1 + rr2;
  const varTransverse = tt1 + tt2;
  return Math.sqrt((varRadial + varTransverse) / 2) / 1000;
}

/**
 * Structural + physical validation of a parsed CDM before it is scored. Returns
 * a list of human-readable problems (empty array = valid). The route rejects
 * with 400 on any problem rather than silently scoring malformed or corrupt
 * input into a spurious verdict (e.g. a negative miss distance or an empty
 * message defaulting its way to a false "critical" or fail-open "clear").
 */
export function validateCdm(cdm: CdmMessage): string[] {
  const problems: string[] = [];
  if (!cdm.meta['TCA']) problems.push('missing TCA');
  if (cdm.meta['MISS_DISTANCE'] === undefined) {
    problems.push('missing MISS_DISTANCE');
  } else {
    const miss = num(cdm.meta, 'MISS_DISTANCE');
    if (miss === undefined) problems.push('MISS_DISTANCE is not a number');
    else if (miss < 0) problems.push('MISS_DISTANCE must be non-negative');
  }
  if (!cdm.object1['OBJECT_DESIGNATOR']) problems.push('missing OBJECT1 designator');
  if (!cdm.object2['OBJECT_DESIGNATOR']) problems.push('missing OBJECT2 designator');
  // Reject physically-implausible magnitudes: a huge hard-body radius would blow
  // up the Pc integration domain, and huge covariances overflow to an Infinity
  // sigma. Real HBR is meters-to-tens-of-meters; real position covariance is at
  // most ~(hundreds of km)². These ceilings are generous but block abuse.
  for (const [name, bag] of [['OBJECT1', cdm.object1], ['OBJECT2', cdm.object2]] as const) {
    const hbr = num(bag, 'HBR');
    if (hbr !== undefined && (hbr < 0 || hbr > MAX_HBR_M)) {
      problems.push(`${name} HBR is implausible (0…${MAX_HBR_M} m)`);
    }
    for (const c of ['CR_R', 'CT_T', 'CN_N']) {
      const v = num(bag, c);
      if (v !== undefined && (v < 0 || v > MAX_COV_M2)) {
        problems.push(`${name} ${c} covariance is implausible (0…${MAX_COV_M2.toExponential(0)} m²)`);
      }
    }
  }
  return problems;
}

/** Physical ceilings for input sanity (defense-in-depth against abuse/overflow). */
const MAX_HBR_M = 1e5; // 100 km combined hard-body radius — real values are meters
const MAX_COV_M2 = 1e14; // (10,000 km)² — far beyond any real position covariance

export interface Encounter {
  missDistanceKm: number;
  timeToTcaSec: number;
  combinedRadiusKm: number;
  sigmaKm?: number;
  object1Designator?: string;
  object2Designator?: string;
  tca?: string;
}

const DEFAULT_COMBINED_HBR_KM = 0.02; // 20 m combined hard-body radius, a common ops default

/**
 * Map a parsed CDM to the screener's encounter geometry. `referenceIso` is the
 * "now" used to compute time-to-TCA (defaults to the CDM CREATION_DATE so the
 * mapping is deterministic and testable).
 */
export function cdmToEncounter(cdm: CdmMessage, referenceIso?: string): Encounter {
  const missM = num(cdm.meta, 'MISS_DISTANCE') ?? 0;
  const tca = cdm.meta['TCA'];
  const ref = referenceIso ?? cdm.meta['CREATION_DATE'];
  let timeToTcaSec = 0;
  if (tca && ref) {
    const dt = (Date.parse(tca) - Date.parse(ref)) / 1000;
    if (Number.isFinite(dt) && dt > 0) timeToTcaSec = dt;
  }
  // Combined hard-body radius from per-object HBR if present, else a default.
  const hbr1 = num(cdm.object1, 'HBR');
  const hbr2 = num(cdm.object2, 'HBR');
  const combinedRadiusKm =
    hbr1 !== undefined || hbr2 !== undefined
      ? ((hbr1 ?? 0) + (hbr2 ?? 0)) / 1000
      : DEFAULT_COMBINED_HBR_KM;

  const sigmaKm = combinedSigmaKm(cdm.object1, cdm.object2);
  return {
    missDistanceKm: missM / 1000,
    timeToTcaSec,
    combinedRadiusKm: combinedRadiusKm > 0 ? combinedRadiusKm : DEFAULT_COMBINED_HBR_KM,
    ...(sigmaKm !== undefined ? { sigmaKm } : {}),
    ...(cdm.object1['OBJECT_DESIGNATOR'] ? { object1Designator: cdm.object1['OBJECT_DESIGNATOR'] } : {}),
    ...(cdm.object2['OBJECT_DESIGNATOR'] ? { object2Designator: cdm.object2['OBJECT_DESIGNATOR'] } : {}),
    ...(tca ? { tca } : {}),
  };
}

// ── Full-covariance extraction for the high-fidelity 2D Pc (pc2d) ────────────

const M2_PER_KM2 = 1e6; // 1 km² = 1e6 m²

function v3cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function v3unit(a: Vec3): Vec3 {
  const n = v3norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
/** A·C·Aᵀ for 3x3 matrices, with A given by its rows. */
function abcT(A: Mat3, C: Mat3): Mat3 {
  const [a0, a1, a2] = A;
  const mul = (row: Vec3): Vec3 => [
    row[0] * C[0][0] + row[1] * C[1][0] + row[2] * C[2][0],
    row[0] * C[0][1] + row[1] * C[1][1] + row[2] * C[2][1],
    row[0] * C[0][2] + row[1] * C[1][2] + row[2] * C[2][2],
  ];
  const m0 = mul(a0);
  const m1 = mul(a1);
  const m2 = mul(a2);
  const d = (x: Vec3, y: Vec3): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  return [
    [d(m0, a0), d(m0, a1), d(m0, a2)],
    [d(m1, a0), d(m1, a1), d(m1, a2)],
    [d(m2, a0), d(m2, a1), d(m2, a2)],
  ];
}

/**
 * Build an ECI ObjectState from one CDM object bag: parse the state vector
 * (X/Y/Z km, X_DOT/Y_DOT/Z_DOT km/s) and the RTN position covariance
 * (CR_R..CN_N, m²), then rotate the covariance RTN→ECI. RTN axes: R̂ radial,
 * N̂ = (r×v)/|r×v| cross-track, T̂ = N̂×R̂ in-track (CCSDS convention). Returns
 * null if any required state or covariance term is missing.
 */
export function cdmObjectState(bag: Record<string, string>): ObjectState | null {
  const X = num(bag, 'X');
  const Y = num(bag, 'Y');
  const Z = num(bag, 'Z');
  const XD = num(bag, 'X_DOT');
  const YD = num(bag, 'Y_DOT');
  const ZD = num(bag, 'Z_DOT');
  const crr = num(bag, 'CR_R');
  const ctr = num(bag, 'CT_R');
  const ctt = num(bag, 'CT_T');
  const cnr = num(bag, 'CN_R');
  const cnt = num(bag, 'CN_T');
  const cnn = num(bag, 'CN_N');
  if (
    X === undefined || Y === undefined || Z === undefined ||
    XD === undefined || YD === undefined || ZD === undefined ||
    crr === undefined || ctr === undefined || ctt === undefined ||
    cnr === undefined || cnt === undefined || cnn === undefined
  ) {
    return null;
  }
  const r: Vec3 = [X, Y, Z];
  const v: Vec3 = [XD, YD, ZD];
  // RTN position covariance (order R,T,N), m² → km².
  const s = 1 / M2_PER_KM2;
  const covRtn: Mat3 = [
    [crr * s, ctr * s, cnr * s],
    [ctr * s, ctt * s, cnt * s],
    [cnr * s, cnt * s, cnn * s],
  ];
  // Q columns = [R̂, T̂, N̂]; Cov_eci = Q·Cov_rtn·Qᵀ (rows of Q below).
  const Rh = v3unit(r);
  const cr = v3cross(r, v);
  if (v3norm(cr) === 0) return null; // r ∥ v: no RTN frame
  const Nh = v3unit(cr);
  const Th = v3cross(Nh, Rh);
  const Q: Mat3 = [
    [Rh[0], Th[0], Nh[0]],
    [Rh[1], Th[1], Nh[1]],
    [Rh[2], Th[2], Nh[2]],
  ];
  return { r, v, cov: abcT(Q, covRtn) };
}

export interface Pc2dCdmInput {
  o1: ObjectState;
  o2: ObjectState;
  combinedRadiusKm: number;
}

/**
 * Extract both objects' ECI states + covariances and the combined hard-body
 * radius for the full-covariance 2D Pc. Returns null when either object lacks a
 * complete state vector or RTN covariance (then the route falls back to the
 * first-order estimate from {@link cdmToEncounter}).
 */
export function cdmToPc2dInput(cdm: CdmMessage): Pc2dCdmInput | null {
  const o1 = cdmObjectState(cdm.object1);
  const o2 = cdmObjectState(cdm.object2);
  if (!o1 || !o2) return null;
  const hbr1 = num(cdm.object1, 'HBR');
  const hbr2 = num(cdm.object2, 'HBR');
  const combined =
    hbr1 !== undefined || hbr2 !== undefined ? ((hbr1 ?? 0) + (hbr2 ?? 0)) / 1000 : DEFAULT_COMBINED_HBR_KM;
  return { o1, o2, combinedRadiusKm: combined > 0 ? combined : DEFAULT_COMBINED_HBR_KM };
}
