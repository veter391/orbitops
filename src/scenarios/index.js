// @ts-check
/**
 * AI Agent reasoning chain — the heart of OrbitOps.
 *
 * The agent follows a ReAct-style loop:
 *   OBSERVE → THINK → SCORE → PROPOSE → WAIT (for human approval)
 *
 * Each step in the chain is recorded and displayed to the operator. Nothing
 * happens without explicit human approval — HITL is the core architecture,
 * not an optional add-on.
 *
 * Each scenario is a pre-built sequence that demonstrates the agent's
 * reasoning on a real-world problem:
 *
 *   1. CONJUNCTION       — close approach between two satellites
 *   2. BATTERY_DRAIN     — gradual degradation prediction
 *   3. THERMAL_OVERHEAT  — sudden thermal anomaly
 *   4. COMMANDED_MANEUVER — operator asks for a specific maneuver
 *   5. GROUND_HANDOFF    — comms degradation, ground station handoff
 *
 * For production: replace the deterministic chain construction with LLM-
 * backed hypothesis generation. The chain shape stays the same — the LLM
 * just provides the candidate interpretations and scoring rationale.
 *
 * @module core/ai-agent
 */

'use strict';

import { SATELLITES, SATELLITE_BY_ID } from '../data/satellites.js';
import { closestApproach } from '../core/orbit-propagator.js';
import { avoidanceBurn } from '../core/maneuver-planner.js';
import { audit } from '../core/audit-log.js';
import { Emitter } from '../utils.js';
import { runLiveAgentPipeline } from '../core/llm-agents.js';
import { hasLiveAI } from '../core/openrouter-client.js';

/* ---------- Reasoning chain shape ---------- */

/**
 * @typedef {Object} AgentStep
 * @property {string} phase - OBSERVE | THINK | SCORE | PROPOSE | WAIT | SAFETY
 * @property {string} title - short label
 * @property {string} body - explanation
 * @property {any} [data] - supporting data
 * @property {number} ts - timestamp
 * @property {string} [source] - 'simulated' | 'live-ai'
 * @property {string} [model] - model id when authored by the live AI pipeline
 */

/**
 * @typedef {Object} AgentProposal
 * @property {string} id
 * @property {string} scenarioId
 * @property {string} satelliteId
 * @property {string} title
 * @property {string} summary
 * @property {number} confidence - 0..1
 * @property {string[]} considerations - bullet points
 * @property {string} action - action key
 * @property {any} actionData
 * @property {string} status - pending | approved | rejected | modified
 * @property {AgentStep[]} chain
 * @property {number} createdAt
 * @property {string} [aiMode] - 'simulated' | 'live'
 * @property {string} [aiError]
 * @property {string[]} [aiConsiderations]
 * @property {{analyst: string, strategist: string, safety: string}} [aiModels]
 * @property {string} [approvedBy]
 * @property {number} [approvedAt]
 * @property {string} [rejectedBy]
 * @property {number} [rejectedAt]
 * @property {string} [rejectReason]
 * @property {string} [modifiedBy]
 * @property {number} [modifiedAt]
 * @property {any} [modifications]
 */

/* ---------- The agent ---------- */

class AIAgent extends Emitter {
  constructor() {
    super();
    /** @type {Map<string, AgentProposal>} */
    this.proposals = new Map();
    /** @type {string|null} */
    this.activeScenario = null;
    this.demoClock = 0; // seconds since demo epoch
    this.demoStartTime = Date.now();
  }

  /**
   * Run a scenario by id. Returns the full proposal with reasoning chain.
   *
   * @param {string} scenarioId
   * @param {Object} [context]
   * @returns {Promise<AgentProposal>}
   */
  async runScenario(scenarioId, context = {}) {
    const runner = SCENARIO_RUNNERS[scenarioId];
    if (!runner) throw new Error(`Unknown scenario: ${scenarioId}`);
    this.activeScenario = scenarioId;

    const proposal = await runner(this, context);
    proposal.aiMode = 'simulated';

    if (hasLiveAI()) {
      await this._enhanceWithLiveAI(proposal);
    }

    this.proposals.set(proposal.id, proposal);

    await audit.append('ai:orbit-agent', `scenario.${scenarioId}.proposed`, {
      proposalId: proposal.id,
      satelliteId: proposal.satelliteId,
      confidence: proposal.confidence,
      aiMode: proposal.aiMode,
    });

    this.emit('proposal', proposal);
    return proposal;
  }

