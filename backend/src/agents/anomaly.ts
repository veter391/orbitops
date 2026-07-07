/**
 * Deterministic robust anomaly detection — no LLM. Used by the AnomalyTriager
 * to judge whether a telemetry reading is out of family against that metric's
 * recent history.
 *
 * Uses the modified z-score (Iglewicz & Hoaglin): median and MAD (median
 * absolute deviation) instead of mean/stdev, so a few wild readings in the
 * baseline don't hide a real anomaly. The 0.6745 constant makes MAD a consistent
 * estimator of σ for normally-distributed data; |z| ≥ 3.5 is the standard cutoff.
 */

const THRESHOLD = 3.5;

export interface AnomalyResult {
  isAnomaly: boolean;
  zscore: number;
  severity: number; // 0..1
  median: number;
  mad: number;
  n: number; // baseline sample size actually used
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Judge `current` against a `baseline` of recent values for the same metric. */
export function detectAnomaly(current: number, baseline: number[]): AnomalyResult {
  const clean = baseline.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (n < 3 || !Number.isFinite(current)) {
    return { isAnomaly: false, zscore: 0, severity: 0, median: NaN, mad: NaN, n };
  }
  const med = median(clean);
  const mad = median(clean.map((v) => Math.abs(v - med)));
  // A degenerate (constant) baseline has MAD 0; any deviation from it is then
  // strongly anomalous, so use a tiny epsilon rather than dividing by zero.
  const denom = mad > 0 ? mad : 1e-9;
  const zscore = (0.6745 * (current - med)) / denom;
  const az = Math.abs(zscore);
  return {
    isAnomaly: az >= THRESHOLD,
    zscore,
    severity: Math.min(1, az / (2 * THRESHOLD)),
    median: med,
    mad,
    n,
  };
}
