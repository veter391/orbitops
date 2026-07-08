/**
 * Deterministic close-approach risk math — no LLM. Used by the ConjunctionScreener
 * agent to turn a close-approach geometry into a real probability of collision
 * (Pc) and an operator-style risk band.
 *
 * First-order circular 2D Gaussian approximation: model the encounter in the
 * B-plane with equal in-plane position uncertainty `sigmaKm` (σ), a combined
 * hard-body radius `combinedRadiusKm` (R = sum of both objects' radii), and a
 * miss distance `missDistanceKm` (d):
 *
 *     Pc ≈ exp(-d² / 2σ²) · (1 − exp(-R² / 2σ²))
 *
 * This is the leading term of the standard Chan/Alfano series and is accurate
 * when R ≪ σ (the usual case). A full 2D numerical integration with a projected
 * relative covariance is Track C; this is a real, citeable first-order estimate.
 */

export interface ConjunctionInputs {
  /** Miss distance d, km. */
  missDistanceKm: number;
  /** Combined in-plane 1σ position uncertainty, km. */
  sigmaKm: number;
  /** Combined hard-body radius R (sum of both objects), km. */
  combinedRadiusKm: number;
}

/** First-order probability of collision in [0, 1]; 0 for degenerate inputs. */
export function probabilityOfCollision(i: ConjunctionInputs): number {
  const d = i.missDistanceKm;
  const s = i.sigmaKm;
  const r = i.combinedRadiusKm;
  if (!(s > 0) || !(r > 0) || !(d >= 0) || !Number.isFinite(d)) return 0;
  const twoSigmaSq = 2 * s * s;
  const pc = Math.exp(-(d * d) / twoSigmaSq) * (1 - Math.exp(-(r * r) / twoSigmaSq));
  return Math.min(1, Math.max(0, pc));
}

export type RiskBand = 'clear' | 'watch' | 'warning' | 'critical';

/** Below this Pc a conjunction is treated as noise (auto-dismissed to cut the
 *  alert flood) — an order of magnitude under the 'clear' band's 1e-5. */
export const NOISE_FLOOR_PC = 1e-6;

/** True when a computed Pc is low enough to auto-dismiss as noise. */
export function isNoise(pc: number | null): boolean {
  return pc !== null && pc >= 0 && pc < NOISE_FLOOR_PC;
}

/**
 * Operator-style banding by Pc. Thresholds follow common practice (many
 * operators and ESA act around Pc ≥ 1e-4; conservative fleets go lower). These
 * are defaults, meant to become per-operator policy later.
 */
export function riskBand(pc: number): RiskBand {
  if (pc >= 1e-3) return 'critical';
  if (pc >= 1e-4) return 'warning';
  if (pc >= 1e-5) return 'watch';
  return 'clear';
}

/** Map a risk band to a 0..1 likelihood the agent scorer uses. */
export function bandLikelihood(band: RiskBand): number {
  switch (band) {
    case 'critical':
      return 0.95;
    case 'warning':
      return 0.8;
    case 'watch':
      return 0.5;
    case 'clear':
      return 0.15;
  }
}
