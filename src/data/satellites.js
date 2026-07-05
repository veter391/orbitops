// @ts-check
/**
 * Simulated satellite constellations for the OrbitOps demo.
 *
 * These are NOT real TLEs. They are plausible orbital element sets arranged to
 * form a visually and behaviourally realistic LEO constellation. Each satellite
 * has:
 *   - id, name, customer (constellation)
 *   - mission (Earth observation, communications, IoT, weather, PNT)
 *   - orbital elements (inclination, RAAN, eccentricity, etc.)
 *   - subsystems: which ones are tracked in telemetry
 *   - baseline telemetry values per subsystem
 *   - bus model (manufacturer)
 *   - launch date and design lifetime
 *
 * For production: replace with real TLE catalog from CelesTrak.
 *
 * @module data/satellites
 */

'use strict';

/**
 * Build a satellite from compact orbital elements.
 * Mean motion (rad/s) = 2π / period (s); for LEO altitude ~550km, period ≈ 95 min.
 * @param {string} id
 * @param {string} name
 * @param {string} customer
 * @param {string} mission
 * @param {SatOpts} opts
 * @returns {Satellite}
 */
function sat(id, name, customer, mission, opts) {
  const period = opts.periodSec ?? 95 * 60;
  const meanMotion = (2 * Math.PI) / period;
  return {
    id,
    name,
    customer,
    mission,
    bus: opts.bus ?? 'Generic-LEO',
    launchDate: opts.launchDate ?? '2024-06-15',
    designLifetimeYears: opts.lifetime ?? 5,
    elements: {
      inclination: (opts.inclinationDeg ?? 53) * Math.PI / 180,
      raan: (opts.raanDeg ?? 0) * Math.PI / 180,
      eccentricity: opts.eccentricity ?? 0.0001,
      argPerigee: (opts.argPerigeeDeg ?? 0) * Math.PI / 180,
      meanAnomaly: (opts.meanAnomalyDeg ?? 0) * Math.PI / 180,
      meanMotion,
    },
    altitude: opts.altitudeKm ?? 550,
    subsystems: opts.subsystems ?? ['power', 'thermal', 'attitude', 'comms', 'propulsion', 'payload'],
    baselines: opts.baselines ?? {
      batteryVoltage: 28.5,
      batteryTemp: 22,
      panelTemp: 35,
      cpuTemp: 45,
      attitudeError: 0.05,
      fuelKg: 12.0,
      signalStrength: -85,
      dataRateMbps: 50,
    },
  };
}

/**
 * 50 simulated satellites across 6 plausible constellations.
 * Customers/missions are illustrative — these are NOT real operator names
 * except for the public ones (Starlink / OneWeb mentioned as count references).
 */
