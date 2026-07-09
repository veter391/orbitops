// @ts-check
/**
 * Orbit propagator — simplified Keplerian model.
 *
 * For the demo we use classical orbital elements (COE) + Kepler's equation.
 * This is NOT SGP4-grade accuracy but is visually and behaviourally accurate
 * for the cockpit demo.
 *
 * For production, swap with satellite.js or sgp4 npm package.
 *
 * @module core/orbit-propagator
 */

'use strict';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Earth's rotation rate (rad/s) and gravitational parameter (km^3/s^2). */
const EARTH_OMEGA = 7.2921159e-5;
const MU = 398600.4418;
const EARTH_RADIUS_KM = 6378.137;
// OrbitalElements is a global domain type — see src/types.d.ts.

/**
 * Solve Kepler's equation M = E - e*sin(E) for E using Newton-Raphson.
 * @param {number} M - mean anomaly (rad)
 * @param {number} e - eccentricity
 * @returns {number} eccentric anomaly (rad)
 */
export function solveKepler(M, e) {
  // Normalize M to [0, 2π)
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

/**
 * Compute satellite position in Earth-Centered Inertial (ECI) frame at time t.
 *
 * @param {OrbitalElements} elements - classical orbital elements
 * @param {number} t - time since epoch (seconds)
 * @returns {{x: number, y: number, z: number, alt: number, lat: number, lon: number, vx: number, vy: number, vz: number, r: number}}
 *          position in km (ECI/ECEF), altitude in km, lat/lon in degrees, r = orbital radius (km)
 */
export function propagate(elements, t) {
  const { inclination, raan, eccentricity, argPerigee, meanAnomaly, meanMotion } = elements;

  // Mean anomaly at time t
  const M = meanAnomaly + meanMotion * t;

  // Eccentric anomaly
  const E = solveKepler(M, eccentricity);

  // True anomaly
  const sinNu = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E);
  const cosNu = Math.cos(E) - eccentricity;
  const nu = Math.atan2(sinNu, cosNu);

  // Distance from Earth center
  const a = Math.cbrt(MU / (meanMotion * meanMotion)); // semi-major axis
  const r = a * (1 - eccentricity * Math.cos(E));

  // Position in orbital plane (perifocal frame)
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);

  // Rotation to ECI frame
  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  const cosArg = Math.cos(argPerigee);
  const sinArg = Math.sin(argPerigee);

  const x =
    (cosRaan * cosArg - sinRaan * sinArg * cosI) * xOrb +
    (-cosRaan * sinArg - sinRaan * cosArg * cosI) * yOrb;
  const y =
    (sinRaan * cosArg + cosRaan * sinArg * cosI) * xOrb +
    (-sinRaan * sinArg + cosRaan * cosArg * cosI) * yOrb;
  const z = sinArg * sinI * xOrb + cosArg * sinI * yOrb;

  // Approximate velocity in ECI (numerical — fine for visualization)
  const dt = 1;
  const next = propagateECI(elements, t + dt);
  const vx = (next.x - x) / dt;
  const vy = (next.y - y) / dt;
  const vz = (next.z - z) / dt;

  // Convert ECI to ECEF using GMST (Greenwich Mean Sidereal Time)
  const gmst = (EARTH_OMEGA * t) % (2 * Math.PI);
  const cosGmst = Math.cos(gmst);
  const sinGmst = Math.sin(gmst);
  const xEcef = x * cosGmst + y * sinGmst;
  const yEcef = -x * sinGmst + y * cosGmst;
  const zEcef = z;

  // ECEF to lat/lon/alt
  const lon = Math.atan2(yEcef, xEcef) * RAD;
  const hyp = Math.sqrt(xEcef * xEcef + yEcef * yEcef);
  const lat = Math.atan2(zEcef, hyp) * RAD;
  const alt = Math.sqrt(xEcef * xEcef + yEcef * yEcef + zEcef * zEcef) - EARTH_RADIUS_KM;

  return {
    x: xEcef,
    y: yEcef,
    z: zEcef,
    alt,
    lat,
    lon: ((lon + 540) % 360) - 180,
    vx,
    vy,
    vz,
    r,
  };
}

/**
 * Propagate ECI position only (no ECEF, no velocity) — fast path for animation loops.
 * @param {OrbitalElements} elements - classical orbital elements
 * @param {number} t - time since epoch (s)
 * @returns {{x: number, y: number, z: number}}
 */
export function propagateECI(elements, t) {
  const { inclination, raan, eccentricity, argPerigee, meanAnomaly, meanMotion } = elements;
  const M = meanAnomaly + meanMotion * t;
  const E = solveKepler(M, eccentricity);
  const sinNu = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E);
  const cosNu = Math.cos(E) - eccentricity;
  const nu = Math.atan2(sinNu, cosNu);
  const a = Math.cbrt(MU / (meanMotion * meanMotion));
  const r = a * (1 - eccentricity * Math.cos(E));
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);
  const cosRaan = Math.cos(raan);
  const sinRaan = Math.sin(raan);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  const cosArg = Math.cos(argPerigee);
  const sinArg = Math.sin(argPerigee);
  return {
    x: (cosRaan * cosArg - sinRaan * sinArg * cosI) * xOrb + (-cosRaan * sinArg - sinRaan * cosArg * cosI) * yOrb,
    y: (sinRaan * cosArg + cosRaan * sinArg * cosI) * xOrb + (-sinRaan * sinArg + cosRaan * cosArg * cosI) * yOrb,
    z: sinArg * sinI * xOrb + cosArg * sinI * yOrb,
  };
}