  /**
   * Layer genuine LLM reasoning on top of an already-computed deterministic
   * proposal. Never mutates the OBSERVE/THINK data steps (real telemetry
   * and orbital-mechanics numbers) — only adds new chain steps authored by
   * the live agent pipeline, and updates confidence/considerations if the
   * pipeline succeeds. On any failure, the proposal is left exactly as the
   * deterministic runner produced it (aiMode stays 'simulated').
   *
   * @param {AgentProposal} proposal
   */
  async _enhanceWithLiveAI(proposal) {
    const scoreStep = proposal.chain.find((s) => s.phase === 'SCORE');
    const alternatives =
      scoreStep?.data?.alternatives || scoreStep?.data?.options || (scoreStep?.data ? [scoreStep.data] : []);

    const result = await runLiveAgentPipeline(
      proposal.title,
      proposal,
      alternatives,
      (stage) => this.emit('ai-stage', { stage, scenarioId: proposal.scenarioId }),
      // Streamed narrative of the active stage — the console renders it live.
      (stage, text) => this.emit('ai-token', { stage, text, scenarioId: proposal.scenarioId })
    );

    if (!result.ok) {
      proposal.aiError = result.error;
      this.emit('ai-stage', { stage: 'fallback', scenarioId: proposal.scenarioId, error: result.error });
      return;
    }

    const { analyst, strategist, safety } = result;
    const now = Date.now();
    proposal.chain.forEach((s) => {
      if (!s.source) s.source = 'simulated';
    });
    proposal.chain.push(
      {
        phase: 'THINK',
        title: `Analyst AI — ${analyst.riskLevel.toUpperCase()} risk read`,
        body: analyst.thinkNarrative,
        data: { riskLevel: analyst.riskLevel, keyFactors: analyst.keyFactors },
        source: 'live-ai',
        model: analyst.model,
        ts: now,
      },
      {
        phase: 'SCORE',
        title: 'Strategist AI — tradeoff analysis',
        body: strategist.scoreNarrative,
        data: strategist.recommendedLabel ? { recommendedLabel: strategist.recommendedLabel } : undefined,
        source: 'live-ai',
        model: strategist.model,
        ts: now + 1,
      },
      {
        phase: 'PROPOSE',
        title: 'Strategist AI — recommendation',
        body: strategist.proposeNarrative,
        source: 'live-ai',
        model: strategist.model,
        ts: now + 2,
      },
      {
        phase: 'SAFETY',
        title: `Safety Reviewer AI — ${safety.verdict.replace(/_/g, ' ')}`,
        body: safety.notes,
        source: 'live-ai',
        model: safety.model,
        ts: now + 3,
      }
    );

    proposal.confidence = Math.max(0.3, Math.min(0.99, strategist.confidence + safety.confidenceAdjustment));
    proposal.aiConsiderations = strategist.considerations;
    proposal.aiMode = 'live';
    proposal.aiModels = { analyst: analyst.model, strategist: strategist.model, safety: safety.model };
    this.emit('ai-stage', { stage: 'done', scenarioId: proposal.scenarioId });
  }

  /**
   * Operator approves a proposal. The proposal moves to 'approved' status and
   * the corresponding side effects (e.g. manoeuvre scheduled) are recorded.
   *
   * @param {string} proposalId
   * @param {string} operatorId
   * @returns {Promise<AgentProposal>}
   */
  async approve(proposalId, operatorId) {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error(`Unknown proposal: ${proposalId}`);
    if (p.status !== 'pending') return p;
    p.status = 'approved';
    p.approvedBy = operatorId;
    p.approvedAt = Date.now();
    await audit.append(`user:${operatorId}`, 'proposal.approved', {
      proposalId,
      action: p.action,
      actionData: p.actionData,
    });
    this.emit('approved', p);
    return p;
  }

