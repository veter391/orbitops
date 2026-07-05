/**
 * Shared domain types for OrbitOps core/, referenced from JSDoc (`@param`,
 * `@returns`, `@type`). Declared globally so any `// @ts-check`'d module can use
 * them without an import. Type-only — never shipped, so the zero-build
 * "clone and serve" property is untouched.
 */

/** App-scoped globals set on window (double-mount guards, interval handles). */
interface Window {
  __orbitopsCursorSat?: boolean;
  __orbitopsUtcClock?: ReturnType<typeof setInterval>;
}

/** A 3-vector in km (position) or km/s (velocity), ECI or scene frame. */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** SGP4 propagation output from satellite.js. */
interface StateVectors {
  position: Vec3;
  velocity: Vec3;
}

/**
 * An opaque satellite record from satellite.js `twoline2satrec`. Only the
 * fields OrbitOps reads are named; the rest of the library's record is allowed
 * through the index signature.
 */
interface Satrec {
  /** mean motion, rad/min */
  no: number;
  /** inclination, rad */
  inclo: number;
  /** eccentricity */
  ecco: number;
  [key: string]: unknown;
}

/** A parsed TLE record: name + the two element lines + catalog number. */
interface TleRecord {
  name: string;
  line1: string;
  line2: string;
  noradId: number;
}

/** A propagation-ready satellite: display name, catalog id, and its satrec. */
interface SatObject {
  name: string;
  noradId: number;
  satrec: Satrec;
  group?: string;
}

/** Sub-satellite geodetic point + altitude. */
interface Geodetic {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}

/** An observer ground site for look-angle / pass math. */
interface ObserverSite {
  latDeg: number;
  lonDeg: number;
  altKm?: number;
}

/** Classical orbital elements (COE), all angles in radians, motion in rad/s. */
interface OrbitalElements {
  inclination: number;
  raan: number;
  eccentricity: number;
  argPerigee: number;
  meanAnomaly: number;
  meanMotion: number;
}

/** Baseline telemetry values for the simulated fleet. */
interface TelemetryBaselines {
  batteryVoltage: number;
  batteryTemp: number;
  panelTemp: number;
  cpuTemp: number;
  attitudeError: number;
  fuelKg: number;
  signalStrength: number;
  dataRateMbps: number;
}

/** A simulated demo satellite (data/satellites.js). Real catalog objects use SatObject. */
interface Satellite {
  id: string;
  name: string;
  customer: string;
  mission: string;
  bus: string;
  launchDate: string;
  designLifetimeYears: number;
  elements: OrbitalElements;
  altitude: number;
  subsystems: string[];
  baselines: TelemetryBaselines;
}

/** Options accepted by the data/satellites.js `sat()` factory. */
interface SatOpts {
  periodSec?: number;
  bus?: string;
  launchDate?: string;
  lifetime?: number;
  inclinationDeg?: number;
  raanDeg?: number;
  eccentricity?: number;
  argPerigeeDeg?: number;
  meanAnomalyDeg?: number;
  altitudeKm?: number;
  subsystems?: string[];
  baselines?: TelemetryBaselines;
}
