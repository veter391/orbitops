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
