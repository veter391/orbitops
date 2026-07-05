// @ts-check
/**
 * Maneuver planner — compute optimal avoidance burns and station-keeping burns.
 *
 * For the demo, this is a simplified Hohmann-transfer solver that produces
 * delta-v vectors. Production would integrate with STK/Astos/FreeFlyer for
 * higher-fidelity optimisation.
 *
 * @module core/maneuver-planner
 */

'use strict';

import { propagate, distanceKm } from './orbit-propagator.js';

/**
 * A computed maneuver. Fields vary by kind (avoidance / phasing / none /
 * monitor); the common ones are named, the rest are optional.
 * @typedef {object} Maneuver
 * @property {string} kind
 * @property {string} [direction]
 * @property {number} [dvMs]
 * @property {number} [fuelKg]
 * @property {number} [durationSec]
 * @property {number} [deltaAlt]
 * @property {number} [phaseShift]
 * @property {number} [confidence]
 * @property {string|string[]} [notes]
 * @property {string} [reason]
 * @property {any} [alternative]
 * @property {any} [conjunction]
 * @property {string} [satA]
 * @property {string} [satB]
 * @property {number} [tConjunction]
 * @property {Maneuver} [burn]
 */

/**
 * A predicted close approach between two objects.
 * @typedef {object} Conjunction
 * @property {number} missKm
 * @property {number} probCollision
 */

/**
 * The concrete result of avoidanceBurn — every field is always present (unlike
 * the broader Maneuver union), so callers can read dvMs/fuelKg without guards.
 * @typedef {object} AvoidanceBurn
 * @property {string} kind
 * @property {string} direction
 * @property {number} dvMs
 * @property {number} fuelKg
 * @property {number} durationSec
 * @property {number} deltaAlt
 * @property {number} confidence
 * @property {string[]} notes
 * @property {{label: string, dvMs: number, fuelKg: number, notes: string}} alternative
 */

/**
 * Compute a Hohmann-like avoidance burn to increase altitude by deltaAlt.
 *
 * Real-world this requires solving Lambert's problem for the desired
 * separation. For the demo, we produce a prograde (along-velocity) burn
 * proportional to the desired altitude change.
 *
 * @param {any} elements - orbital elements (unused in the demo solver)
 * @param {number} [deltaAltKm=5] - desired altitude change (km), positive = raise
 * @returns {AvoidanceBurn}
 */
export function avoidanceBurn(elements, deltaAltKm = 5) {
  // Empirical: ~3.0 m/s per km altitude change for circular LEO
  const dvMs = Math.abs(deltaAltKm) * 3.0;
  const direction = deltaAltKm > 0 ? 'prograde' : 'retrograde';
  const durationSec = 30; // burn duration

  // Fuel estimate using Tsiolkovsky: dm = m * (e^(dv/ve) - 1), ve ≈ 220s for hydrazine
  const ve = 220; // m/s exhaust velocity (hydrazine)
  const dryMass = 200; // kg typical LEO satellite
  const fuelKg = dryMass * (Math.exp(dvMs / ve) - 1);

  return {
    kind: 'avoidance',
    direction,
    dvMs,
    fuelKg: Number(fuelKg.toFixed(3)),
    durationSec,
    deltaAlt: deltaAltKm,
    confidence: 0.87,
    notes: [
      'Hohmann transfer: two-burn solution',
      'Burn 1: prograde at periapsis (T+0)',
      'Burn 2: prograde at apoapsis (T+½ period)',
      'Separation achieved at T+1 period',
    ],
    alternative: {
      label: 'Aggressive single-burn',
      dvMs: dvMs * 1.35,
      fuelKg: Number((dryMass * (Math.exp((dvMs * 1.35) / ve) - 1)).toFixed(3)),
      notes: 'Faster but more fuel. Use if conjunction is <2 hours away.',
    },
  };
}

/**
 * Compute a station-keeping burn to correct altitude decay.
 *
 * @param {{altitude?: number}} elements
 * @param {number} targetAltitudeKm
 * @returns {Maneuver}
 */