  /**
   * Operator rejects a proposal.
   * @param {string} proposalId
   * @param {string} operatorId
   * @param {string} [reason]
   * @returns {Promise<AgentProposal>}
   */
  async reject(proposalId, operatorId, reason = '') {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error(`Unknown proposal: ${proposalId}`);
    if (p.status !== 'pending') return p;
    p.status = 'rejected';
    p.rejectedBy = operatorId;
    p.rejectedAt = Date.now();
    p.rejectReason = reason;
    await audit.append(`user:${operatorId}`, 'proposal.rejected', {
      proposalId,
      reason,
    });
    this.emit('rejected', p);
    return p;
  }

  /**
   * Operator modifies the proposal (e.g. changes burn duration) and approves.
   * @param {string} proposalId
   * @param {string} operatorId
   * @param {any} modifications
   * @returns {Promise<AgentProposal>}
   */
  async modifyAndApprove(proposalId, operatorId, modifications) {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error(`Unknown proposal: ${proposalId}`);
    if (p.status !== 'pending') return p;
    p.status = 'modified';
    p.modifications = modifications;
    p.modifiedBy = operatorId;
    p.modifiedAt = Date.now();
    await audit.append(`user:${operatorId}`, 'proposal.modified', {
      proposalId,
      modifications,
    });
    this.emit('modified', p);
    return p;
  }

  /** Get a proposal by id. @param {string} id */
  getProposal(id) {
    return this.proposals.get(id);
  }

  /** All proposals. */
  allProposals() {
    return Array.from(this.proposals.values());
  }

  /** Recent proposals, newest first. @param {number} [n] */
  recentProposals(n = 20) {
    return this.allProposals()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, n);
  }
}

export const agent = new AIAgent();

/* ====================================================================
   SCENARIO RUNNERS
   Each builds the full reasoning chain and proposal for a real-world
   situation the operator might face at 03:00.
   ==================================================================== */

/**
 * @typedef {{satelliteId?: string, timeSec?: number, params?: any}} ScenarioContext
 * @typedef {(agent: AIAgent, context: ScenarioContext) => Promise<AgentProposal>} ScenarioRunner
 */

/** @type {Record<string, ScenarioRunner>} */
const SCENARIO_RUNNERS = {};

/* ---------- Scenario 1: Conjunction ---------- */

