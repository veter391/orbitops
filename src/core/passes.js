// @ts-check
/**
 * Ground-pass prediction — REAL look-angle math on real TLE element sets.
 *
 * Given a propagation-ready satrec (from core/sgp4.js makeSat) and an observer
 * site, this samples SGP4 states over a time window and converts each state to
 * topocentric look angles: propagate → gstime → eciToEcf → ecfToLookAngles.
 * A pass is any contiguous run of samples with elevation above the mask.
 *
 * Nothing here is simulated; accuracy is bounded by the TLE itself — SGP4
 * position error grows with element-set age (km-level within days), so pass
 * timing drifts by minutes as a TLE ages. Callers must surface that caveat.
 *
 * Shared by: pages/tools.js (pass predictor tool) and ui/cockpit-immersive.js
 * ("next pass over you" HUD line).
 *
 * @module core/passes
 */

'use strict';

import * as satellite from 'satellite';

const R2D = 180 / Math.PI;

/**
 * @typedef {object} Pass
 * @property {Date} aos
 * @property {Date} los
 * @property {number} [durSec]
 * @property {number} maxElDeg
 * @property {Date} maxElAt
 * @property {number} aosAzDeg
 * @property {boolean} partialStart
 * @property {boolean} partialEnd
 */

/**
 * Predict passes of one satellite over one ground site.
 *
 * @param {Satrec} satrec - satellite.js satrec (twoline2satrec output)
 * @param {{latDeg: number, lonDeg: number, heightKm?: number}} observer
 * @param {{hours?: number, stepSec?: number, minElevationDeg?: number,
 *          maxPasses?: number, start?: Date}} [opts]
 * @returns {Pass[]}
 *   partialStart: pass already in progress at window start (AOS = window start).
 *   partialEnd: window closed mid-pass (LOS = last sample inside the window).
 */
export function predictPasses(satrec, observer, opts = {}) {
  const {
    hours = 24,
    stepSec = 30,
    minElevationDeg = 10,
    maxPasses = 10,
    start = new Date(),
  } = opts;

  const observerGd = {
    latitude: satellite.degreesToRadians(observer.latDeg),
    longitude: satellite.degreesToRadians(observer.lonDeg),
    height: observer.heightKm || 0,
  };

  /** @type {Pass[]} */
  const passes = [];
  const startMs = start.getTime();
  const steps = Math.floor((hours * 3600) / stepSec);
  /** @type {Pass|null} */
  let cur = null;

  /** @param {Pass} p */
  const close = (p) => {
    p.durSec = Math.round((p.los.getTime() - p.aos.getTime()) / 1000);
    passes.push(p);
  };

  for (let i = 0; i <= steps; i++) {
    const date = new Date(startMs + i * stepSec * 1000);
    let elDeg = -90;
    let azDeg = 0;
    const pv = satellite.propagate(satrec, date);
    if (pv && pv.position && !Number.isNaN(pv.position.x)) {
      const gmst = satellite.gstime(date);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const look = satellite.ecfToLookAngles(observerGd, ecf);
      elDeg = look.elevation * R2D;
      azDeg = look.azimuth * R2D;
    }

    const up = elDeg > minElevationDeg;
    if (up && !cur) {
      cur = {
        aos: date,
        los: date,
        maxElDeg: elDeg,
        maxElAt: date,
        aosAzDeg: azDeg,
        partialStart: i === 0,
        partialEnd: false,
      };
    } else if (cur) {
      if (up) {
        cur.los = date;
        if (elDeg > cur.maxElDeg) {
          cur.maxElDeg = elDeg;
          cur.maxElAt = date;
        }
      } else {
        close(cur);
        cur = null;
        if (passes.length >= maxPasses) return passes;
      }
    }
  }

  if (cur) {
    cur.partialEnd = true;
    close(cur);
  }
  return passes.slice(0, maxPasses);
}

/**
 * First upcoming pass in the window, or null. Same honesty bounds as above.
 * @param {Satrec} satrec
 * @param {{latDeg: number, lonDeg: number, heightKm?: number}} observer
 * @param {{hours?: number, stepSec?: number, minElevationDeg?: number, start?: Date}} [opts]
 * @returns {Pass|null}
 */
export function nextPass(satrec, observer, opts = {}) {
  const list = predictPasses(satrec, observer, { ...opts, maxPasses: 1 });
  return list.length ? list[0] : null;
}
