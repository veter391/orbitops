/**
 * CCSDS Conjunction Data Message (CDM) parser — KVN (Keyword=Value Notation),
 * per CCSDS 508.0-B-1. This is what operators actually receive from the 18th/19th
 * Space Defense Squadron, LeoLabs, and other SSA providers. No maintained
 * permissive JS/TS CDM parser exists, so this is our own; it parses the flat KVN
 * into a structured message and maps it to the encounter geometry the
 * ConjunctionScreener consumes. Deterministic, dependency-free.
 */

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
  return problems;
}

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
