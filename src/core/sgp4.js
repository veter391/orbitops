// @ts-check
/**
 * SGP4 propagation wrapper around the vendored satellite.js.
 *
 * This is the real orbital-mechanics path for OrbitOps: given a NORAD
 * two-line element set (TLE) from CelesTrak, it produces real ECI positions
 * and velocities, real ground coordinates, and the sidereal time used to spin
 * the globe. Nothing here is simulated — the numbers are the same ones a real
 * flight-dynamics tool would compute from the same TLE.
 *
 * @module core/sgp4
 */

'use strict';

import * as satellite from 'satellite';

/**
 * Parse CelesTrak TLE text (name line + two element lines, repeated) into
 * records. Robust to trailing blank lines and to a missing name line.
 * @param {string} text
 * @returns {Array<{name: string, line1: string, line2: string, noradId: number}>}
 */
export function parseTle(text) {
  const raw = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const l1 = raw[i];
    const l2 = raw[i + 1];
    if (l1 && l2 && l1.startsWith('1 ') && l2.startsWith('2 ')) {
      const prev = i > 0 ? raw[i - 1] : '';
      const hasName = prev && !prev.startsWith('1 ') && !prev.startsWith('2 ');
      const noradId = parseInt(l1.slice(2, 7), 10);
      out.push({
        name: hasName ? prev.trim() : `NORAD ${noradId}`,
        line1: l1,
        line2: l2,
        noradId,
      });
      i++; // consume l2
    }
  }
  return out;
}

/**
 * Build a propagation-ready satellite from a parsed TLE record.
 * @param {TleRecord} rec
 * @returns {SatObject}
 */
export function makeSat(rec) {
  return {
    name: rec.name,
    noradId: rec.noradId,
    satrec: satellite.twoline2satrec(rec.line1, rec.line2),
  };
}

/**
 * Propagate to a Date. Returns ECI position (km) + velocity (km/s), or null
 * if the SGP4 propagation decayed / errored for this epoch.
 * @param {Satrec} satrec
 * @param {Date} date
 * @returns {StateVectors|null}
 */
export function propagateEci(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || Number.isNaN(pv.position.x)) return null;
  return pv;
}

/**
 * Sub-satellite geodetic point + altitude for a propagated state.
 * @param {Vec3} position  ECI position (km)
 * @param {Date} date
 * @returns {Geodetic}
 */
export function geodetic(position, date) {
  const gmst = satellite.gstime(date);
  const g = satellite.eciToGeodetic(position, gmst);
  return {
    latDeg: satellite.degreesLat(g.latitude),
    lonDeg: satellite.degreesLong(g.longitude),
    altKm: g.height,
  };
}

/**
 * Greenwich Mean Sidereal Time (radians) — used to spin the globe realistically.
 * @param {Date} date
 * @returns {number}
 */
export function gmstOf(date) {
  return satellite.gstime(date);
}

/**
 * Speed magnitude (km/s) from an ECI velocity vector.
 * @param {Vec3} v
 * @returns {number}
 */
export function speedKms(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

const MU = 398600.4418; // Earth gravitational parameter, km^3/s^2
const RE = 6371; // mean Earth radius, km

/**
 * Mean orbital parameters straight from the element set (no propagation):
 * mean altitude, period, inclination, eccentricity. Real values derived from
 * the TLE's mean motion via Kepler's third law.
 * @param {Satrec} satrec
 * @returns {{altKm: number, periodMin: number, inclDeg: number, ecc: number}}
 */
export function meanElements(satrec) {
  const nRadPerSec = satrec.no / 60; // satrec.no is rad/min
  const a = Math.cbrt(MU / (nRadPerSec * nRadPerSec)); // semi-major axis, km
  return {
    altKm: a - RE,
    periodMin: satrec.no > 0 ? (2 * Math.PI) / satrec.no : 0,
    inclDeg: satrec.inclo * (180 / Math.PI),
    ecc: satrec.ecco,
  };
}
