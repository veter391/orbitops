/**
 * High-fidelity 2D probability of collision (Pc) for a short-term conjunction —
 * the Foster-1992 method as implemented by NASA CARA (Pc2D_Foster). Deterministic,
 * dependency-free, and validated against NASA's own "Omitron" unit-test vector
 * (see test/pc2d.test.ts, expected Pc = 2.70601573490125e-05). No LLM.
 *
 * Method: project both objects' 3x3 position covariances (in a common inertial /
 * ECI frame) into the 2D encounter plane — the plane perpendicular to the
 * relative velocity at the time of closest approach (TCA) — sum them, and
 * integrate the resulting 2D Gaussian over the combined hard-body disk. The inner
 * (cross-track) integral is evaluated analytically with erf, leaving a single
 * robust 1D adaptive-Simpson quadrature — avoiding the convergence pitfalls of
 * the Chan analytic series.
 *
 * Assumptions (short-term encounter): Gaussian relative uncertainty at TCA,
 * rectilinear relative motion, and covariance constant through the brief
 * encounter. The inputs MUST be the two objects' states AT TCA, where the
 * relative position is perpendicular to the relative velocity (r · v = 0) — the
 * projected miss is then simply |r_rel|. These assumptions degrade for slow or
 * highly-curved encounters (a full 3D / Monte-Carlo Pc is future work); for the
 * vast majority of LEO conjunctions this is the operational method.
 *
 * Refs: Alfano, "Review of Conjunction Probability Methods for Short-term
 * Encounters"; NASA CARA `Pc2D_Foster.m`; "How the JSpOC Calculates Probability
 * of Collision" (space-track.org).
 */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
type Mat2 = [[number, number], [number, number]];

export interface ObjectState {
  /** Position in a common inertial (ECI) frame, km. */
  r: Vec3;
  /** Velocity in the same frame, km/s. */
  v: Vec3;
  /** 3x3 position covariance in the same ECI frame, km². */
  cov: Mat3;
}

export interface Pc2dResult {
  /** Probability of collision in [0, 1]. */
  pc: number;
  /** Projected miss distance in the encounter plane, km (= |r_rel| at TCA). */
  missKm: number;
  /** Encounter-plane 1σ along the principal axes, km (smaller, larger). */
  sigmaMinKm: number;
  sigmaMaxKm: number;
}