SCENARIO_RUNNERS.conjunction = async (agent, { satelliteId, timeSec }) => {
  // Use the first two sats of ORBIT-1 (same plane, crossing orbits)
  const satA = satelliteId
    ? SATELLITE_BY_ID[satelliteId]
    : SATELLITES[0];
  const satB = SATELLITES.find((s) => s.id !== satA.id) || SATELLITES[1];

  /** @type {AgentStep[]} */
  const chain = [];
  const now = Date.now();

  // === STEP 1: OBSERVE — LeoLabs external alert (fictional feed) ===
  chain.push({
    phase: 'OBSERVE',
    title: 'Conjunction alert from LeoLabs',
    body: `LeoLabs API flagged a predicted close approach between **${satA.name}** and **${satB.name}** in the next 6 hours. Independent analysis below will verify and refine.`,
    data: {
      source: 'LeoLabs',
      satA: satA.id,
      satB: satB.id,
    },
    ts: now,
  });
  await sleep(220);

  // === STEP 2: OBSERVE — 18th SDS cross-reference ===
  chain.push({
    phase: 'OBSERVE',
    title: 'Cross-reference with 18th SDS data',
    body: `Queried 18th Space Defense Squadron public catalog. Initial SDP4 propagation corroborates a conjunction event within the next 6 hours. Additional radar pass from ExoAnalytic scheduled for refinement.`,
    data: {
      source: '18 SDS',
    },
    ts: now + 220,
  });
  await sleep(220);

  // === STEP 3: THINK — compute independent closest approach ===
  const ca = closestApproach(satA.elements, satB.elements, timeSec || 0, (timeSec || 0) + 18000, 60);
  const observedMissKm = ca.distanceKm;
  const observedTcaSec = ca.tClosest;
  const pc = Math.min(1, 1e-4 * Math.pow(25 / Math.max(observedMissKm, 0.5), 4)); // heuristic PC
  chain.push({
    phase: 'THINK',
    title: 'Computed closest approach',
    body: `Independent Kepler propagation over ±5h window: miss distance **${observedMissKm.toFixed(2)} km** at **T+${(observedTcaSec / 3600).toFixed(2)}h**. Probability of collision: **${pc.toExponential(2)}** ${pc > 1e-4 ? '(above the 1 × 10⁻⁴ action threshold)' : '(below action threshold, monitoring only)'}. Both satellites in stable orbits; relative velocity at TCA is 14.7 km/s.`,
    data: {
      source: 'OrbitOps · propagate()',
      distanceKm: observedMissKm,
      tClosestSec: observedTcaSec,
      pc,
      relativeVelocityKmS: 14.7,
    },
    ts: now + 440,
  });
  await sleep(220);

  // === STEP 4: THINK — generate candidate burn ===
  const burn = avoidanceBurn(satA.elements, 5);
  const newMissKm = observedMissKm + 45;
  chain.push({
    phase: 'THINK',
    title: 'Generated candidate manoeuvre',
    body: `Computed Hohmann avoidance: **prograde burn of ${burn.dvMs.toFixed(2)} m/s** to raise orbit by 5 km. Fuel cost: **${burn.fuelKg.toFixed(3)} kg** (Tsiolkovsky, Isp = 220 s). Predicted post-burn miss distance: **${newMissKm.toFixed(1)} km** — ${newMissKm > 25 ? 'clear of the 25 km safety threshold by ' + (newMissKm - 25).toFixed(1) + ' km' : 'still below safety threshold — escalate'}.`,
    data: { burn, newMissKm },
    ts: now + 660,
  });
  await sleep(220);

  // === STEP 5: SCORE — compare strategies ===
  const alternatives = [
    { kind: 'Recommended', label: 'Hohmann +5 km', dv: burn.dvMs, fuel: burn.fuelKg, safetyMargin: newMissKm - 25 },
    { kind: 'Aggressive', label: 'Single-burn +6.7 km', dv: burn.dvMs * 1.35, fuel: burn.fuelKg * 1.42, safetyMargin: newMissKm - 25 + 12 },
    { kind: 'Conservative', label: 'Hohmann +8 km', dv: burn.dvMs * 1.6, fuel: burn.fuelKg * 1.7, safetyMargin: newMissKm - 25 + 30 },
    { kind: 'No burn', label: 'Monitor only', dv: 0, fuel: 0, safetyMargin: observedMissKm - 25 },
  ];
  const safeRequired = newMissKm > 25;
  chain.push({
    phase: 'SCORE',
    title: 'Ranked 4 candidate strategies',
    body: `Scored against safety margin, fuel cost, mission impact, and time-to-execute. **Recommended** wins on safety margin vs. fuel efficiency (Hohmann is ~30% more fuel-efficient than the single-burn at this altitude). **No-burn option** would leave us ${safeRequired ? Math.abs(observedMissKm - 25).toFixed(1) + ' km short of the safety threshold' : 'with acceptable risk'}.`,
    data: { alternatives, winner: 'Recommended', safeRequired },
    ts: now + 880,
  });
  await sleep(220);

  // === STEP 6: PROPOSE ===
  const proposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: 'conjunction',
    satelliteId: satA.id,
    title: `Avoidance burn — ${satA.name}`,
    summary: `Prograde burn of ${burn.dvMs.toFixed(2)} m/s to raise orbit by 5 km. Clear predicted conjunction with ${satB.name} (miss ${observedMissKm.toFixed(2)} km).`,
    confidence: 0.89,
    considerations: [
      `Predicted miss distance ${observedMissKm.toFixed(2)} km.`,
      `Burn raises orbit 5 km, new miss distance ~${newMissKm.toFixed(1)} km.`,
      `Fuel cost ${burn.fuelKg.toFixed(3)} kg.`,
      `Time to execute: 2 burns over one orbital period (~95 min).`,
      `No impact on payload operations or customer commitments.`,
    ],
    action: 'maneuver.avoidance',
    actionData: { burn, satA: satA.id, satB: satB.id },
    status: 'pending',
    chain,
    createdAt: Date.now(),
  };
  chain.push({
    phase: 'PROPOSE',
    title: 'Recommendation ready for human review',
    body: `**Proposed action**: execute the avoidance burn above. Awaiting operator approval. Confidence: **${(proposal.confidence * 100).toFixed(0)}%** based on data freshness, model accuracy, and historical success rate.`,
    ts: now + 1100,
  });

  return proposal;
};

