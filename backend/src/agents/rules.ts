/**
 * Deterministic domain rules shared by the specialist agents. This is the
 * safety core: signal classification, hypotheses, and recommended actions are
 * plain data + math with no LLM involved (the LLM only ever annotates).
 */

export interface Signal {
  kind: string;
  detail?: string;
  metric?: string;
  value?: number;
  /** Caller's likelihood/confidence hint, 0..1 (fallback when no domain data). */
  severity?: number;
  // Conjunction geometry (optional) — lets the ConjunctionScreener compute a
  // real probability of collision instead of using the severity hint.
  missDistanceKm?: number;
  sigmaKm?: number;
  combinedRadiusKm?: number;
  // Maneuver-sizing inputs (optional) — let the ManeuverPlanner size a real burn.
  timeToTcaSec?: number;
  satMassKg?: number;
  ispSec?: number;
  /** Remaining propellant budget (kg); the compliance critic flags overruns. */
  propellantBudgetKg?: number;
}

export interface Rule {
  hypothesis: string;
  action: { type: string; params?: Record<string, unknown> };
  baseSeverity: number; // 0..1
}

export interface Candidate {
  rule: Rule;
  signal: Signal;
  likelihood: number;
  score: number;
}

/** Signal kinds handled by the ConjunctionScreener. */
export const CONJUNCTION_KINDS = new Set(['conjunction']);

/** Signal kinds handled by the AnomalyTriager. */
export const ANOMALY_KINDS = new Set([
  'battery_degradation',
  'thermal_anomaly',
  'attitude_drift',
  'comms_degradation',
]);

/** Signal kind → working hypothesis + recommended action. */
export const RULES: Record<string, Rule> = {
  conjunction: {
    hypothesis: 'Predicted close approach below safe miss distance',
    action: { type: 'maneuver', params: { profile: 'avoidance_burn' } },
    baseSeverity: 0.9,
  },
  battery_degradation: {
    hypothesis: 'Battery capacity fading faster than model',
    action: { type: 'load_shed', params: { profile: 'conserve' } },
    baseSeverity: 0.7,
  },
  thermal_anomaly: {
    hypothesis: 'Subsystem temperature outside safe envelope',
    action: { type: 'thermal_mitigation', params: { profile: 'reorient_radiators' } },
    baseSeverity: 0.75,
  },
  attitude_drift: {
    hypothesis: 'Attitude drifting beyond the pointing budget',
    action: { type: 'attitude_correction', params: { profile: 'wheel_desaturation' } },
    baseSeverity: 0.6,
  },
  comms_degradation: {
    hypothesis: 'Downlink margin degrading',
    action: { type: 'link_handoff', params: { profile: 'switch_ground_station' } },
    baseSeverity: 0.55,
  },
};

export const FALLBACK_RULE: Rule = {
  hypothesis: 'Unclassified anomaly requires operator review',
  action: { type: 'investigate' },
  baseSeverity: 0.4,
};

/** Actions the ComplianceChecker recognizes as executable playbooks. */
export const KNOWN_ACTIONS = new Set([
  'maneuver',
  'load_shed',
  'thermal_mitigation',
  'attitude_correction',
  'link_handoff',
  'investigate',
]);

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
}

/** Score signals against the rulebook: severity × likelihood, best first. */
export function scoreCandidates(signals: Signal[]): Candidate[] {
  const observed = signals.length ? signals : [{ kind: 'unknown' } as Signal];
  const candidates = observed.map((signal) => {
    const rule = RULES[signal.kind] ?? FALLBACK_RULE;
    const likelihood = clamp01(signal.severity ?? 0.6);
    return { rule, signal, likelihood, score: rule.baseSeverity * likelihood };
  });
  // V8's stable sort keeps first-listed on ties.
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
