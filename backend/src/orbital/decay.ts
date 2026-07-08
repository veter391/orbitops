/**
 * First-order orbital-decay lifetime + FCC deorbit-compliance screening —
 * deterministic, dependency-free, no LLM. Powers a "will this satellite deorbit
 * inside its post-mission window?" check.
 *
 * Model: King-Hele-family closed form for a near-circular orbit under atmospheric
 * drag. The orbit contracts as drag removes energy; decay is dominated by the
 * ~one-scale-height drop near the starting altitude, giving
 *
 *     t_life ≈ B · H / ( ρ(h) · √(μ · a) )
 *
 * with ballistic coefficient B = m/(Cd·A) [kg/m²], scale height H, exponential
 * atmosphere ρ(h) = ρ₀·exp(−(h − h_ref)/H), semi-major axis a = R⊕ + h.
 *
 * IMPORTANT — this is an ORDER-OF-MAGNITUDE planning estimate, not a prediction.
 * Real lifetime swings by factors of several (up to ~10×) with solar activity
 * (F10.7 / exospheric temperature) and with the true, altitude-varying scale
 * height. Published sources themselves disagree by up to ~10×. Always present the
 * result with its uncertainty band, never as a precise number.
 *
 * Refs: King-Hele, "Satellite Orbits in an Atmosphere"; Vallado, "Fundamentals
 * of Astrodynamics and Applications" (drag/lifetime chapter); SpaceAcademy and
 * AgentCalc lifetime tables (validation anchors in test/decay.test.ts).
 */

export const MU_EARTH = 3.986004418e14; // m³/s²
export const EARTH_RADIUS_M = 6.371e6; // m
export const DEFAULT_CD = 2.2; // typical drag coefficient

const RHO0 = 4e-13; // kg/m³ at the reference altitude (upper-thermosphere anchor)
const H_REF_KM = 400; // reference altitude for RHO0
const SCALE_HEIGHT_KM = 70; // exponential-atmosphere scale height (LEO average)
const YEAR_SECONDS = 365.25 * 86400;

/** Default ballistic coefficient B = m/(Cd·A) ≈ 100 kg/m² (m/A) ÷ 2.2. */
export const DEFAULT_BALLISTIC_KG_M2 = 45;

/** Ballistic coefficient B = m / (Cd·A), kg/m². */
export function ballisticCoefficient(massKg: number, areaM2: number, cd: number = DEFAULT_CD): number {
  if (!(massKg > 0) || !(areaM2 > 0) || !(cd > 0)) return DEFAULT_BALLISTIC_KG_M2;
  return massKg / (cd * areaM2);
}

/** Exponential-atmosphere density (kg/m³) at altitude h (km). */
function densityKgM3(altitudeKm: number): number {
  return RHO0 * Math.exp(-(altitudeKm - H_REF_KM) / SCALE_HEIGHT_KM);
}

/**
 * First-order natural orbital lifetime in YEARS for a near-circular orbit at
 * `altitudeKm`, given the ballistic coefficient B (kg/m²). Order-of-magnitude
 * estimate — see the module note.
 */
export function orbitalLifetimeYears(
  altitudeKm: number,
  ballisticKgM2: number = DEFAULT_BALLISTIC_KG_M2,
): number {
  if (!(altitudeKm > 0) || !(ballisticKgM2 > 0)) return 0;
  const a = EARTH_RADIUS_M + altitudeKm * 1000;
  const rho = densityKgM3(altitudeKm);
  const Hm = SCALE_HEIGHT_KM * 1000;
  const tSec = (ballisticKgM2 * Hm) / (rho * Math.sqrt(MU_EARTH * a));
  return tSec / YEAR_SECONDS;
}

export interface DeorbitInput {
  altitudeKm: number;
  ballisticKgM2?: number;
  /** True for post-2024 LEO authorizations subject to the FCC 22-74 5-year rule;
   *  false for legacy/grandfathered satellites under the 25-year guideline. */
  appliesFiveYearRule: boolean;
}

export interface DeorbitAssessment {
  lifetimeYears: number;
  /** First-order uncertainty band [low, high] (÷3 … ×3) — solar activity and
   *  ballistic coefficient dominate. */
  lifetimeBandYears: [number, number];
  regime: '5-year' | '25-year';
  disposalWindowYears: number;
  /** True when passive drag decay reaches reentry within the disposal window. */
  compliantPassively: boolean;
  /** The uncertainty band straddles the deadline — treat as not-safely-compliant. */
  borderline: boolean;
  requiresActiveDisposal: boolean;
  note: string;
}

/**
 * Screen a satellite's post-mission deorbit compliance: compare the natural
 * (drag-only) lifetime to the applicable disposal window (5 years under FCC
 * 22-74 for post-2024 LEO authorizations, else the 25-year legacy guideline).
 * The comparison is window-relative (lifetime vs window), so it is independent
 * of the actual end-of-mission date.
 */
export function assessDeorbitCompliance(input: DeorbitInput): DeorbitAssessment {
  const life = orbitalLifetimeYears(input.altitudeKm, input.ballisticKgM2);
  const disposalWindowYears = input.appliesFiveYearRule ? 5 : 25;
  const band: [number, number] = [life / 3, life * 3];
  const compliantPassively = life <= disposalWindowYears;
  // Honest labelling: if the uncertainty band spans the deadline, passive
  // compliance is not assured even when the point estimate clears it.
  const borderline = band[0] <= disposalWindowYears && band[1] > disposalWindowYears;
  return {
    lifetimeYears: life,
    lifetimeBandYears: band,
    regime: input.appliesFiveYearRule ? '5-year' : '25-year',
    disposalWindowYears,
    compliantPassively,
    borderline,
    requiresActiveDisposal: !compliantPassively || borderline,
    note: input.appliesFiveYearRule
      ? 'FCC 22-74 5-year rule (post-2024 LEO authorizations). First-order drag estimate; solar activity and ballistic coefficient dominate the uncertainty.'
      : '25-year guideline (grandfathered / legacy authorizations). First-order drag estimate.',
  };
}