/* ---------- Scenario 2: Battery degradation ---------- */

SCENARIO_RUNNERS.battery = async (agent, { satelliteId, timeSec }) => {
  const sat = satelliteId ? SATELLITE_BY_ID[satelliteId] : SATELLITES[12]; // pick one with realistic baselines
  /** @type {AgentStep[]} */
  const chain = [];
  const now = Date.now();

  chain.push({
    phase: 'OBSERVE',
    title: 'Battery voltage trending below baseline',
    body: `Over the past 7 days, **${sat.name}** battery voltage has drifted from baseline 28.5V → 27.8V during sunlit periods. Eclipse voltage dipped to 25.6V (below 26V operational floor). Pattern is consistent with cell degradation, not thermal or load-related.`,
    data: { sat: sat.id, voltage: 27.8, baseline: 28.5 },
    ts: now,
  });
  await sleep(220);

  chain.push({
    phase: 'OBSERVE',
    title: 'Battery temperature also elevated',
    body: `Battery temperature is 4°C above baseline (22°C → 26°C) during peak charge. This is consistent with increased internal resistance from aging cells.`,
    data: { temp: 26, baseline: 22 },
    ts: now + 220,
  });
  await sleep(220);

  chain.push({
    phase: 'THINK',
    title: 'Modelled cell degradation curve',
    body: `Fit exponential degradation model to 7 days of voltage data. Extrapolation shows voltage will drop below operational floor (26V) in **6-8 weeks** at current discharge profile. If payload power draw increases by 15% (planned for month 2 mission), floor will be crossed in **3-4 weeks**.`,
    data: {
      currentVoltage: 27.8,
      floorVoltage: 26.0,
      weeksToFloor: 7,
      weeksToFloorWithPayloadIncrease: 3.5,
    },
    ts: now + 440,
  });
  await sleep(220);

  chain.push({
    phase: 'THINK',
    title: 'Cross-referenced with on-orbit battery data',
    body: `Looked up 4 similar satellites from the same bus and launch batch in the fleet. 3 of 4 show similar degradation curves at this age in their mission. The 4th had a manufacturing defect that caused rapid decline — this satellite's data matches the normal pattern, not the defect.`,
    data: { similarSats: 4, matchingPattern: 'normal-degradation' },
    ts: now + 660,
  });
  await sleep(220);

  chain.push({
    phase: 'SCORE',
    title: 'Three options evaluated',
    body: `1) **Reduce payload power by 20%** — buys 4 weeks, no service impact. 2) **Schedule battery swap** — not possible (no servicing mission in manifest). 3) **Reassign mission to redundant satellite** — most conservative, but loses revenue until backup is operational. Recommendation: Option 1 now, reassign in Q3 when replacement launches.`,
    data: {
      options: [
        { id: 'reduce_power', label: 'Reduce payload power 20%', weeksGained: 4, impact: 'minimal' },
        { id: 'reassign', label: 'Reassign mission to backup', weeksGained: 'unlimited', impact: 'customer-facing' },
        { id: 'monitor', label: 'Continue monitoring', weeksGained: 0, impact: 'risk of unplanned outage' },
      ],
      winner: 'reduce_power',
    },
    ts: now + 880,
  });
  await sleep(220);

  const proposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: 'battery',
    satelliteId: sat.id,
    title: `Battery health intervention — ${sat.name}`,
    summary: `Reduce payload power draw by 20% to extend operational life by 4 weeks. Reassign mission in Q3 to replacement satellite.`,
    confidence: 0.83,
    considerations: [
      `Predicted voltage drops below 26V floor in 3.5 weeks at current draw.`,
      `Reducing payload power by 20% delays floor crossing by 4 weeks.`,
      `Customer-facing impact: minimal — payload tasking can be re-balanced across constellation.`,
      `Replacement satellite launches Q3 (per launch manifest).`,
      `No similar satellite showed premature failure from this batch.`,
    ],
    action: 'config.payload.power',
    actionData: {
      satelliteId: sat.id,
      newPowerDrawFraction: 0.8,
      reason: 'battery_health_extension',
      reassignTarget: 'Q3 launch',
    },
    status: 'pending',
    chain,
    createdAt: Date.now(),
  };
  chain.push({
    phase: 'PROPOSE',
    title: 'Recommendation ready for human review',
    body: `Awaiting operator approval to reduce payload power draw by 20%. Confidence: **${(proposal.confidence * 100).toFixed(0)}%** based on degradation model accuracy and historical fleet patterns.`,
    ts: now + 1100,
  });

  return proposal;
};

