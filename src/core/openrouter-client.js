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
  return parseJsonResult(result);
}

/** @param {{ok: true, content: string, model: string, latencyMs: number}} result */
function parseJsonResult(result) {
  const raw = result.content.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : raw;

  try {
    const parsed = JSON.parse(candidate);
    return { ...result, parsed };
  } catch {
    return {
      ok: /** @type {false} */ (false),
      error: `Model (${result.model}) did not return valid JSON.`,
      isConfigError: false,
    };
  }
}

/* ============================================================
   Streaming (SSE) support — token-by-token output for the console.
   ============================================================ */

// A streaming request may legitimately run long while tokens flow; what it must
// not do is hang silently. Cap time-to-first-byte separately from the total.
const STREAM_FIRST_BYTE_TIMEOUT_MS = 25000;
const STREAM_TOTAL_TIMEOUT_MS = 60000;
// Upper bound on an accumulated streamed completion. The three agents each emit
// a small strict-JSON object (~700 tokens ≈ a few KB); 64 KB is far above any
// legitimate response and caps memory + render cost against a hostile or
// malfunctioning BYOK endpoint.
const MAX_STREAM_CONTENT_CHARS = 64 * 1024;
// Upper bound on RAW bytes read from the stream, independent of parsed content.
// The content cap above only trips once a COMPLETE SSE event parses; an endpoint
// that streams bytes which never form a terminated event (no `\n\n`) would leave
// `content` empty and never hit that cap — only this guard bounds that case.
// 256 KB comfortably clears a full ~700-token response with SSE envelope overhead
// (~150-200 B/token) while still capping an endless stream well before the 60 s
// total timeout would.
const MAX_STREAM_RAW_CHARS = 256 * 1024;

/**
 * Incremental parser for OpenAI-style server-sent events. Pure and stateful:
 * feed it raw network chunks, get back the `data:` payload strings of every
 * COMPLETE event seen so far (events split across chunk boundaries are held
 * until their terminator arrives). Exported for unit tests.
 * @returns {{ push: (chunk: string) => string[] }}
 */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      /** @type {string[]} */
      const events = [];
      // SSE events are separated by a blank line (\n\n, or \r\n\r\n per spec).
      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith('data:')) events.push(line.slice(5).trim());
        }
      }
      return events;
    },
  };
}

/**
 * Extract the (possibly still-growing) value of a top-level string field from a
 * partial JSON object as it streams in — e.g. pull `thinkNarrative` out of
 * `{"thinkNarrative": "The conjunction geom…` before the JSON is complete, so
 * the UI can render narrative text live without ever showing raw JSON syntax.
 * Handles escaped quotes/backslashes; returns '' until the field's opening
 * quote has arrived. Exported for unit tests.
 * @param {string} partialJson
 * @param {string} field
 * @returns {string}
 */
export function extractJsonStringField(partialJson, field) {
  const key = `"${field}"`;
  const keyIdx = partialJson.indexOf(key);
  if (keyIdx === -1) return '';
  const colonIdx = partialJson.indexOf(':', keyIdx + key.length);
  if (colonIdx === -1) return '';
  const openIdx = partialJson.indexOf('"', colonIdx + 1);
  if (openIdx === -1) return '';
  let out = '';
  for (let i = openIdx + 1; i < partialJson.length; i++) {
    const ch = partialJson[i];
    if (ch === '\\') {
      const next = partialJson[i + 1];
      if (next === undefined) break; // escape split across chunks — wait
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'u') {
        const hex = partialJson.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16) || 0);
        i += 4;
      } else out += next; // \" \\ \/ and friends
      i++;
      continue;
    }
    if (ch === '"') break; // field closed
    out += ch;
  }
  return out;
}