// ── small linear algebra (3-vectors / 3x3 / 2x2) ────────────────────────────
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normV(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function unit(a: Vec3): Vec3 {
  const n = normV(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
function addMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
    [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
  ];
}

/** Rotate a covariance by rotation R whose ROWS are the new-frame basis vectors: Cnew = R·C·Rᵀ. */
function rotateCov(R: Mat3, C: Mat3): Mat3 {
  const [r0, r1, r2] = R;
  // M = R·C — each output row is (a row of R) times C.
  const mul = (row: Vec3): Vec3 => [
    row[0] * C[0][0] + row[1] * C[1][0] + row[2] * C[2][0],
    row[0] * C[0][1] + row[1] * C[1][1] + row[2] * C[2][1],
    row[0] * C[0][2] + row[1] * C[1][2] + row[2] * C[2][2],
  ];
  const m0 = mul(r0);
  const m1 = mul(r1);
  const m2 = mul(r2);
  // Cnew = M·Rᵀ — entry (i, j) = (row i of M) · (row j of R).
  return [
    [dot(m0, r0), dot(m0, r1), dot(m0, r2)],
    [dot(m1, r0), dot(m1, r1), dot(m1, r2)],
    [dot(m2, r0), dot(m2, r1), dot(m2, r2)],
  ];
}

/** Eigenvalues of a symmetric 2x2 matrix (for reporting principal-axis sigmas). */
function eig2(m: Mat2): [number, number] {
  const a = m[0][0];
  const b = m[0][1];
  const d = m[1][1];
  const tr = a + d;
  const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
  return [tr / 2 - disc, tr / 2 + disc];
}

/** erf via Abramowitz & Stegun 7.1.26 (|abs error| < 1.5e-7); odd extension for x<0. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}

/** Adaptive Simpson 1D quadrature of f over [a, b] to absolute tolerance `tol`. */
function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol: number): number {
  const fa = f(a);
  const fb = f(b);
  const c = (a + b) / 2;
  const fc = f(c);
  const s = ((b - a) / 6) * (fa + 4 * fc + fb);
  const rec = (
    a1: number,
    b1: number,
    fa1: number,
    fb1: number,
    fc1: number,
    s1: number,
    tol1: number,
    depth: number,
  ): number => {
    const c1 = (a1 + b1) / 2;
    const d = (a1 + c1) / 2;
    const e = (c1 + b1) / 2;
    const fd = f(d);
    const fe = f(e);
    const sl = ((c1 - a1) / 6) * (fa1 + 4 * fd + fc1);
    const sr = ((b1 - c1) / 6) * (fc1 + 4 * fe + fb1);
    const s2 = sl + sr;
    if (depth <= 0 || Math.abs(s2 - s1) <= 15 * tol1) return s2 + (s2 - s1) / 15;
    return (
      rec(a1, c1, fa1, fc1, fd, sl, tol1 / 2, depth - 1) +
      rec(c1, b1, fc1, fb1, fe, sr, tol1 / 2, depth - 1)
    );
  };
  return rec(a, b, fa, fb, fc, s, tol, 50);
}

/**
 * Integrate the zero-mean 2D Gaussian with covariance `Cp` over the disk of
 * radius `R` centered at (x0, 0) — the encounter-plane Pc integral. The inner
 * integral (over the cross-track axis) is done analytically with erf.
 */
function integratePc(Cp: Mat2, x0: number, R: number): number {
  const det = Cp[0][0] * Cp[1][1] - Cp[0][1] * Cp[1][0];
  if (!(det > 0) || !(R > 0)) return 0;
  // inv(Cp)
  const iC11 = Cp[1][1] / det;
  const iC12 = -Cp[0][1] / det;
  const iC21 = -Cp[1][0] / det;
  const iC22 = Cp[0][0] / det;
  const a = iC22;
  if (!(a > 0)) return 0;
  const sA = Math.sqrt(a / 2);
  const norm = 1 / (2 * Math.PI * Math.sqrt(det));

  const outer = (x: number): number => {
    const half = R * R - (x - x0) * (x - x0);
    if (half <= 0) return 0;
    const b = Math.sqrt(half);
    const beta = (iC12 + iC21) * x; // linear-in-z coefficient
    const shift = beta / (2 * a);
    // ∫_{-b}^{b} exp(-½(a z² + beta z)) dz = exp(beta²/(8a))·√(π/2a)·[erf(...) - erf(...)]
    const inner =
      Math.exp((beta * beta) / (8 * a)) *
      Math.sqrt(Math.PI / (2 * a)) *
      (erf((b + shift) * sA) - erf((-b + shift) * sA));
    return Math.exp(-0.5 * iC11 * x * x) * inner;
  };

  const raw = adaptiveSimpson(outer, x0 - R, x0 + R, 1e-12);
  const pc = norm * raw;
  return Math.min(1, Math.max(0, pc));
}

/**
 * Full 2D probability of collision for two objects given at TCA. `combinedRadiusKm`
 * is the sum of both objects' hard-body radii (the combined HBR).
 */
export function probabilityOfCollision2D(
  o1: ObjectState,
  o2: ObjectState,
  combinedRadiusKm: number,
): Pc2dResult {
  const Ccomb = addMat3(o1.cov, o2.cov);
  const r = sub(o1.r, o2.r);
  const v = sub(o1.v, o2.v);
  const h = cross(r, v);
  const missKm = normV(r);

  // Encounter frame: ŷ along relative velocity, ẑ along relative angular
  // momentum, x̂ completing the right-handed triad (in-plane miss direction).
  const yhat = unit(v);
  const zhat = unit(h);
  const xhat = cross(yhat, zhat); // unit, since ŷ ⟂ ẑ
  const Rrot: Mat3 = [xhat, yhat, zhat];
  const Cxyz = rotateCov(Rrot, Ccomb);
  // Project out the velocity (ŷ) axis: keep the x–z encounter plane.
  const Cp: Mat2 = [
    [Cxyz[0][0], Cxyz[0][2]],
    [Cxyz[2][0], Cxyz[2][2]],
  ];

  const pc = integratePc(Cp, missKm, combinedRadiusKm);
  const [l1, l2] = eig2(Cp);
  return {
    pc,
    missKm,
    sigmaMinKm: Math.sqrt(Math.max(0, Math.min(l1, l2))),
    sigmaMaxKm: Math.sqrt(Math.max(0, Math.max(l1, l2))),
  };
}

/** Diagnostic: relative-position·velocity dot at the given states (≈0 at TCA). */
export function rDotV(o1: ObjectState, o2: ObjectState): number {
  return dot(sub(o1.r, o2.r), sub(o1.v, o2.v));
}