/* ---------- Scenario 3: Thermal anomaly ---------- */

SCENARIO_RUNNERS.thermal = async (agent, { satelliteId, timeSec }) => {
  const sat = satelliteId ? SATELLITE_BY_ID[satelliteId] : SATELLITES[20];
  /** @type {AgentStep[]} */
  const chain = [];
  const now = Date.now();

  chain.push({
    phase: 'OBSERVE',
    title: 'Sudden thermal spike detected',
    body: `**${sat.name}** CPU temperature jumped from baseline 45°C → 73°C in 14 minutes. Rate of change (3.7°C/min) is anomalous — historical data shows max rate of change of 0.5°C/min during eclipse-to-sun transitions. No eclipse currently.`,
    data: { sat: sat.id, temp: 73, baseline: 45, rate: 3.7 },
    ts: now,
  });
  await sleep(220);

  chain.push({
    phase: 'OBSERVE',
    title: 'Cross-checked other subsystems',
    body: `CPU usage is normal (38% — typical for current tasking). Sun incidence is normal (no sudden thermal load from sun). Radiator temperature unchanged (would be expected if external thermal issue). This points to internal CPU heat generation.`,
    data: { cpu: 38, radiator: 'normal' },
    ts: now + 220,
  });
  await sleep(220);

  chain.push({
    phase: 'THINK',
    title: 'Hypotheses ranked by likelihood',
    body: `Three hypotheses: (1) Stuck process spinning CPU — 65% likely; (2) Failing CPU thermal interface — 25% likely; (3) Failed thermal sensor giving bad reading — 10% likely. Hypothesis 1 is cheap to test (no commands, just observe), hypothesis 2 requires safe-mode entry, hypothesis 3 requires sensor cross-check.`,
    data: {
      hypotheses: [
        { label: 'Stuck process', likelihood: 0.65, test: 'monitor' },
        { label: 'Failed thermal interface', likelihood: 0.25, test: 'enter_safe_mode' },
        { label: 'Failed sensor', likelihood: 0.10, test: 'cross_check' },
      ],
    },
    ts: now + 440,
  });
  await sleep(220);

  chain.push({
    phase: 'SCORE',
    title: 'Immediate mitigation recommended',
    body: `CPU temp 73°C is approaching emergency threshold (85°C where automatic shutdown triggers). At current rate of rise, emergency in ~3 minutes. Recommended immediate action: throttle payload processing to reduce CPU load. This buys time without risky interventions.`,
    data: { currentTemp: 73, emergencyThreshold: 85, minutesToEmergency: 3 },
    ts: now + 660,
  });
  await sleep(220);

  const proposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: 'thermal',
    satelliteId: sat.id,
    title: `Emergency thermal mitigation — ${sat.name}`,
    summary: `Throttle payload processing by 60% to reduce CPU load. Buy time to diagnose root cause without risk of emergency shutdown.`,
    confidence: 0.94,
    considerations: [
      `Temperature rising at 3.7°C/min — emergency threshold in ~3 minutes.`,
      `Throttling buys 15-20 minutes for diagnosis before reaching threshold.`,
      `Most likely cause (stuck process) will resolve with reduced CPU.`,
      `Worst case (failed thermal interface) requires safe-mode entry within 30 minutes.`,
      `No customer-facing impact: payload tasking rebalances automatically.`,
    ],
    action: 'config.payload.throttle',
    actionData: {
      satelliteId: sat.id,
      newThrottleFraction: 0.4,
      reason: 'thermal_anomaly_mitigation',
      reviewInMinutes: 15,
    },
    status: 'pending',
    chain,
    createdAt: now + 880,
  };
  chain.push({
    phase: 'PROPOSE',
    title: 'Recommendation ready for human review',
    body: `URGENT: temperature rising rapidly. Awaiting immediate operator approval. Confidence **${(proposal.confidence * 100).toFixed(0)}%** — this is a low-risk mitigation, not an irreversible action.`,
    ts: now + 1100,
  });

  return proposal;
};

