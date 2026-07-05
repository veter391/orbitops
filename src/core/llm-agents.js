// @ts-check
/**
 * Live multi-agent reasoning pipeline for the OrbitOps cockpit agent.
 *
 * This module NEVER invents telemetry, orbital mechanics, or fuel/delta-v
 * numbers — all of that is computed deterministically elsewhere
 * (core/orbit-propagator.js, core/maneuver-planner.js, core/anomaly-detector.js)
 * before this pipeline ever runs. What this module adds is genuine LLM
 * reasoning *over* that verified data: three specialised agents, each a
 * separate OpenRouter call with its own persona, feeding the next:
 *
 *   1. ANALYST    — reads the raw OBSERVE/THINK data, writes the technical
 *                    analysis narrative and assesses risk level.
 *   2. STRATEGIST — reads the analyst's assessment plus the deterministically
 *                    scored alternatives, writes the SCORE/PROPOSE narrative,
 *                    picks a recommendation, and estimates confidence.
 *   3. SAFETY REVIEWER — adversarially checks the strategist's proposal
 *                    against OrbitOps's HITL principles (nothing executes
 *                    without a human) and can flag concerns or down-rate
 *                    confidence. This never blocks the human operator —
 *                    it only annotates what they're about to review.
 *
 * If OpenRouter is not configured, or any stage fails (rate limit, timeout,
 * malformed output), the pipeline returns `{ok: false}` and the caller must
 * keep the existing deterministic/simulated proposal untouched. A public
 * demo must degrade gracefully, never silently show broken output.
 *
 * @module core/llm-agents
 */

'use strict';

import { chatJSON, hasLiveAI } from './openrouter-client.js';
import { modelsFor } from './model-routing.js';

const SYSTEM_ANALYST = `You are the Flight Dynamics Analyst inside OrbitOps, an AI co-pilot for satellite constellation operators. You are given verified telemetry and orbital-mechanics data that has already been computed by deterministic flight-dynamics code — you must never contradict or invent numbers, only interpret them. Write in the terse, precise register of a real flight dynamics engineer briefing at 03:00: no hype, no hedging filler, state findings and their operational significance. Respond with ONLY a JSON object: {"thinkNarrative": string (2-4 sentences), "riskLevel": "low"|"medium"|"high"|"critical", "keyFactors": string[] (2-4 short bullet phrases)}.`;

const SYSTEM_STRATEGIST = `You are the Mission Strategist inside OrbitOps. You receive a Flight Dynamics Analyst's assessment plus a set of deterministically-computed candidate response strategies (each with real delta-v, fuel cost, and safety-margin numbers already calculated). Your job is to reason about the tradeoffs — safety margin vs. fuel efficiency vs. time-to-execute vs. mission/customer impact — and recommend one, in the voice of an experienced mission strategist writing a recommendation for a human operator who must approve it. You never invent numbers; you only reason over the ones given. Respond with ONLY a JSON object: {"scoreNarrative": string (2-3 sentences comparing the alternatives), "proposeNarrative": string (1-2 sentences, the final recommendation), "recommendedLabel": string (must exactly match one alternative's "label" field from the input), "confidence": number (0.5-0.98), "considerations": string[] (3-5 short bullet phrases a human operator should weigh before approving)}.`;

const SYSTEM_SAFETY = `You are the Safety Reviewer inside OrbitOps. OrbitOps's core principle is that AI proposes, a human always approves — nothing here executes autonomously. Your job is to adversarially review the Mission Strategist's proposal: does the reasoning hold up, is anything glossed over, is the confidence level justified by the evidence, is there a safer alternative being underweighted? You do not block anything — a human will always make the final call — you only annotate the proposal with an honest second opinion. Respond with ONLY a JSON object: {"verdict": "sound"|"sound_with_caveats"|"concerns", "notes": string (1-3 sentences, your honest independent take), "confidenceAdjustment": number (-0.15 to 0, how much to reduce the strategist's confidence if you found gaps; 0 if none)}.`;

/** @typedef {{ok: true, thinkNarrative: string, riskLevel: string, keyFactors: string[], model: string}} AnalystOk */
/** @typedef {{ok: true, scoreNarrative: string, proposeNarrative: string, recommendedLabel: string, confidence: number, considerations: string[], model: string}} StrategistOk */
/** @typedef {{ok: true, verdict: string, notes: string, confidenceAdjustment: number, model: string}} SafetyOk */
/** @typedef {{ok: false, error: string}} AgentErr */

/**
 * @param {string} scenarioTitle
 * @param {Array<{phase: string, title: string, body: string, data?: object}>} observeThinkSteps
 * @returns {Promise<AnalystOk | AgentErr>}
 */