/**
 * Streaming variant of `chatJSON`: requests `stream: true`, invokes
 * `opts.onDelta(contentSoFar)` as tokens arrive, then parses the completed
 * content exactly like `chatJSON`. Falls back to the buffered `chatJSON` path
 * transparently when the response isn't a readable SSE stream (proxies and
 * some gateways don't support it) — callers get the same result shape either
 * way, and the model fallback chain still applies across failures.
 *
 * @param {{role: string, content: string}[]} messages
 * @param {{temperature?: number, maxTokens?: number, models?: string[], onDelta?: (content: string) => void}} [opts]
 * @returns {Promise<{ok: true, content: string, model: string, latencyMs: number, parsed: any} | {ok: false, error: string, isConfigError: boolean}>}
 */
export async function chatJSONStream(messages, opts = {}) {
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
    const totalTimer = setTimeout(() => controller.abort(), STREAM_TOTAL_TIMEOUT_MS);
    let firstByteTimer = setTimeout(() => controller.abort(), STREAM_FIRST_BYTE_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: endpoint.headers(cfg.apiKey),
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 700,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body?.error?.message || `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403) {
          clearTimeout(totalTimer);
          clearTimeout(firstByteTimer);
          return { ok: false, error: `${cfg.preset.label} rejected the API key (${res.status}).`, isConfigError: true };
        }
        lastError = message;
        clearTimeout(totalTimer);
        clearTimeout(firstByteTimer);
        continue;
      }

      if (!res.body) {
        // No readable stream in this environment/gateway — buffered fallback.
        clearTimeout(totalTimer);
        clearTimeout(firstByteTimer);
        return chatJSON(messages, { ...opts, models: [model, ...models.filter((m) => m !== model)] });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const sse = createSseParser();
      let content = '';
      let rawSeen = 0;
      let done = false;
      let overflowed = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        clearTimeout(firstByteTimer);
        firstByteTimer = setTimeout(() => controller.abort(), STREAM_FIRST_BYTE_TIMEOUT_MS);
        if (readerDone) break;
        const chunk = decoder.decode(value, { stream: true });
        rawSeen += chunk.length;
        if (rawSeen > MAX_STREAM_RAW_CHARS) {
          // Bytes are flowing but not forming terminated events, so `content`
          // never grows into its cap — bound the raw side too.
          overflowed = true;
          controller.abort();
          break;
        }
        let grew = false;
        for (const data of sse.push(chunk)) {
          if (data === '[DONE]') {
            done = true;
            break;
          }
          try {
            const evt = JSON.parse(data);
            const delta = evt?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              content += delta;
              // Hard cap: the agents emit a small (~700-token) JSON object, so a
              // response past this bound is a broken or hostile endpoint, not a
              // real answer.
              if (content.length > MAX_STREAM_CONTENT_CHARS) {
                overflowed = true;
                done = true;
                controller.abort();
                break;
              }
              grew = true;
            }
          } catch {
            // Comment/keep-alive lines and provider extras are skippable noise.
          }
        }
        // Coalesce the UI update to once per network chunk rather than once per
        // SSE event: several tokens usually arrive together, and only the last
        // render paints — this collapses a burst of per-token O(n) re-scans and
        // forced reflows into a single one, with identical final output.
        if (grew && !overflowed) opts.onDelta?.(content);
      }
      clearTimeout(totalTimer);
      clearTimeout(firstByteTimer);

      if (overflowed) {
        lastError = `${model} exceeded the ${MAX_STREAM_CONTENT_CHARS}-char stream cap`;
        continue;
      }
      if (!content) {
        lastError = 'Empty streamed completion';
        continue;
      }
      const parsed = parseJsonResult({
        ok: true,
        content,
        model,
        latencyMs: Math.round(performance.now() - started),
      });
      // A model that streamed to completion but produced non-JSON (some free
      // models ignore the JSON instruction) should not fail the whole call —
      // walk to the next model, exactly as the non-JSON path does buffered.
      if (!parsed.ok) {
        lastError = parsed.error;
        continue;
      }
      return parsed;
    } catch (e) {
      clearTimeout(totalTimer);
      clearTimeout(firstByteTimer);
      const err = /** @type {Error & {status?: number}} */ (e);
      lastError = err.name === 'AbortError' ? `${model} stream timed out` : err.message;
      // Try the next model in the fallback chain.
    }
  }

  return { ok: false, error: `All models failed. Last error: ${lastError}`, isConfigError: false };
}