/* ---------- Scenario 4: Commanded maneuver ---------- */

SCENARIO_RUNNERS.commanded = async (agent, { satelliteId, params }) => {
  const sat = satelliteId ? SATELLITE_BY_ID[satelliteId] : SATELLITES[30];
  const targetAlt = (params && params.targetAltitudeKm) || 555;
  const currentAlt = sat.altitude;
  const deltaAlt = targetAlt - currentAlt;
  /** @type {AgentStep[]} */
  const chain = [];
  const now = Date.now();

  chain.push({
    phase: 'OBSERVE',
    title: 'Operator command received',
    body: `Operator ${params?.operator || 'ops-engineer'} requested: raise orbit of **${sat.name}** from ${currentAlt} km to **${targetAlt} km**. Command issued via OrbitOps console at ${new Date().toLocaleTimeString()}.`,
    data: { sat: sat.id, from: currentAlt, to: targetAlt, operator: params?.operator },
    ts: now,
  });
  await sleep(220);

  chain.push({
    phase: 'OBSERVE',
    title: 'Verified current orbit state',
    body: `Independent propagation confirms current altitude ${currentAlt.toFixed(1)} km with mean anomaly ${((sat.elements.meanAnomaly * 180) / Math.PI).toFixed(0)}°. Drag decay rate is 0.8 m/day — small but accumulates. Last station-keeping burn: 14 days ago.`,
    data: { currentAlt, dragRate: 0.8, daysSinceLastBurn: 14 },
    ts: now + 220,
  });
  await sleep(220);

  chain.push({
    phase: 'THINK',
    title: 'Computed optimal burn plan',
    body: `Delta-v required: ${Math.abs(deltaAlt) * 3.0} m/s ${deltaAlt > 0 ? 'prograde' : 'retrograde'}. Burn duration: 30 seconds. Recommended burn window: next ground-station pass at T+1h 24m (95% link margin). Wait time trades altitude accuracy vs. fuel efficiency — current plan optimises for fuel.`,
    data: {
      dvMs: Math.abs(deltaAlt) * 3.0,
      direction: deltaAlt > 0 ? 'prograde' : 'retrograde',
      burnDurationSec: 30,
      windowAt: '+1h 24m',
    },
    ts: now + 440,
  });
  await sleep(220);

  chain.push({
    phase: 'SCORE',
    title: 'Checked for conflicts',
    body: `No active conjunctions within 48 hours. No payload tasking scheduled during burn window. Battery state of charge: 87% (sufficient). No thermal constraints. **All clear to execute.**`,
    data: { conflicts: 'none' },
    ts: now + 660,
  });
  await sleep(220);

  const burn = avoidanceBurn(sat.elements, deltaAlt);
  const proposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: 'commanded',
    satelliteId: sat.id,
    title: `Station-keeping burn — ${sat.name}`,
    summary: `${deltaAlt > 0 ? 'Prograde' : 'Retrograde'} burn of ${burn.dvMs.toFixed(2)} m/s to adjust orbit to ${targetAlt} km. Execute at next ground station pass.`,
    confidence: 0.96,
    considerations: [
      `Delta-v: ${burn.dvMs.toFixed(2)} m/s (${deltaAlt > 0 ? 'prograde' : 'retrograde'}).`,
      `Burn window: T+1h 24m (next ground station pass).`,
      `No conflicts with conjunctions, payload tasking, or thermal constraints.`,
      `Fuel cost: ${burn.fuelKg.toFixed(3)} kg.`,
      `Battery SOC: 87%.`,
    ],
    action: 'maneuver.station_keeping',
    actionData: { burn, satelliteId: sat.id, scheduledAt: '+1h24m' },
    status: 'pending',
    chain,
    createdAt: now + 880,
  };
  chain.push({
    phase: 'PROPOSE',
    title: 'Plan ready for operator approval',
    body: `Awaiting operator approval. Confidence **${(proposal.confidence * 100).toFixed(0)}%** — all safety checks passed.`,
    ts: now + 1100,
  });

  return proposal;
};

/* ---------- Scenario 5: Ground handoff ---------- */

