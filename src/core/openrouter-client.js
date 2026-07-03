/**
 * Minimal client for OpenRouter's chat completions API.
 *
 * Design constraints (this is a static, serverless site — no backend exists):
 *   - The API key is supplied by the operator at runtime and stored only in
 *     this browser's localStorage. It is NEVER hardcoded in source, never
 *     committed, and never sent anywhere except https://openrouter.ai directly.
 *   - Free-tier models are shared, rate-limited infrastructure. Every call
 *     therefore has a model fallback chain and a hard timeout, and every
 *     caller MUST be prepared for `ok: false` and fall back to a
 *     deterministic path — a public demo must never hard-fail because a
 *     free model is temporarily saturated.
 *
 * @module core/openrouter-client
 */

'use strict';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const STORAGE_KEY = 'orbitops:openrouter_key';
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Ordered fallback chain of free OpenRouter models, most-capable first.
 * Free-tier capacity fluctuates hour to hour (shared infra), so this chain
 * deliberately mixes a few large, high-quality models with smaller, less
 * contended ones near the bottom — a run should still complete on a quiet
 * small model even when the flagship free models are saturated.
 */
export const FREE_MODEL_CHAIN = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
];

/** @returns {string|null} the operator-supplied key, or null if none set. */
export function getStoredKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** @param {string} key */
export function setStoredKey(key) {
  try {
    if (!key) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, key.trim());
    }
  } catch {
    // localStorage unavailable (private browsing etc.) — live AI simply
    // won't persist across reloads; the deterministic fallback still works.
  }
}

export function hasLiveAI() {
  return Boolean(getStoredKey());
}

/**
 * Call one model in the chat completions API. Internal — use
 * `chatJSON` / `chatText` below, which add the fallback chain.
 */
async function callOnce(model, messages, { temperature, maxTokens, apiKey, signal }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://orbitops.dev',
      'X-Title': 'OrbitOps',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: temperature ?? 0.4,
      max_tokens: maxTokens ?? 700,
    }),
    signal,
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.retryable = res.status === 429 || res.status === 404 || res.status >= 500;
    throw err;
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty completion from model');
  return content;
}

/**
 * Run a chat completion, walking the model fallback chain on retryable
 * failures (rate limits, missing providers, upstream 5xx).
 *
 * @param {{role: string, content: string}[]} messages
 * @param {{temperature?: number, maxTokens?: number, models?: string[]}} [opts]
 * @returns {Promise<{ok: true, content: string, model: string, latencyMs: number} | {ok: false, error: string, isConfigError: boolean}>}
 */
export async function chatText(messages, opts = {}) {
  const apiKey = getStoredKey();
  if (!apiKey) {
    return { ok: false, error: 'No OpenRouter API key configured.', isConfigError: true };
  }

  const models = opts.models || FREE_MODEL_CHAIN;
  const started = performance.now();
  let lastError = 'Unknown error';

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const content = await callOnce(model, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        apiKey,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { ok: true, content, model, latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      clearTimeout(timer);
      lastError = e.message;
      if (e.name === 'AbortError') lastError = `${model} timed out after ${REQUEST_TIMEOUT_MS}ms`;
      // Non-retryable (e.g. bad API key -> 401) — stop walking the chain.
      if (e.status === 401 || e.status === 403) {
        return { ok: false, error: `OpenRouter rejected the API key (${e.status}).`, isConfigError: true };
      }
      // Otherwise try the next model in the fallback chain.
    }
  }

  return { ok: false, error: `All models failed. Last error: ${lastError}`, isConfigError: false };
}

/**
 * Same as `chatText`, but instructs the model to return strict JSON and
 * parses it. Falls back to `{ok: false}` on malformed JSON rather than
 * throwing, since a free model occasionally wraps JSON in prose despite
 * instructions.
 *
 * @param {{role: string, content: string}[]} messages
 * @param {object} [opts]
 */
export async function chatJSON(messages, opts = {}) {
  const result = await chatText(messages, opts);
  if (!result.ok) return result;

  const raw = result.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : raw;

  try {
    const parsed = JSON.parse(candidate);
    return { ...result, parsed };
  } catch {
    return {
      ok: false,
      error: `Model (${result.model}) did not return valid JSON.`,
      isConfigError: false,
    };
  }
}
