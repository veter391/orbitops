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
 * @param {Object} elements - classical orbital elements
 * @param {number} elements.inclination - inclination (rad)
 * @param {number} elements.raan - right ascension of ascending node (rad)
 * @param {number} elements.eccentricity - eccentricity (0..1)
 * @param {number} elements.argPerigee - argument of perigee (rad)
 * @param {number} elements.meanAnomaly - mean anomaly at epoch (rad)
 * @param {number} elements.meanMotion - mean motion (rad/s) — derived from semi-major axis
 * @param {number} t - time since epoch (seconds)
 * @returns {{x: number, y: number, z: number, alt: number, lat: number, lon: number, vx: number, vy: number, vz: number}}
 *          position in km (ECI), altitude in km, lat/lon in degrees
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
 * @param {Object} elements - classical orbital elements
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
 * Compute great-circle distance (km) between two satellites.
 * @param {Object} a - position from propagate()
 * @param {Object} b - position from propagate()
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
 * @param {Object} elA - orbital elements A
 * @param {Object} elB - orbital elements B
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

export const CONSTANTS = { EARTH_OMEGA, MU, EARTH_RADIUS_KM };