SCENARIO_RUNNERS.handoff = async (agent, { satelliteId, timeSec }) => {
  const sat = satelliteId ? SATELLITE_BY_ID[satelliteId] : SATELLITES[35];
  /** @type {AgentStep[]} */
  const chain = [];
  const now = Date.now();

  chain.push({
    phase: 'OBSERVE',
    title: 'Current ground station signal degrading',
    body: `**${sat.name}** downlink signal strength dropping: -85 dBm → -98 dBm over 90 seconds. Current ground station is Reykjavik (IS-1). Elevation dropping below 12°.`,
    data: { sat: sat.id, signal: -98, elevation: 12, gs: 'IS-1' },
    ts: now,
  });
  await sleep(220);

  chain.push({
    phase: 'OBSERVE',
    title: 'Next ground station availability checked',
    body: `Next visible ground stations: Svalbard (NO-2) in 4m 12s at elevation 8°. Tromsø (NO-3) in 6m 45s at elevation 22°. Both are nominal partners for this satellite.`,
    data: { nextStations: [{ name: 'Svalbard', eta: '4m 12s', elevation: 8 }, { name: 'Tromsø', eta: '6m 45s', elevation: 22 }] },
    ts: now + 220,
  });
  await sleep(220);

  chain.push({
    phase: 'THINK',
    title: 'Predicting handoff window',
    body: `Reykjavik link will drop below usable threshold (-105 dBm) in approximately 90 seconds. Svalbard will be usable (elevation > 5°, link margin > 10 dB) in approximately 4 minutes. This gives us a **2.5 minute gap** with no primary downlink.`,
    data: { gapSeconds: 150 },
    ts: now + 440,
  });
  await sleep(220);

  chain.push({
    phase: 'SCORE',
    title: 'Recommended action',
    body: `Buffer all downlink traffic to onboard storage (2.5 min × 50 Mbps × 2 streams = ~1.9 GB — within storage capacity of 8 GB). Resume downlink via Svalbard at T+4m 12s. Total data loss: 0 (all buffered). Customer impact: none (no real-time customer service on this satellite).`,
    data: { strategy: 'buffer_and_handoff', dataLossMb: 0, storageUsed: 1900, storageCapacity: 8000 },
    ts: now + 660,
  });
  await sleep(220);

  const proposal = {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: 'handoff',
    satelliteId: sat.id,
    title: `Ground station handoff — ${sat.name}`,
    summary: `Buffer 1.9 GB of downlink traffic for 2.5 minutes, then resume via Svalbard ground station. Zero data loss expected.`,
    confidence: 0.92,
    considerations: [
      `Reykjavik link unusable in ~90 seconds.`,
      `Svalbard link available in ~4 minutes.`,
      `Buffering fits within onboard storage (1.9 GB of 8 GB used).`,
      `No real-time customer service affected (this satellite is EO bulk tasking).`,
      `Auto-handoff routine handles the transition without operator intervention.`,
    ],
    action: 'comms.handoff',
    actionData: { from: 'IS-1', to: 'NO-2', bufferMb: 1900, resumeAt: '+4m 12s' },
    status: 'pending',
    chain,
    createdAt: now + 880,
  };
  chain.push({
    phase: 'PROPOSE',
    title: 'Recommendation ready',
    body: `Awaiting operator approval to begin buffering. Confidence **${(proposal.confidence * 100).toFixed(0)}%** — this is a routine handoff with well-tested auto-execution.`,
    ts: now + 1100,
  });

  return proposal;
};

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export const SCENARIOS = [
  { id: 'conjunction', title: 'Conjunction alert', description: 'Close approach detected, plan avoidance burn', icon: '⚠', severity: 'critical', chainLength: 6 },
  { id: 'battery', title: 'Battery degradation', description: 'Gradual voltage drop, plan intervention', icon: '⚡', severity: 'warn', chainLength: 6 },
  { id: 'thermal', title: 'Thermal anomaly', description: 'Sudden temperature spike, mitigate before emergency', icon: '🔥', severity: 'critical', chainLength: 6 },
  { id: 'commanded', title: 'Commanded maneuver', description: 'Operator requests orbit adjustment, plan and verify', icon: '↗', severity: 'info', chainLength: 5 },
  { id: 'handoff', title: 'Ground station handoff', description: 'Current link degrading, plan transition', icon: '📡', severity: 'info', chainLength: 4 },
];

export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);