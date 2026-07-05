// @ts-check
/**
 * Approximate solar direction in the ECI (Earth-centered inertial) frame.
 *
 * Accurate to well under a degree — far more than enough to place a real
 * day/night terminator on the globe that tracks the actual Sun for the
 * current time. Standard low-precision solar-position formulae (Astronomical
 * Almanac). Returns a unit vector in the same equatorial frame satellite.js
 * uses for ECI positions, so the terminator and the satellites share one
 * coordinate system.
 *
 * @module core/sun
 */

'use strict';

const RAD = Math.PI / 180;

/**
 * @param {Date} date
 * @returns {{x: number, y: number, z: number}} unit vector toward the Sun in ECI.
 */
export function sunEciDirection(date) {
  const jd = date.getTime() / 86400000 + 2440587.5; // Julian date
  const n = jd - 2451545.0; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude (deg)
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD; // mean anomaly (rad)
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = 23.439 * RAD; // obliquity of the ecliptic

  const x = Math.cos(lambda);
  const y = Math.cos(eps) * Math.sin(lambda);
  const z = Math.sin(eps) * Math.sin(lambda);
  const m = Math.hypot(x, y, z) || 1;
  return { x: x / m, y: y / m, z: z / m };
}