export function stationKeepingBurn(elements, targetAltitudeKm) {
  const currentAlt = elements.altitude ?? 550;
  const deltaAlt = targetAltitudeKm - currentAlt;
  return avoidanceBurn(elements, deltaAlt);
}

/**
 * Compute phasing burn to delay/advance orbit by phase angle.
 *
 * @param {number} phaseDeg - desired phase shift (deg)
 * @param {any} [elements] - orbital elements (unused in the demo solver)
 * @returns {Maneuver}
 */
export function phasingBurn(phaseDeg, elements) {
  // Empirical: 0.4 m/s per degree of phase shift
  const dvMs = Math.abs(phaseDeg) * 0.4;
  return {
    kind: 'phasing',
    direction: phaseDeg > 0 ? 'prograde' : 'retrograde',
    dvMs,
    fuelKg: Number((200 * (Math.exp(dvMs / 220) - 1)).toFixed(3)),
    durationSec: 15,
    phaseShift: phaseDeg,
    confidence: 0.92,
    notes: [
      'Single-burn phasing maneuver',
      'Total phase shift achieved at next nodal crossing',
      'Recommend waiting for proper lighting/eclipse-free window',
    ],
  };
}

/**
 * Compute full avoidance maneuver plan given a conjunction.
 *
 * @param {Conjunction} conjunction
 * @param {Satellite} satA
 * @param {Satellite} satB
 * @param {number} tConjunction - time of closest approach
 * @returns {Maneuver}
 */
export function planAvoidance(conjunction, satA, satB, tConjunction) {
  // If miss distance is acceptable, recommend no action
  if (conjunction.missKm >= 10) {
    return {
      kind: 'none',
      reason: 'Miss distance acceptable (>10 km). No maneuver needed.',
      confidence: 0.95,
      dvMs: 0,
      fuelKg: 0,
    };
  }

  // If close but not critical, monitor
  if (conjunction.missKm >= 5 && conjunction.probCollision < 1e-5) {
    return {
      kind: 'monitor',
      reason: 'Miss distance borderline. Continue tracking. Re-evaluate in 6h.',
      confidence: 0.78,
      dvMs: 0,
      fuelKg: 0,
    };
  }

  // Calculate required altitude change to clear conjunction
  // Empirical: 5 km altitude change → ~50 km horizontal miss at closest approach
  const requiredMiss = 25; // km safety margin
  const currentMiss = conjunction.missKm;
  const requiredDelta = (requiredMiss - currentMiss) * 0.1;

  const burn = avoidanceBurn(satA.elements, requiredDelta);
  return {
    kind: 'avoidance',
    conjunction,
    satA: satA.id,
    satB: satB.id,
    tConjunction,
    burn,
    reason: `Miss distance ${currentMiss.toFixed(2)} km below threshold. Recommend ${burn.direction} burn of ${(burn.dvMs ?? 0).toFixed(2)} m/s to raise orbit by ${(burn.deltaAlt ?? 0).toFixed(2)} km.`,
    confidence: burn.confidence,
  };
}

/**
 * Find the next safe burn window (no eclipse, ground station visible).
 *
 * @param {Satellite} satellite
 * @param {number} tStart
 * @param {number} [windowHours=24]
 * @returns {Array<{start: number, end: number, eclipse: boolean, gsVisible: boolean}>}
 */
export function findBurnWindows(satellite, tStart, windowHours = 24) {
  const windows = [];
  const stepSec = 300; // 5 min steps
  const period = (2 * Math.PI) / satellite.elements.meanMotion;
  for (let t = tStart; t < tStart + windowHours * 3600; t += stepSec) {
    const phase = (t % period) / period;
    const inEclipse = phase > 0.42 && phase < 0.58;
    // Simplified: ground station visible 25% of orbit
    const gsVisible = phase < 0.2 || phase > 0.85;
    if (!inEclipse && gsVisible) {
      windows.push({ start: t, end: t + stepSec, eclipse: false, gsVisible: true });
    }
  }
  // Merge contiguous windows
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start - last.end < stepSec * 2) {
      last.end = w.end;
    } else {
      merged.push({ ...w });
    }
  }
  return merged.slice(0, 10);
}