/**
 * Convert lat/lon/alt (km) to ECEF position (km).
 * @param {number} lat - latitude (deg)
 * @param {number} lon - longitude (deg)
 * @param {number} alt - altitude above Earth surface (km)
 */
export function latLonAltToECEF(lat, lon, alt) {
  const r = EARTH_RADIUS_KM + alt;
  const latRad = lat * DEG;
  const lonRad = lon * DEG;
  return {
    x: r * Math.cos(latRad) * Math.cos(lonRad),
    y: r * Math.cos(latRad) * Math.sin(lonRad),
    z: r * Math.sin(latRad),
  };
}

/**
 * Compute straight-line distance (km) between two satellite positions.
 * @param {Vec3} a - position from propagate()
 * @param {Vec3} b - position from propagate()
 * @returns {number}
 */
export function distanceKm(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute the upcoming closest approach between two satellites over a time window.
 *
 * Brute-force search over the window with step `stepSec`. Adequate for the demo;
 * production uses convex-hull or Keplerian propagation with closed-form solution.
 *
 * @param {OrbitalElements} elA - orbital elements A
 * @param {OrbitalElements} elB - orbital elements B
 * @param {number} tStart - start time (s, since epoch)
 * @param {number} tEnd - end time (s)
 * @param {number} stepSec - step size (s)
 * @returns {{tClosest: number, distanceKm: number}}
 */
export function closestApproach(elA, elB, tStart = 0, tEnd = 7200, stepSec = 30) {
  let tClosest = tStart;
  let minDist = Infinity;
  for (let t = tStart; t <= tEnd; t += stepSec) {
    const a = propagate(elA, t);
    const b = propagate(elB, t);
    const d = distanceKm(a, b);
    if (d < minDist) {
      minDist = d;
      tClosest = t;
    }
  }
  return { tClosest, distanceKm: minDist };
}

/**
 * Clamp to [lo, hi] — guards acos() against |x|>1 from rounding.
 * @param {number} x
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Convert an ECI state vector (position km, velocity km/s) to the classical
 * orbital elements this propagator consumes. Standard two-body reduction
 * (Vallado, "Fundamentals of Astrodynamics", Algorithm 9 — rv2coe): angular
 * momentum, node and eccentricity vectors, then the angles, with near-circular
 * and near-equatorial fallbacks. Angles in radians; `meanMotion` in rad/s and
 * `meanAnomaly` at the instant of this state — so `propagate(el, t)` advances
 * from *this* state. Lets a hypothetical (post-burn) state be screened with the
 * same Kepler engine as everything else.
 *
 * NOTE: two-body only (no drag/J2) — a planning-grade snapshot, not SGP4.
 * @param {Vec3} r ECI position (km)
 * @param {Vec3} v ECI velocity (km/s)
 * @returns {OrbitalElements}
 */
export function stateToElements(r, v) {
  const rmag = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  const vmag2 = v.x * v.x + v.y * v.y + v.z * v.z;
  const rv = r.x * v.x + r.y * v.y + r.z * v.z;

  // Specific angular momentum h = r × v, and node vector n = k̂ × h = (-h_y, h_x, 0).
  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  const hz = r.x * v.y - r.y * v.x;
  const hmag = Math.sqrt(hx * hx + hy * hy + hz * hz);
  const nx = -hy;
  const ny = hx;
  const nmag = Math.sqrt(nx * nx + ny * ny);

  // Eccentricity vector e = ((v²−μ/r)·r − (r·v)·v)/μ.
  const c1 = vmag2 - MU / rmag;
  const ex = (c1 * r.x - rv * v.x) / MU;
  const ey = (c1 * r.y - rv * v.y) / MU;
  const ez = (c1 * r.z - rv * v.z) / MU;
  const eccentricity = Math.sqrt(ex * ex + ey * ey + ez * ez);

  // Semi-major axis from the vis-viva energy, then mean motion (rad/s).
  const energy = vmag2 / 2 - MU / rmag;
  const a = -MU / (2 * energy);
  const meanMotion = Math.sqrt(MU / (a * a * a));

  const inclination = Math.acos(clamp(hz / hmag, -1, 1));

  let raan = 0;
  if (nmag > 1e-9) {
    raan = Math.acos(clamp(nx / nmag, -1, 1));
    if (ny < 0) raan = 2 * Math.PI - raan;
  }

  let argPerigee = 0;
  if (nmag > 1e-9 && eccentricity > 1e-9) {
    argPerigee = Math.acos(clamp((nx * ex + ny * ey) / (nmag * eccentricity), -1, 1));
    if (ez < 0) argPerigee = 2 * Math.PI - argPerigee;
  }

  // True anomaly ν; near-circular falls back to the argument of latitude.
  let nu;
  if (eccentricity > 1e-9) {
    nu = Math.acos(clamp((ex * r.x + ey * r.y + ez * r.z) / (eccentricity * rmag), -1, 1));
    if (rv < 0) nu = 2 * Math.PI - nu;
  } else if (nmag > 1e-9) {
    nu = Math.acos(clamp((nx * r.x + ny * r.y) / (nmag * rmag), -1, 1));
    if (r.z < 0) nu = 2 * Math.PI - nu;
    nu -= argPerigee;
  } else {
    nu = Math.atan2(r.y, r.x); // fully degenerate (equatorial + circular)
  }

  const E = Math.atan2(Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(nu), eccentricity + Math.cos(nu));
  let meanAnomaly = E - eccentricity * Math.sin(E);
  meanAnomaly = ((meanAnomaly % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  return { inclination, raan, eccentricity, argPerigee, meanAnomaly, meanMotion };
}

export const CONSTANTS = { EARTH_OMEGA, MU, EARTH_RADIUS_KM };