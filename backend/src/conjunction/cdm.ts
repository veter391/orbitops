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
      current = value.toUpperCase() === 'OBJECT2' ? object2 : object1;
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
  const parts = [num(o1, 'CR_R'), num(o1, 'CT_T'), num(o2, 'CR_R'), num(o2, 'CT_T')].filter(
    (x): x is number => typeof x === 'number' && x >= 0,
  );
  if (parts.length === 0) return undefined;
  // Effective isotropic 1σ from the summed in-plane variance, m → km.
  const varSumM2 = parts.reduce((a, b) => a + b, 0);
  return Math.sqrt(varSumM2 / parts.length) / 1000;
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
