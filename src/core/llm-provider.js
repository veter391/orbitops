// @ts-check
/**
 * LLM provider configuration — decouples OrbitOps from any single vendor.
 *
 * The agent's optional "live AI" layer talks to an OpenAI-compatible
 * chat-completions endpoint. That covers the overwhelming majority of providers
 * a real operator would use — OpenRouter, OpenAI, xAI (Grok), Groq, Together,
 * Fireworks — and any self-hosted gateway (vLLM, Ollama, or a LiteLLM proxy that
 * fronts Anthropic / AWS Bedrock / an in-house model). An operator who does not
 * want to route through OpenRouter can point straight at their own endpoint.
 *
 * Everything here is client-only: the base URL, model, and API key live in this
 * browser's localStorage and are sent only to the endpoint the operator sets —
 * never committed, never proxied through us.
 *
 * @module core/llm-provider
 */

'use strict';

/**
 * Ordered fallback chain of free OpenRouter models, most-capable first. Only the
 * OpenRouter preset uses a multi-model chain (its free tier is shared, contended
 * infrastructure); every other provider uses the single model the operator sets.
 */
export const FREE_MODEL_CHAIN = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
];

/**
 * @typedef {Object} ProviderPreset
 * @property {string} id
 * @property {string} label
 * @property {string} baseUrl        Base URL (without the trailing /chat/completions); '' means operator-supplied.
 * @property {string[]} defaultModels Fallback chain used when the operator sets no model.
 * @property {boolean} [referer]     Send OpenRouter's HTTP-Referer / X-Title headers.
 * @property {boolean} [custom]      Operator supplies the base URL.
 * @property {string} note           One-line guidance shown in Settings.
 * @property {string} [modelHint]    Placeholder for the model field.
 */

/** @type {ProviderPreset[]} */
export const PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: FREE_MODEL_CHAIN,
    referer: true,
    note: 'BYOK aggregator; free-tier models run the demo at zero cost.',
    modelHint: 'optional — defaults to the free chain',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: [],
    note: 'Your OpenAI key and model.',
    modelHint: 'your OpenAI model id',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModels: [],
    note: 'Grok is OpenAI-compatible — connect it directly, no OpenRouter.',
    modelHint: 'your Grok model id',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModels: [],
    note: 'OpenAI-compatible, low-latency inference.',
    modelHint: 'your Groq model id',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModels: [],
    custom: true,
    note: 'Any OpenAI-compatible endpoint: self-hosted vLLM/Ollama, an Azure gateway, or a LiteLLM proxy in front of Anthropic / Bedrock / an in-house model.',
    modelHint: 'your model id',
  },
];

const PROVIDER_KEY = 'orbitops:llm:provider';
const BASEURL_KEY = 'orbitops:llm:baseUrl';
const MODEL_KEY = 'orbitops:llm:model';
const LEGACY_OPENROUTER_KEY = 'orbitops:openrouter_key';

/** @param {string} k @returns {string} */
function ls(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
}
/** @param {string} k @param {string} v */
function setLs(k, v) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage unavailable — config simply won't persist this session */
  }
}

/** @param {string} providerId @returns {string} localStorage key for that provider's API key. */
function keyStore(providerId) {
  return `orbitops:llm:key:${providerId}`;
}

/** @returns {ProviderPreset} the active provider preset (defaults to OpenRouter). */
export function activeProvider() {
  const id = ls(PROVIDER_KEY) || 'openrouter';
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

/**
 * @typedef {Object} LlmConfig
 * @property {string} providerId
 * @property {ProviderPreset} preset
 * @property {string} baseUrl
 * @property {string} model
 * @property {string} apiKey
 */

/** @returns {LlmConfig} the resolved active LLM configuration. */
export function getLlmConfig() {
  const preset = activeProvider();
  const baseUrl = (preset.custom ? ls(BASEURL_KEY) : preset.baseUrl).replace(/\/+$/, '');
  return {
    providerId: preset.id,
    preset,
    baseUrl,
    model: ls(MODEL_KEY),
    apiKey: getStoredKey() || '',
  };
}

/**
 * Persist a partial config. Missing fields are left untouched.
 * @param {{providerId?: string, baseUrl?: string, model?: string}} patch
 */
export function setLlmConfig(patch) {
  if (patch.providerId !== undefined) setLs(PROVIDER_KEY, patch.providerId);
  if (patch.baseUrl !== undefined) setLs(BASEURL_KEY, patch.baseUrl.trim().replace(/\/+$/, ''));
  if (patch.model !== undefined) setLs(MODEL_KEY, patch.model.trim());
}

/**
 * The active provider's API key. Provider-scoped, so switching providers doesn't
 * mix keys. Falls back to the legacy `orbitops:openrouter_key` for the OpenRouter
 * provider so an existing key keeps working.
 * @returns {string|null}
 */
export function getStoredKey() {
  const id = ls(PROVIDER_KEY) || 'openrouter';
  const k = ls(keyStore(id));
  if (k) return k;
  if (id === 'openrouter') return ls(LEGACY_OPENROUTER_KEY) || null;
  return null;
}

/** Store the active provider's API key. @param {string} key */
export function setStoredKey(key) {
  const id = ls(PROVIDER_KEY) || 'openrouter';
  const trimmed = (key || '').trim();
  setLs(keyStore(id), trimmed);
  // Keep the legacy key in sync so older code paths and existing users are safe.
  if (id === 'openrouter') setLs(LEGACY_OPENROUTER_KEY, trimmed);
}

/** @returns {boolean} true when the active provider has a key configured. */
export function hasLiveAI() {
  return Boolean(getStoredKey());
}

/**
 * Resolve the concrete request target for the active config: the full URL, a
 * header builder, and the model fallback list.
 * @param {LlmConfig} cfg
 * @returns {{ url: string, models: string[], headers: (apiKey: string) => Record<string, string>, error?: string }}
 */
export function resolveEndpoint(cfg) {
  const models = cfg.model ? [cfg.model] : cfg.preset.defaultModels;
  const base = cfg.baseUrl;
  const referer = cfg.preset.referer;
  /** @param {string} apiKey @returns {Record<string,string>} */
  const headers = (apiKey) => {
    /** @type {Record<string,string>} */
    const h = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (referer) {
      h['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://orbitops.dev';
      h['X-Title'] = 'OrbitOps';
    }
    return h;
  };
  if (!base) return { url: '', models, headers, error: 'No backend URL set for the custom provider.' };
  if (models.length === 0) return { url: `${base}/chat/completions`, models, headers, error: 'No model configured for this provider.' };
  return { url: `${base}/chat/completions`, models, headers };
}