export const SATELLITES = [
  // ORBIT-1 — Communications constellation (12 sats)
  ...Array.from({ length: 12 }, (_, i) => {
    const plane = Math.floor(i / 4);
    const phase = i % 4;
    return sat(
      `oo1-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-1 ${plane + 1}-${phase + 1}`,
      'OrbitOne Communications',
      'communications',
      {
        inclinationDeg: 53,
        raanDeg: plane * 30,
        meanAnomalyDeg: phase * 90,
        altitudeKm: 550,
        bus: 'OrbitOne-A100',
        launchDate: '2024-08-22',
      }
    );
  }),

  // ORBIT-2 — Earth observation (8 sats)
  ...Array.from({ length: 8 }, (_, i) => {
    const plane = Math.floor(i / 2);
    const phase = i % 2;
    return sat(
      `oo2-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-2 ${plane + 1}-${phase + 1}`,
      'OrbitTwo Imaging',
      'earth-observation',
      {
        inclinationDeg: 97.6, // sun-synchronous
        raanDeg: plane * 45,
        meanAnomalyDeg: phase * 180,
        altitudeKm: 500,
        bus: 'OrbitTwo-Obs300',
        launchDate: '2023-11-10',
        eccentricity: 0.00015,
        baselines: {
          batteryVoltage: 28.0,
          batteryTemp: 18,
          panelTemp: 28,
          cpuTemp: 38,
          attitudeError: 0.02,
          fuelKg: 8.0,
          signalStrength: -78,
          dataRateMbps: 200,
        },
      }
    );
  }),

  // ORBIT-3 — IoT constellation (15 sats)
  ...Array.from({ length: 15 }, (_, i) => {
    const plane = Math.floor(i / 5);
    const phase = i % 5;
    return sat(
      `oo3-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-3 ${plane + 1}-${phase + 1}`,
      'OrbitThree IoT',
      'iot',
      {
        inclinationDeg: 87, // near-polar
        raanDeg: plane * 24,
        meanAnomalyDeg: phase * 72,
        altitudeKm: 600,
        bus: 'OrbitThree-Cube6U',
        launchDate: '2025-01-30',
        eccentricity: 0.0002,
        baselines: {
          batteryVoltage: 12.0, // smallsat
          batteryTemp: 15,
          panelTemp: 22,
          cpuTemp: 32,
          attitudeError: 0.15,
          fuelKg: 0.5,
          signalStrength: -110,
          dataRateMbps: 0.5,
        },
      }
    );
  }),

  // ORBIT-4 — Weather / atmospheric (6 sats)
  ...Array.from({ length: 6 }, (_, i) => {
    const plane = Math.floor(i / 2);
    const phase = i % 2;
    return sat(
      `oo4-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-4 ${plane + 1}-${phase + 1}`,
      'OrbitFour Weather',
      'weather',
      {
        inclinationDeg: 99,
        raanDeg: plane * 60,
        meanAnomalyDeg: phase * 180,
        altitudeKm: 820,
        bus: 'OrbitFour-Met700',
        launchDate: '2024-04-18',
        eccentricity: 0.0001,
        baselines: {
          batteryVoltage: 32.0,
          batteryTemp: 20,
          panelTemp: 38,
          cpuTemp: 42,
          attitudeError: 0.08,
          fuelKg: 25.0,
          signalStrength: -82,
          dataRateMbps: 100,
        },
      }
    );
  }),

  // ORBIT-5 — PNT (positioning) (5 sats)
  ...Array.from({ length: 5 }, (_, i) => {
    return sat(
      `oo5-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-5 PNT-${i + 1}`,
      'OrbitFive Navigation',
      'pnt',
      {
        inclinationDeg: 55,
        raanDeg: i * 72,
        meanAnomalyDeg: 0,
        altitudeKm: 20180, // MEO-ish for demo (compressed)
        bus: 'OrbitFive-Nav100',
        launchDate: '2022-09-05',
        eccentricity: 0.005,
        baselines: {
          batteryVoltage: 28.0,
          batteryTemp: 18,
          panelTemp: 30,
          cpuTemp: 40,
          attitudeError: 0.01,
          fuelKg: 40.0,
          signalStrength: -125,
          dataRateMbps: 10,
        },
      }
    );
  }),

  // ORBIT-6 — Communications (LEO broadband, smaller) (4 sats)
  ...Array.from({ length: 4 }, (_, i) => {
    return sat(
      `oo6-${String(i + 1).padStart(2, '0')}`,
      `ORBIT-6 BB-${i + 1}`,
      'OrbitSix Broadband',
      'communications',
      {
        inclinationDeg: 70,
        raanDeg: i * 90,
        meanAnomalyDeg: 0,
        altitudeKm: 1200,
        bus: 'OrbitSix-BB500',
        launchDate: '2025-03-12',
        eccentricity: 0.0002,
        baselines: {
          batteryVoltage: 48.0,
          batteryTemp: 22,
          panelTemp: 40,
          cpuTemp: 50,
          attitudeError: 0.04,
          fuelKg: 18.0,
          signalStrength: -88,
          dataRateMbps: 400,
        },
      }
    );
  }),
];

export const SATELLITE_BY_ID = Object.fromEntries(SATELLITES.map((s) => [s.id, s]));

export const CUSTOMERS = Array.from(new Set(SATELLITES.map((s) => s.customer)));

export const MISSIONS = Array.from(new Set(SATELLITES.map((s) => s.mission)));

/** Color mapping for missions (used in cockpit). */
export const MISSION_COLORS = {
  communications: '#00d4ff',
  'earth-observation': '#b8ff5c',
  iot: '#ffb84d',
  weather: '#ff5e7a',
  pnt: '#8b5cf6',
  default: '#5cf3ff',
};

/** Display metadata for the simulated clock (mission starts in 2024). */
export const EPOCH_ISO = '2025-01-01T00:00:00Z';