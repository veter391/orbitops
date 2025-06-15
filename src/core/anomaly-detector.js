/**
 * Anomaly detector — three classes of anomaly over telemetry:
 *
 *   1. POINT       — single reading outside expected distribution
 *   2. CONTEXTUAL  — reading OK globally but bad in this context (e.g. eclipse)
 *   3. COLLECTIVE  — individual readings OK, but pattern is anomalous (drift)
 *
 * For the demo, all three are deterministic and run over synthetic telemetry.
 *
 * For production: replace with online ML (Isolation Forest / LSTM autoencoder)
 * trained on per-customer telemetry baselines.
 *
 * @module core/anomaly-detector
 */

'use strict';

import { flatten, generate } from './telemetry.js';
import { SATELLITES } from '../data/satellites.js';

/**
 * Simple online statistics (Welford) per (subsystem, metric).
 */
class OnlineStats {
  constructor() {
    this.n = 0;
    this.mean = 0;
    this.M2 = 0;
  }
  update(x) {
    this.n++;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
  }
  variance() {
    return this.n < 2 ? 0 : this.M2 / (this.n - 1);
  }
  stdev() {
    return Math.sqrt(this.variance());
  }
}

/**
 * Per-satellite running stats cache (would normally be in a database).
 */
const stats = new Map();

function getStats(satId) {
  if (!stats.has(satId)) stats.set(satId, new Map());
  return stats.get(satId);
}

/**
 * Train the detector on baseline telemetry (the first 30 minutes).
 * Updates running stats so subsequent calls can detect anomalies.
 *
 * @param {Object} satellite
 */
export function train(satellite, durationSec = 1800, sampleStepSec = 30) {
  const satStats = getStats(satellite.id);
  for (let t = 0; t < durationSec; t += sampleStepSec) {
    const tlm = generate(satellite, t);
    const flat = flatten(satellite, t);
    for (const { subsystem, metric, value } of flat) {
      const key = `${subsystem}.${metric}`;
      if (!satStats.has(key)) satStats.set(key, new OnlineStats());
      satStats.get(key).update(value);
    }
  }
}

/** Pre-train all satellites at startup. */
export function trainAll() {
  for (const sat of SATELLITES) train(sat);
}

/**
 * Detect anomalies in telemetry for one satellite at time t.
 *
 * Returns an array of anomalies:
 *   { subsystem, metric, severity, kind, value, mean, stdev, message }
 *
 * Severity: 'info' | 'warn' | 'critical'
 *
 * @param {Object} satellite
 * @param {number} t
 * @param {Object} telemetry - from generate() (or applyAnomaly)
 */
export function detect(satellite, t, telemetry) {
  const satStats = getStats(satellite.id);
  const anomalies = [];
  const flat = flatten(satellite, t);
  for (const { subsystem, metric, value, quality } of flat) {
    const key = `${subsystem}.${metric}`;
    const stat = satStats.get(key);
    if (!stat || stat.n < 30) continue;
    const z = Math.abs((value - stat.mean) / (stat.stdev() || 1));

    // Classify severity
    let severity = null;
    let kind = null;
    if (z > 4) {
      severity = 'critical';
      kind = 'point';
    } else if (z > 2.5) {
      severity = 'warn';
      kind = 'point';
    } else if (quality === 'warn' || quality === 'critical') {
      // Quality already marked by anomaly injection
      severity = quality === 'critical' ? 'critical' : 'warn';
      kind = 'contextual';
    }

    if (severity) {
      anomalies.push({
        subsystem,
        metric,
        value,
        mean: stat.mean,
        stdev: stat.stdev(),
        z,
        severity,
        kind,
        message: `${metric} ${severity}: ${value.toFixed(2)} (expected ${stat.mean.toFixed(2)} ± ${stat.stdev().toFixed(2)})`,
        satId: satellite.id,
        satName: satellite.name,
        customer: satellite.customer,
        t,
      });
    }
  }

  // Detect drift: if 3+ metrics in same subsystem are drifting in same direction
  for (const [subsystem, metrics] of groupBy(flat, 'subsystem').entries()) {
    let positive = 0;
    let negative = 0;
    for (const { metric, value } of metrics) {
      const key = `${subsystem}.${metric}`;
      const stat = satStats.get(key);
      if (!stat) continue;
      const diff = value - stat.mean;
      if (diff > stat.stdev() * 0.5) positive++;
      else if (diff < -stat.stdev() * 0.5) negative++;
    }
    if (positive >= 3 || negative >= 3) {
      anomalies.push({
        subsystem,
        metric: 'collective',
        severity: positive >= 3 ? 'warn' : 'warn',
        kind: 'collective',
        message: `Collective drift detected in ${subsystem} (${Math.max(positive, negative)} metrics trending ${positive > negative ? 'up' : 'down'})`,
        satId: satellite.id,
        satName: satellite.name,
        customer: satellite.customer,
        t,
      });
    }
  }

  return anomalies;
}

function groupBy(arr, key) {
  const out = new Map();
  for (const item of arr) {
    const k = item[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/**
 * Detect all anomalies across the constellation at time t.
 *
 * @param {number} t
 * @returns {Array} - sorted by severity, then z-score
 */
export function detectAll(t) {
  const all = [];
  for (const sat of SATELLITES) {
    const tlm = generate(sat, t);
    const anomalies = detect(sat, t, tlm);
    all.push(...anomalies);
  }
  return all.sort((a, b) => {
    const sevOrder = { critical: 0, warn: 1, info: 2 };
    if (a.severity !== b.severity) return sevOrder[a.severity] - sevOrder[b.severity];
    return (b.z || 0) - (a.z || 0);
  });
}

export function resetStats() {
  stats.clear();
}