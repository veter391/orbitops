/**
 * Deterministic avoidance-burn sizing — no LLM. Used by the ManeuverPlanner to
 * turn a conjunction into a concrete delta-v and propellant estimate.
 *
 * First-order model: for a small collision-avoidance nudge, an along-track
 * impulse Δv is the most fuel-efficient way to open miss distance. In the
 * Clohessy–Wiltshire (relative-motion) linearization, an along-track Δv builds a
 * secular downtrack drift of ≈ 3·Δv·Δt over time-to-closest-approach Δt, so to
 * add Δs of separation:  Δv ≈ Δs / (3·Δt).  Propellant follows the Tsiolkovsky
 * rocket equation. This is a real, citeable first-order estimate for planning;
 * a full targeted optimization is later domain work.
 */

const G0 = 9.80665; // standard gravity, m/s²
export const DEFAULT_SAFE_MISS_KM = 1.0;
export const DEFAULT_SAT_MASS_KG = 260;
export const DEFAULT_ISP_SEC = 220;
/** Default mean motion ≈ a ~90 min LEO orbit (rad/s), used for radial/cross-track sizing. */
export const DEFAULT_MEAN_MOTION_RAD_S = (2 * Math.PI) / 5400;

export interface BurnInputs {
  currentMissKm: number;
  timeToTcaSec: number;
  safeMissKm?: number;
  satMassKg?: number;
  ispSec?: number;
}

export interface BurnPlan {
  deltaVMs: number; // m/s
  propellantKg: number;
  targetMissKm: number;
  addedSeparationKm: number;
  method: string;
}

export function sizeAvoidanceBurn(i: BurnInputs): BurnPlan {
  const safe = i.safeMissKm ?? DEFAULT_SAFE_MISS_KM;
  const mass = i.satMassKg ?? DEFAULT_SAT_MASS_KG;
  const isp = i.ispSec ?? DEFAULT_ISP_SEC;
  const target = Math.max(i.currentMissKm, safe);
  const addedKm = Math.max(0, target - i.currentMissKm);
  const dt = i.timeToTcaSec;

  const deltaVMs = dt > 0 ? (addedKm * 1000) / (3 * dt) : 0; // CW secular along-track
  const propellantKg = mass * (1 - Math.exp(-deltaVMs / (isp * G0)));

  return {
    deltaVMs,
    propellantKg,
    targetMissKm: target,
    addedSeparationKm: addedKm,
    method: 'along-track CW secular (first-order)',
  };
}

export type BurnDirection = 'along-track' | 'radial' | 'cross-track';

export interface BurnOption {
  direction: BurnDirection;
  deltaVMs: number;
  propellantKg: number;
  /** Why an operator would (or wouldn't) pick this direction. */
  rationale: string;
}

/**
 * Rank the three canonical avoidance-burn directions to open the same separation,
 * so the operator sees alternatives rather than a single plan. Clohessy–Wiltshire
 * intuition (near-circular orbit, mean motion n):
 *   - along-track: secular downtrack drift Δs ≈ 3·Δv·Δt — cheapest with lead time;
 *   - radial: bounded oscillation, amplitude ≈ 2·Δv/n — no secular growth;
 *   - cross-track: out-of-plane sinusoid, amplitude ≈ Δv/n — least efficient.
 * Options are returned sorted by Δv ascending (cheapest first). Δv → propellant
 * via Tsiolkovsky. A full CAM optimizer (maximize Pc reduction for the actual
 * covariance orientation) is later domain work.
 */
export function avoidanceBurnAlternatives(
  i: BurnInputs & { meanMotionRadPerSec?: number },
): BurnOption[] {
  const safe = i.safeMissKm ?? DEFAULT_SAFE_MISS_KM;
  const mass = i.satMassKg ?? DEFAULT_SAT_MASS_KG;
  const isp = i.ispSec ?? DEFAULT_ISP_SEC;
  // Mean motion must be positive; a non-positive value would yield negative Δv
  // that sorts as "cheapest" and slips past the compliance envelope check.
  const n =
    i.meanMotionRadPerSec && i.meanMotionRadPerSec > 0
      ? i.meanMotionRadPerSec
      : DEFAULT_MEAN_MOTION_RAD_S;
  const target = Math.max(i.currentMissKm, safe);
  const addedM = Math.max(0, target - i.currentMissKm) * 1000;
  const dt = i.timeToTcaSec;

  const propellant = (dv: number) => mass * (1 - Math.exp(-dv / (isp * G0)));
  const opts: BurnOption[] = [];

  // Along-track needs lead time to accumulate; only feasible with dt > 0.
  if (dt > 0) {
    const dv = addedM / (3 * dt);
    opts.push({
      direction: 'along-track',
      deltaVMs: dv,
      propellantKg: propellant(dv),
      rationale: 'Secular downtrack drift; cheapest when executed many orbits before TCA.',
    });
  }
  {
    const dv = (addedM * n) / 2;
    opts.push({
      direction: 'radial',
      deltaVMs: dv,
      propellantKg: propellant(dv),
      rationale: 'Bounded oscillatory offset; usable on short lead time, no secular growth.',
    });
  }
  {
    const dv = addedM * n;
    opts.push({
      direction: 'cross-track',
      deltaVMs: dv,
      propellantKg: propellant(dv),
      rationale: 'Out-of-plane sinusoid; least fuel-efficient, only when geometry demands it.',
    });
  }

  return opts.sort((a, b) => a.deltaVMs - b.deltaVMs);
}
