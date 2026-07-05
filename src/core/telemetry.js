// @ts-check
/**
 * Telemetry — synthetic but realistic telemetry generator.
 *
 * Each satellite has a baseline value per subsystem; we add bounded noise plus
 * slow drift plus occasional transient events. The generator is deterministic
 * given (satellite, time), so the demo plays back identically.
 *
 * For production: replace with a real Kafka/WebSocket subscription from the
 * ground station gateway.
 *
 * @module core/telemetry
 */

'use strict';

import { SATELLITES } from '../data/satellites.js';

/**
 * Seeded RNG so the same time + satellite always produces the same value.
 * Uses mulberry32.
 */
/** @param {number} seed @returns {() => number} */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash string to integer seed. @param {string} s @returns {number} */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h | 0;
}

/**
 * Compute telemetry values for one satellite at time t.
 * Subsystems: power, thermal, attitude, comms, propulsion, payload.
 *
 * Each subsystem returns 1-3 metrics. Each metric has value, unit, quality.
 *
 * @param {Satellite} satellite - from SATELLITES
 * @param {number} t - time in seconds since epoch
 * @returns {Record<string, any>} telemetry keyed by subsystem
 */
export function generate(satellite, t) {
  const r = rng(hash(`${satellite.id}-${Math.floor(t)}`));
  const baseline = satellite.baselines;
  const slowDrift = Math.sin(t / 3600) * 0.05; // ±5% over hour

  // Subsystem metrics
  /** @type {Record<string, any>} */
  const telemetry = {};

  // POWER — battery voltage and temperature
  const eclipse = isInEclipse(satellite, t);
  telemetry.power = {
    batteryVoltage: {
      value: eclipse
        ? baseline.batteryVoltage * (0.93 + r() * 0.02)
        : baseline.batteryVoltage * (1.0 + slowDrift + (r() - 0.5) * 0.01),
      unit: 'V',
      quality: 'good',
    },
    batteryTemp: {
      value: baseline.batteryTemp + (eclipse ? -5 : 0) + slowDrift * 3 + (r() - 0.5) * 1.5,
      unit: '°C',
      quality: 'good',
    },
    panelCurrent: {
      value: eclipse ? 0 : 6 + r() * 0.5,
      unit: 'A',
      quality: 'good',
    },
  };

  // THERMAL — panel and CPU temperature
  telemetry.thermal = {
    panelTemp: {
      value: baseline.panelTemp + (eclipse ? -8 : 0) + slowDrift * 4 + (r() - 0.5) * 2,
      unit: '°C',
      quality: 'good',
    },
    cpuTemp: {
      value: baseline.cpuTemp + slowDrift * 2 + (r() - 0.5) * 1.2,
      unit: '°C',
      quality: 'good',
    },
    radiatorTemp: {
      value: baseline.panelTemp - 12 + slowDrift * 2 + (r() - 0.5) * 1,
      unit: '°C',
      quality: 'good',
    },
  };

  // ATTITUDE — pointing error, reaction wheel speeds
  telemetry.attitude = {
    pointingError: {
      value: baseline.attitudeError + (r() - 0.5) * 0.02,
      unit: 'deg',
      quality: 'good',
    },
    wheelSpeed: {
      value: 1500 + (r() - 0.5) * 200,
      unit: 'rpm',
      quality: 'good',
    },
  };

  // COMMS — signal strength, data rate
  telemetry.comms = {
    signalStrength: {
      value: baseline.signalStrength + (r() - 0.5) * 3,
      unit: 'dBm',
      quality: 'good',
    },
    dataRate: {
      value: baseline.dataRateMbps * (0.85 + r() * 0.3),
      unit: 'Mbps',
      quality: 'good',
    },
    packetLoss: {
      value: r() * 0.5,
      unit: '%',
      quality: 'good',
    },
  };

  // PROPULSION — fuel mass, tank pressure
  telemetry.propulsion = {
    fuelMass: {
      value: baseline.fuelKg + slowDrift * 0.1,
      unit: 'kg',
      quality: 'good',
    },
    tankPressure: {
      value: 35 + (r() - 0.5) * 0.5,
      unit: 'bar',
      quality: 'good',
    },
  };

  // PAYLOAD — specific to mission
  if (satellite.mission === 'earth-observation') {
    telemetry.payload = {
      imageQuality: {
        value: 0.85 + r() * 0.1,
        unit: 'MTF',
        quality: 'good',
      },
      detectorTemp: {
        value: -40 + (r() - 0.5) * 0.5,
        unit: '°C',
        quality: 'good',
      },
    };
  } else if (satellite.mission === 'communications') {
    telemetry.payload = {
      uplinkBER: {
        value: 1e-9 + r() * 1e-10,
        unit: '',
        quality: 'good',
      },
      transponderTemp: {
        value: 32 + (r() - 0.5) * 1,
        unit: '°C',
        quality: 'good',
      },
    };
  } else {
    telemetry.payload = {
      healthScore: {
        value: 0.95 + r() * 0.05,
        unit: '',
        quality: 'good',
      },
    };
  }

  return telemetry;
}