async function runAnalyst(scenarioTitle, observeThinkSteps) {
  const context = observeThinkSteps
    .map((s) => `[${s.phase}] ${s.title}\n${JSON.stringify(s.data || {})}`)
    .join('\n\n');
  const result = await chatJSON([
    { role: 'system', content: SYSTEM_ANALYST },
    { role: 'user', content: `Scenario: ${scenarioTitle}\n\nVerified data so far:\n${context}` },
  ], { models: modelsFor('analyst') });
  if (!result.ok) return result;
  const { thinkNarrative, riskLevel, keyFactors } = result.parsed || {};
  if (!thinkNarrative || !riskLevel) {
    return { ok: false, error: 'Analyst returned incomplete JSON.' };
  }
  return { ok: true, thinkNarrative, riskLevel, keyFactors: keyFactors || [], model: result.model };
}

/**
 * @param {string} scenarioTitle
 * @param {{thinkNarrative: string, riskLevel: string, keyFactors: string[]}} analysis
 * @param {Array<object>} alternatives - deterministically computed candidate strategies
 * @returns {Promise<StrategistOk | AgentErr>}
 */
async function runStrategist(scenarioTitle, analysis, alternatives) {
  const result = await chatJSON([
    { role: 'system', content: SYSTEM_STRATEGIST },
    {
      role: 'user',
      content: `Scenario: ${scenarioTitle}\n\nAnalyst assessment:\n${JSON.stringify(analysis)}\n\nCandidate strategies (real computed data):\n${JSON.stringify(alternatives)}`,
    },
  ], { models: modelsFor('strategist') });
  if (!result.ok) return result;
  const { scoreNarrative, proposeNarrative, recommendedLabel, confidence, considerations } =
    result.parsed || {};
  if (!scoreNarrative || !proposeNarrative || typeof confidence !== 'number') {
    return { ok: false, error: 'Strategist returned incomplete JSON.' };
  }
  return {
    ok: true,
    scoreNarrative,
    proposeNarrative,
    recommendedLabel,
    confidence: Math.max(0.4, Math.min(0.98, confidence)),
    considerations: considerations || [],
    model: result.model,
  };
}

/**
 * @param {string} scenarioTitle
 * @param {object} strategistOutput
 * @returns {Promise<SafetyOk | AgentErr>}
 */
async function runSafetyReviewer(scenarioTitle, strategistOutput) {
  const result = await chatJSON([
    { role: 'system', content: SYSTEM_SAFETY },
    {
      role: 'user',
      content: `Scenario: ${scenarioTitle}\n\nStrategist proposal:\n${JSON.stringify(strategistOutput)}`,
    },
  ], { models: modelsFor('safety') });
  if (!result.ok) return result;
  const { verdict, notes, confidenceAdjustment } = result.parsed || {};
  if (!verdict || !notes) return { ok: false, error: 'Safety Reviewer returned incomplete JSON.' };
  // Defensively enforce the "can only reduce confidence" contract in code —
  // free models don't always respect numeric ranges stated in the prompt.
  const rawAdjustment = typeof confidenceAdjustment === 'number' ? confidenceAdjustment : 0;
  const clampedAdjustment = Math.max(-0.15, Math.min(0, rawAdjustment));
  return {
    ok: true,
    verdict,
    notes,
    confidenceAdjustment: clampedAdjustment,
    model: result.model,
  };
}

/**
 * Run the full 3-agent pipeline over an already-computed deterministic
 * proposal. Returns `{ok: false}` immediately (no partial mutation) if
 * live AI isn't configured or any stage fails — callers must keep showing
 * the deterministic/simulated proposal in that case.
 *
 * @param {string} scenarioTitle
 * @param {{chain: Array<{phase: string, title: string, body: string, data?: object}>}} deterministicProposal
 *   - the full proposal object returned by a SCENARIO_RUNNER in
 *   scenarios/index.js (chain + alternatives, etc.)
 * @param {Array<object>} alternatives - the SCORE step's `data.alternatives`
 * @param {(stage: 'analyst'|'strategist'|'safety') => void} [onStage] - called
 *   right before each agent call starts, so the UI can show live progress.
 * @returns {Promise<{ok: true, analyst: AnalystOk, strategist: StrategistOk, safety: SafetyOk} | {ok: false, error: string, stage: string}>}
 */
export async function runLiveAgentPipeline(scenarioTitle, deterministicProposal, alternatives, onStage) {
  if (!hasLiveAI()) {
    return { ok: false, error: 'No OpenRouter key configured.', stage: 'config' };
  }

  const observeThinkSteps = deterministicProposal.chain.filter(
    (s) => s.phase === 'OBSERVE' || s.phase === 'THINK'
  );

  onStage?.('analyst');
  const analyst = await runAnalyst(scenarioTitle, observeThinkSteps);
  if (!analyst.ok) return { ok: false, error: analyst.error, stage: 'analyst' };

  onStage?.('strategist');
  const strategist = await runStrategist(scenarioTitle, analyst, alternatives);
  if (!strategist.ok) return { ok: false, error: strategist.error, stage: 'strategist' };

  onStage?.('safety');
  const safety = await runSafetyReviewer(scenarioTitle, strategist);
  if (!safety.ok) return { ok: false, error: safety.error, stage: 'safety' };

  return { ok: true, analyst, strategist, safety };
}
