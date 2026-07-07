/**
 * Agent eval set: fixed scenarios with known-correct expectations. The evals
 * harness (test/agent-evals.test.ts) runs each through the real agent and checks
 * routing + action + quality, plus the universal safety invariant that NO run
 * ever auto-executes (every proposal must be pending). Grow this set as the
 * agent's domain deepens.
 */

export interface Scenario {
  name: string;
  input: { satelliteId: string; signals: Record<string, unknown>[] };
  expect: {
    /** Node that must appear in the executed path. */
    route: 'conjunctionScreener' | 'anomalyTriager' | 'investigate';
    /** proposedAction.type the run must settle on. */
    actionType: string;
    /** Minimum probability of collision the screener must compute (if set). */
    minPc?: number;
    /** A sized avoidance burn (deltaVMs > 0) must be present (if set). */
    hasBurn?: boolean;
  };
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'critical conjunction with geometry → maneuver + real Pc + sized burn',
    input: {
      satelliteId: 'eval-conj-critical',
      signals: [
        { kind: 'conjunction', missDistanceKm: 0.02, sigmaKm: 0.1, combinedRadiusKm: 0.02, timeToTcaSec: 21600 },
      ],
    },
    expect: { route: 'conjunctionScreener', actionType: 'maneuver', minPc: 1e-4, hasBurn: true },
  },
  {
    name: 'battery degradation → load shed',
    input: { satelliteId: 'eval-batt', signals: [{ kind: 'battery_degradation', severity: 0.7 }] },
    expect: { route: 'anomalyTriager', actionType: 'load_shed' },
  },
  {
    name: 'thermal anomaly → thermal mitigation',
    input: { satelliteId: 'eval-therm', signals: [{ kind: 'thermal_anomaly', severity: 0.7 }] },
    expect: { route: 'anomalyTriager', actionType: 'thermal_mitigation' },
  },
  {
    name: 'attitude drift → attitude correction',
    input: { satelliteId: 'eval-att', signals: [{ kind: 'attitude_drift', severity: 0.6 }] },
    expect: { route: 'anomalyTriager', actionType: 'attitude_correction' },
  },
  {
    name: 'comms degradation → link handoff',
    input: { satelliteId: 'eval-comms', signals: [{ kind: 'comms_degradation', severity: 0.5 }] },
    expect: { route: 'anomalyTriager', actionType: 'link_handoff' },
  },
  {
    name: 'unknown signal → investigate',
    input: { satelliteId: 'eval-unknown', signals: [{ kind: 'mystery' }] },
    expect: { route: 'investigate', actionType: 'investigate' },
  },
  {
    name: 'no signals → investigate',
    input: { satelliteId: 'eval-none', signals: [] },
    expect: { route: 'investigate', actionType: 'investigate' },
  },
];