/**
 * Apply a transient anomaly to telemetry (used by the AI agent scenarios).
 * @param {any} telemetry - from generate() (subsystems accessed dynamically)
 * @param {string} kind - one of 'battery_drain', 'thermal_overheat', 'comms_degraded', 'attitude_drift', 'fuel_low'
 * @param {number} [magnitude=0.5] - severity (0..1)
 * @returns {any}
 */
export function applyAnomaly(telemetry, kind, magnitude = 0.5) {
  const t = telemetry;
  switch (kind) {
    case 'battery_drain':
      t.power.batteryVoltage.value *= 1 - 0.15 * magnitude;
      t.power.batteryTemp.value += 8 * magnitude;
      t.power.batteryVoltage.quality = 'warn';
      break;
    case 'thermal_overheat':
      t.thermal.cpuTemp.value += 25 * magnitude;
      t.thermal.panelTemp.value += 18 * magnitude;
      t.thermal.cpuTemp.quality = 'critical';
      break;
    case 'comms_degraded':
      t.comms.signalStrength.value -= 12 * magnitude;
      t.comms.packetLoss.value += 8 * magnitude;
      t.comms.signalStrength.quality = 'warn';
      break;
    case 'attitude_drift':
      t.attitude.pointingError.value *= 1 + 8 * magnitude;
      t.attitude.wheelSpeed.value *= 1 + 0.3 * magnitude;
      t.attitude.pointingError.quality = 'warn';
      break;
    case 'fuel_low':
      t.propulsion.fuelMass.value *= 1 - 0.4 * magnitude;
      t.propulsion.tankPressure.value *= 1 - 0.2 * magnitude;
      t.propulsion.fuelMass.quality = 'critical';
      break;
  }
  return t;
}

/**
 * Heuristic: is the satellite currently in Earth's shadow?
 * @param {Satellite} satellite
 * @param {number} t
 * @returns {boolean}
 */
function isInEclipse(satellite, t) {
  // Simplified: ~35 minutes of every 95-minute orbit in shadow
  const period = (2 * Math.PI) / satellite.elements.meanMotion;
  const phase = (t % period) / period; // 0..1
  // Eclipse near phase 0.5 (between sunlit portions)
  return phase > 0.42 && phase < 0.58;
}

/**
 * Get a flat array of (metric, value, unit) for a satellite at time t.
 * Useful for table rendering and anomaly detection.
 * @param {Satellite} satellite
 * @param {number} t
 * @returns {Array<{subsystem: string, metric: string, value: number, unit: string, quality: string}>}
 */
export function flatten(satellite, t) {
  const tlm = generate(satellite, t);
  /** @type {Array<{subsystem: string, metric: string, value: number, unit: string, quality: string}>} */
  const flat = [];
  for (const [subsystem, metrics] of Object.entries(tlm)) {
    for (const [metric, data] of Object.entries(metrics)) {
      flat.push({
        subsystem,
        metric,
        value: data.value,
        unit: data.unit,
        quality: data.quality,
      });
    }
  }
  return flat;
}

/**
 * Generate telemetry for the entire constellation at time t.
 * @param {number} t
 * @returns {Record<string, any>}
 */
export function constellationTelemetry(t) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const sat of SATELLITES) {
    out[sat.id] = generate(sat, t);
  }
  return out;
}