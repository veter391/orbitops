/**
 * Deterministic escalation / on-call policy — no LLM. Turns a proposal's risk
 * signals into an operational escalation level and a page-on-call decision, so an
 * urgent conjunction with an imminent TCA is treated differently from a routine
 * watch-level flag. This is policy, not a decision to act: every proposal still
 * awaits human approval; escalation only says how loudly to ring the phone.
 *
 * Levels (ascending): routine → elevated → urgent → critical.
 */

export type EscalationLevel = 'routine' | 'elevated' | 'urgent' | 'critical';

export interface EscalationInput {
  /** Conjunction risk band: clear | watch | warning | critical. */
  riskBand?: string;
  /** Time to closest approach, seconds — a short horizon raises urgency. */
  timeToTcaSec?: number;
  /** Number of compliance flags raised by the critic. */
  complianceFlagCount?: number;
  /** Fallback severity hint 0..1 (non-conjunction signals). */
  severity?: number;
}

export interface Escalation {
  level: EscalationLevel;
  /** True when the level warrants paging on-call now. */
  notify: boolean;
  reasons: string[];
}

const ORDER: EscalationLevel[] = ['routine', 'elevated', 'urgent', 'critical'];

/** Raise `level` by `n` steps, clamped to the range. */
function bump(level: EscalationLevel, n: number): EscalationLevel {
  const i = Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(level) + n));
  return ORDER[i] ?? 'routine';
}

/**
 * Assess the escalation level from the proposal's risk signals. Base level comes
 * from the conjunction risk band (or the severity hint for non-conjunctions);
 * an imminent time-to-TCA and compliance flags bump it up. `notify` fires at
 * `urgent` and above.
 */
export function assessEscalation(input: EscalationInput): Escalation {
  const reasons: string[] = [];
  let level: EscalationLevel = 'routine';

  if (input.riskBand === 'critical') {
    level = 'urgent';
    reasons.push('critical collision risk (Pc ≥ 1e-3)');
  } else if (input.riskBand === 'warning') {
    level = 'elevated';
    reasons.push('warning collision risk (Pc ≥ 1e-4)');
  } else if (input.riskBand === 'watch') {
    reasons.push('watch-level collision risk');
  } else if (typeof input.severity === 'number') {
    if (input.severity >= 0.85) {
      level = 'urgent';
      reasons.push(`high severity ${input.severity.toFixed(2)}`);
    } else if (input.severity >= 0.6) {
      level = 'elevated';
      reasons.push(`elevated severity ${input.severity.toFixed(2)}`);
    }
  }

  if (typeof input.timeToTcaSec === 'number' && input.timeToTcaSec > 0) {
    const hours = input.timeToTcaSec / 3600;
    if (hours < 6) {
      level = bump(level, 2);
      reasons.push(`TCA in ${hours.toFixed(1)} h (imminent)`);
    } else if (hours < 24) {
      level = bump(level, 1);
      reasons.push(`TCA in ${hours.toFixed(1)} h (near-term)`);
    }
  }

  if (input.complianceFlagCount && input.complianceFlagCount > 0) {
    level = bump(level, 1);
    reasons.push(`${input.complianceFlagCount} compliance flag(s)`);
  }

  if (reasons.length === 0) reasons.push('nominal — routine review');
  const notify = ORDER.indexOf(level) >= ORDER.indexOf('urgent');
  return { level, notify, reasons };
}
