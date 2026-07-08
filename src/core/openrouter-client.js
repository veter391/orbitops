// @ts-check
/**
 * Minimal chat-completions client for the agent's optional "live AI" layer.
 *
 * Despite the filename (kept for import stability), this is now provider-
 * agnostic: it talks to whatever OpenAI-compatible endpoint the operator
 * configures in `core/llm-provider.js` — OpenRouter by default, or OpenAI, xAI
 * (Grok), Groq, or any self-hosted / gateway endpoint. See that module for the
 * provider config and key handling.
 *
 * Design constraints (this is a static, serverless site):
 *   - The API key is supplied by the operator at runtime and stored only in this
 *     browser's localStorage. It is NEVER hardcoded, never committed, and sent
 *     only to the endpoint the operator set.
 *   - Every call has a hard timeout and (for OpenRouter's shared free tier) a
 *     model fallback chain; every caller MUST handle `ok: false` and fall back
 *     to the deterministic path — a public demo must never hard-fail because a
 *     model is temporarily saturated or a key is missing.
 *
 * @module core/openrouter-client
 */

'use strict';

import {
  FREE_MODEL_CHAIN,
  getLlmConfig,
  resolveEndpoint,
  getStoredKey,
  setStoredKey,
  hasLiveAI,
} from './llm-provider.js';

// Re-export the key/provider surface so existing importers keep working.
export { FREE_MODEL_CHAIN, getStoredKey, setStoredKey, hasLiveAI };

const REQUEST_TIMEOUT_MS = 25000;

/**
 * Call one model against the resolved endpoint. Internal — use `chatJSON` /
 * `chatText`, which add the fallback chain.
 * @param {string} model
 * @param {Array<{role: string, content: string}>} messages
 * @param {{temperature?: number, maxTokens?: number, apiKey: string, signal: AbortSignal, url: string, headers: (k: string) => Record<string, string>}} opts
 * @returns {Promise<string>}
 */
async function callOnce(model, messages, { temperature, maxTokens, apiKey, signal, url, headers }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey),
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
    /** @type {Error & {status?: number, retryable?: boolean}} */
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
 * Run a chat completion against the active provider, walking the model fallback
 * chain on retryable failures (rate limits, missing providers, upstream 5xx).
 *
 * @param {{role: string, content: string}[]} messages
 * @param {{temperature?: number, maxTokens?: number, models?: string[]}} [opts]
 * @returns {Promise<{ok: true, content: string, model: string, latencyMs: number} | {ok: false, error: string, isConfigError: boolean}>}
 */
export async function chatText(messages, opts = {}) {
  const cfg = getLlmConfig();
  const endpoint = resolveEndpoint(cfg);
  if (!cfg.apiKey) {
    return { ok: false, error: `No API key configured for ${cfg.preset.label}.`, isConfigError: true };
  }
  if (endpoint.error) {
    return { ok: false, error: endpoint.error, isConfigError: true };
  }

  const models = opts.models || endpoint.models;
  const started = performance.now();
  let lastError = 'Unknown error';

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const content = await callOnce(model, messages, {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        apiKey: cfg.apiKey,
        signal: controller.signal,
        url: endpoint.url,
        headers: endpoint.headers,
      });
      clearTimeout(timer);
      return { ok: true, content, model, latencyMs: Math.round(performance.now() - started) };
    } catch (e) {
      clearTimeout(timer);
      const err = /** @type {Error & {status?: number}} */ (e);
      lastError = err.message;
      if (err.name === 'AbortError') lastError = `${model} timed out after ${REQUEST_TIMEOUT_MS}ms`;
      // Non-retryable (e.g. bad key -> 401) — stop walking the chain.
      if (err.status === 401 || err.status === 403) {
        return { ok: false, error: `${cfg.preset.label} rejected the API key (${err.status}).`, isConfigError: true };
      }
      // Otherwise try the next model in the fallback chain.
    }
  }

  return { ok: false, error: `All models failed. Last error: ${lastError}`, isConfigError: false };
}

/**
 * Same as `chatText`, but instructs the model to return strict JSON and parses
 * it. Falls back to `{ok: false}` on malformed JSON rather than throwing, since a
 * model occasionally wraps JSON in prose despite instructions.
 *
 * @param {{role: string, content: string}[]} messages
 * @param {{temperature?: number, maxTokens?: number, models?: string[]}} [opts]
 * @returns {Promise<{ok: true, content: string, model: string, latencyMs: number, parsed: any} | {ok: false, error: string, isConfigError: boolean}>}
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
