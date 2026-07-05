// @ts-check
/**
 * Task → model routing for the BYOK OpenRouter integration.
 *
 * Philosophy
 * ----------
 * OrbitOps ships as an open-source, bring-your-own-key build. There is no
 * proprietary model and no hidden inference bill — the operator supplies an
 * OpenRouter key and decides exactly which models run which tasks. This map
 * exists so each agent task gets the *right* model, not the biggest one:
 *
 *   - `analyst` / `bulk`      — high-volume interpretation of verified data.
 *                               Needs solid instruction-following and JSON
 *                               discipline, not frontier reasoning.
 *   - `strategist` / `reasoning` — tradeoff reasoning over scored
 *                               alternatives. Benefits from the strongest
 *                               model the operator is willing to run.
 *   - `safety`                — adversarial second opinion. A *different*
 *                               model family than the strategist on purpose,
 *                               so both stages don't share one model's blind
 *                               spots.
 *
 * Every entry is an ordered fallback array, most-preferred first. The
 * OpenRouter client walks the array on retryable failures (429 / 404 / 5xx),
 * which is how errors get minimized on shared free-tier infrastructure: a
 * saturated flagship never blocks the run, it just falls through to the next
 * model in the chain.
 *
 * Profiles
 * --------
 *   - `free`     — the default. Verified free OpenRouter model IDs that work
 *                  today with any key, at zero cost. This is what the public
 *                  demo runs on.
 *   - `balanced` — intentionally empty. Fill in your org-approved paid
 *                  mid-tier models; we do not guess model IDs or prices for
 *                  you.
 *   - `frontier` — intentionally empty. Fill in your org-approved strongest
 *                  models for the highest-stakes reasoning.
 *
 * An empty profile entry falls back to the `free` chain at lookup time, so a
 * partially-filled profile is always safe to select.
 *
 * @module core/model-routing
 */

'use strict';

/** Canonical task names; aliases map onto them in `modelsFor`. */
const TASK_ALIASES = {
  analyst: 'analyst',
  bulk: 'analyst',
  strategist: 'strategist',
  reasoning: 'strategist',
  safety: 'safety',
};

/**
 * Ordered fallback chains per profile per task. Free IDs below are verified
 * working OpenRouter free-tier models — do not swap them for guessed IDs.
 * @type {Record<string, Record<string, string[]>>}
 */
export const MODEL_ROUTING = {
  free: {
    analyst: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'nvidia/nemotron-nano-9b-v2:free',
    ],
    strategist: [
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'openai/gpt-oss-120b:free',
    ],
    safety: [
      'openai/gpt-oss-20b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
    ],
  },

  balanced: {
    // Operator-controlled. Add your org-approved paid mid-tier model IDs
    // here (ordered, most-preferred first). Left empty on purpose — we do
    // not invent paid model IDs on your behalf. Empty entries fall back to
    // the `free` chain.
    analyst: [],
    strategist: [],
    safety: [],
  },

  frontier: {
    // Operator-controlled. Add your org-approved strongest models here for
    // maximum-quality reasoning (ordered, most-preferred first). Left empty
    // on purpose — same rule as `balanced`: no invented IDs, empty entries
    // fall back to the `free` chain.
    analyst: [],
    strategist: [],
    safety: [],
  },
};

/**
 * Resolve the ordered model fallback array for a task under a profile.
 *
 * Unknown tasks resolve to the `analyst` chain (the most general one);
 * unknown profiles and empty (unfilled) profile entries resolve to the
 * `free` chain — the caller always gets a non-empty, runnable array.
 *
 * @param {'analyst'|'bulk'|'strategist'|'reasoning'|'safety'} task
 * @param {'free'|'balanced'|'frontier'} [profile='free']
 * @returns {string[]} ordered OpenRouter model IDs, most-preferred first
 */
export function modelsFor(task, profile = 'free') {
  const canonical = TASK_ALIASES[task] || 'analyst';
  const chain = MODEL_ROUTING[profile]?.[canonical];
  if (Array.isArray(chain) && chain.length > 0) return chain.slice();
  return MODEL_ROUTING.free[canonical].slice();
}
