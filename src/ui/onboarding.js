// @ts-check
/**
 * onboarding.js — first-run setup wizard for the self-hosted (app-mode) build.
 *
 * Shows ONCE, only in app mode (see core/app-config.js), the first time an
 * operator opens their own OrbitOps. The public demo (site mode) never sees it —
 * that build runs on the shared, proxied key and needs no setup. Two compact
 * steps, then straight into the dashboard. Everything chosen here is editable in
 * Settings, so the wizard stays fast and non-scary; advanced users can skip it.
 *
 *   Step 1 — Satellite data   : open CelesTrak feed (no key) vs your own TLE URL.
 *   Step 2 — AI models        : deterministic-only (no key) / OpenRouter free /
 *                               advanced (any provider; auto-detect + auto-pick a
 *                               real, working model from the provider's /models).
 *
 * It writes only through the app's existing config contracts:
 *   - data sources → localStorage `orbitops:settings:sources` (shared with
 *     core/live-constellation.js and the Settings page — same JSON shape).
 *   - LLM provider/key/model → core/llm-provider.js (setLlmConfig / setStoredKey).
 * No new source of truth, so Settings and the wizard never drift.
 *
 * @module ui/onboarding
 */

'use strict';

import { isAppMode } from '../core/app-config.js';
import { PROVIDERS, setLlmConfig, setStoredKey } from '../core/llm-provider.js';
import { esc } from '../utils.js';

const ONBOARDED_KEY = 'orbitops:onboarded';
const SOURCES_KEY = 'orbitops:settings:sources';

/**
 * Best-effort curated default model per provider — used ONLY when the live
 * `/models` probe can't run (CORS, offline, or a key that rejects the probe but
 * still works for chat). Conservative, widely-available ids so a saved config is
 * never empty or broken. The live probe below is always preferred.
 * @type {Record<string,string>}
 */
const FALLBACK_MODEL = {
  openai: 'gpt-4o-mini',
  xai: 'grok-2-latest',
  groq: 'llama-3.3-70b-versatile',
  openrouter: '', // empty → the free fallback chain in llm-provider.js
  custom: '',
};

/**
 * Ordered preference patterns applied to a provider's live `/models` list. First
 * match wins; if none match we fall back to the first chat-capable id. Tuned to
 * land on a sensible mid-tier default (capable but not the priciest flagship),
 * which the operator can change in Settings.
 * @type {Record<string, RegExp[]>}
 */
const MODEL_PREFS = {
  openai: [/^gpt-4o-mini$/i, /^gpt-4\.1-mini/i, /^gpt-4o$/i, /^gpt-4\.1$/i, /^o4-mini/i, /^gpt-4/i],
  xai: [/grok.*fast/i, /grok-4/i, /grok-3(?!.*mini)/i, /grok-3/i, /grok-2/i, /grok/i],
  groq: [/llama-3\.3-70b-versatile/i, /llama-3\.1-70b/i, /llama-3\.3/i, /llama-3/i, /llama/i],
  openrouter: [/gpt-4o-mini/i, /llama-3\.3-70b.*:free/i, /:free/i],
};

/** @param {string} k @param {string} v */
function setLS(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable — the wizard still applies config for this session */
  }
}
/** @param {string} k @returns {string|null} */
function getLS(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

/** @returns {boolean} whether the wizard should run now. */
function shouldShow() {
  if (!isAppMode()) return false;
  return getLS(ONBOARDED_KEY) !== '1';
}

/**
 * Persist the data-source choice through the shared sources contract.
 * @param {boolean} celestrak @param {string} customTleUrl
 */
function saveSources(celestrak, customTleUrl) {
  const payload = { celestrak, customTleUrl: (customTleUrl || '').trim() };
  setLS(SOURCES_KEY, JSON.stringify(payload));
}

/**
 * Guess the provider from an API key's prefix. Returns null for an unrecognised
 * shape (→ the operator picks a provider / supplies a custom base URL).
 * @param {string} key
 * @returns {string|null}
 */
function detectProvider(key) {
  const k = (key || '').trim();
  if (/^sk-or-/i.test(k)) return 'openrouter';
  if (/^xai-/i.test(k)) return 'xai';
  if (/^gsk_/i.test(k)) return 'groq';
  if (/^sk-/i.test(k)) return 'openai';
  return null;
}

/** @param {string} providerId @returns {string} the preset base URL (may be ''). */
function baseUrlFor(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  return p ? p.baseUrl : '';
}

/**
 * Probe a provider's OpenAI-compatible `/models` endpoint with the given key and
 * return the available model ids. Times out fast and throws on any failure so the
 * caller can fall back to a curated default. Validates the key as a side effect
 * (a 401 throws). @param {string} baseUrl @param {string} key
 * @returns {Promise<string[]>}
 */
async function fetchModels(baseUrl, key) {
  const base = baseUrl.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`models probe failed (${res.status})`);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : json.data || json.models || [];
    return rows
      .map((/** @type {any} */ m) => (typeof m === 'string' ? m : m && (m.id || m.name)))
      .filter((/** @type {any} */ x) => typeof x === 'string' && x.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick the recommended model id from a live list for a provider, honouring the
 * preference order and falling back to the first plausible chat model.
 * @param {string[]} ids @param {string} providerId @returns {string}
 */
function pickModel(ids, providerId) {
  const prefs = MODEL_PREFS[providerId] || [];
  for (const rx of prefs) {
    const hit = ids.find((id) => rx.test(id));
    if (hit) return hit;
  }
  // No preference matched — avoid obvious non-chat models, else take the first.
  const chatty = ids.find((id) => !/embed|whisper|tts|dall|moderation|image|rerank/i.test(id));
  return chatty || ids[0] || '';
}

/**
 * Resolve and persist the model config for the advanced flow: probe /models,
 * auto-pick, and fall back to a curated default if the probe can't run. Always
 * leaves a non-broken config. @param {string} providerId @param {string} baseUrl
 * @param {string} key @returns {Promise<{model: string, verified: boolean}>}
 */
async function resolveAndSaveModel(providerId, baseUrl, key) {
  let model = '';
  let verified = false;
  try {
    const ids = await fetchModels(baseUrl, key);
    if (ids.length) {
      model = pickModel(ids, providerId);
      verified = true;
    }
  } catch {
    /* fall through to the curated default */
  }
  if (!model) model = FALLBACK_MODEL[providerId] ?? '';
  setLlmConfig({ providerId, baseUrl, model });
  setStoredKey(key);
  return { model, verified };
}

/* ── Markup ──────────────────────────────────────────────────────────────── */

const BRAND = `
  <svg class="ob__logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <ellipse cx="16" cy="16" rx="13" ry="5" stroke="currentColor" stroke-width="1.3" opacity="0.55"/>
    <ellipse cx="16" cy="16" rx="13" ry="5" stroke="currentColor" stroke-width="1.3" opacity="0.55" transform="rotate(60 16 16)"/>
    <ellipse cx="16" cy="16" rx="13" ry="5" stroke="currentColor" stroke-width="1.3" opacity="0.55" transform="rotate(-60 16 16)"/>
    <circle cx="16" cy="16" r="3" fill="currentColor"/>
  </svg>`;

/**
 * @typedef {Object} WizardState
 * @property {number} step
 * @property {string} dataChoice
 * @property {string} customTleUrl
 * @property {string} modelChoice
 */

/** @param {number} step 1-based current step (2 steps total). */
function stepDots(step) {
  return `<div class="ob__dots" aria-hidden="true">${[1, 2]
    .map((n) => `<span class="ob__dot${n === step ? ' is-on' : ''}${n < step ? ' is-done' : ''}"></span>`)
    .join('')}</div>`;
}

/** @param {WizardState} state */
function step1Html(state) {
  const sel = state.dataChoice;
  return `
    <div class="ob__step" data-step="1">
      <p class="ob__eyebrow">Step 1 · Satellite data</p>
      <h2 class="ob__title" id="obTitle">Where should orbits come from?</h2>
      <p class="ob__lede">OrbitOps flies real objects on SGP4. Start with the open catalog — you can add your own feed any time.</p>
      <div class="ob__cards" role="radiogroup" aria-label="Satellite data source">
        <button type="button" class="ob-card${sel === 'open' ? ' is-sel' : ''}" data-data="open" role="radio" aria-checked="${sel === 'open'}">
          <span class="ob-card__k">Open data</span>
          <span class="ob-card__badge ob-card__badge--ok">no key · works now</span>
          <span class="ob-card__d">Live TLEs from CelesTrak (Starlink, OneWeb, stations) with a bundled offline snapshot. Recommended.</span>
        </button>
        <button type="button" class="ob-card${sel === 'own' ? ' is-sel' : ''}" data-data="own" role="radio" aria-checked="${sel === 'own'}">
          <span class="ob-card__k">Your own feed</span>
          <span class="ob-card__badge">Space-Track / custom</span>
          <span class="ob-card__d">Point at your Space-Track proxy or any TLE URL. Use <code>{GROUP}</code> to template per group.</span>
        </button>
      </div>
      <div class="ob__reveal${sel === 'own' ? ' is-open' : ''}" data-reveal="own">
        <label class="ob__label" for="obTleUrl">Custom TLE URL <span class="ob__opt">(optional — the open feed stays as fallback)</span></label>
        <input class="ob__input" id="obTleUrl" type="url" inputmode="url" spellcheck="false"
          placeholder="https://your-proxy.example/tle?group={GROUP}" value="${esc(state.customTleUrl)}" />
      </div>
    </div>`;
}

/** @param {WizardState} state */
function step2Html(state) {
  const sel = state.modelChoice;
  return `
    <div class="ob__step" data-step="2">
      <p class="ob__eyebrow">Step 2 · AI models</p>
      <h2 class="ob__title" id="obTitle">Connect a model — or run pure math</h2>
      <p class="ob__lede">The flight-dynamics engine is fully deterministic and needs no key. A model only adds an advisory layer on top; it never changes a computed decision.</p>
      <div class="ob__cards ob__cards--col" role="radiogroup" aria-label="AI model setup">
        <button type="button" class="ob-card${sel === 'none' ? ' is-sel' : ''}" data-model="none" role="radio" aria-checked="${sel === 'none'}">
          <span class="ob-card__k">Deterministic engine only <span class="ob-card__badge ob-card__badge--warn">MATH ONLY</span></span>
          <span class="ob-card__d">Real orbital math, no network, no key. The AI advisory notes and chat stay off until you add a model.</span>
        </button>
        <button type="button" class="ob-card${sel === 'orfree' ? ' is-sel' : ''}" data-model="orfree" role="radio" aria-checked="${sel === 'orfree'}">
          <span class="ob-card__k">OpenRouter free models</span>
          <span class="ob-card__d">Run the advisory layer at zero cost on OpenRouter's free tier with your own key.</span>
        </button>
        <button type="button" class="ob-card${sel === 'advanced' ? ' is-sel' : ''}" data-model="advanced" role="radio" aria-checked="${sel === 'advanced'}">
          <span class="ob-card__k">Advanced — your provider</span>
          <span class="ob-card__d">OpenAI, xAI (Grok), Groq, paid OpenRouter, or any OpenAI-compatible endpoint. We auto-detect it and pick a working model for you.</span>
        </button>
      </div>

      <div class="ob__reveal${sel === 'orfree' ? ' is-open' : ''}" data-reveal="orfree">
        <label class="ob__label" for="obKeyFree">OpenRouter API key</label>
        <input class="ob__input" id="obKeyFree" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-v1-…" value="" />
        <p class="ob__hint">Stored only in this browser. <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">Get a free OpenRouter key →</a></p>
      </div>

      <div class="ob__reveal${sel === 'advanced' ? ' is-open' : ''}" data-reveal="advanced">
        <label class="ob__label" for="obKeyAdv">API key</label>
        <input class="ob__input" id="obKeyAdv" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…, xai-…, gsk_… — any provider" value="" />
        <div class="ob__reveal" data-reveal="custombase">
          <label class="ob__label" for="obBaseUrl">Base URL <span class="ob__opt">(OpenAI-compatible, without /chat/completions)</span></label>
          <input class="ob__input" id="obBaseUrl" type="url" spellcheck="false" placeholder="https://your-gateway.example/v1" value="" />
        </div>
        <p class="ob__hint" data-adv-status>Paste a key — we detect the provider and pick a model automatically.</p>
      </div>
    </div>`;
}

function doneHtml() {
  return `
    <div class="ob__step ob__step--done" data-step="done">
      <div class="ob__done-mark">${BRAND}</div>
      <h2 class="ob__title" id="obTitle">You're set</h2>
      <p class="ob__lede">Everything you just chose lives in <strong>Settings</strong> — change providers, models, or data sources any time. Welcome aboard.</p>
    </div>`;
}

/* ── Mount + wiring ──────────────────────────────────────────────────────── */

/**
 * Build and mount the wizard overlay. Resolves when the operator finishes or
 * skips (the onboarded flag is set either way). @returns {void}
 */
function mount() {
  injectStyles();

  const state = {
    step: 1,
    dataChoice: 'open',
    customTleUrl: '',
    modelChoice: 'none',
  };

  const scrim = document.createElement('div');
  scrim.className = 'ob-scrim';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-labelledby', 'obTitle');
  document.body.appendChild(scrim);
  document.documentElement.style.overflow = 'hidden';

  /** Tear down and mark done. */
  const finish = () => {
    setLS(ONBOARDED_KEY, '1');
    document.documentElement.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    scrim.classList.add('is-closing');
    setTimeout(() => scrim.remove(), 260);
  };

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') finish();
  };
  document.addEventListener('keydown', onKey);

  function render() {
    const body =
      state.step === 1 ? step1Html(state) : state.step === 2 ? step2Html(state) : doneHtml();
    const isDone = state.step > 2;
    const backBtn =
      state.step === 2
        ? `<button type="button" class="ob-btn ob-btn--ghost" data-act="back">Back</button>`
        : `<button type="button" class="ob-btn ob-btn--ghost" data-act="skip">Skip setup</button>`;
    const nextLabel = state.step === 1 ? 'Continue' : 'Finish';
    const foot = isDone
      ? `<button type="button" class="ob-btn ob-btn--primary ob-btn--wide" data-act="enter">Enter OrbitOps</button>`
      : `${backBtn}<button type="button" class="ob-btn ob-btn--primary" data-act="next">${nextLabel}</button>`;

    scrim.innerHTML = `
      <div class="ob" role="document">
        <header class="ob__head">
          <span class="ob__brand">${BRAND}<span class="ob__brand-txt">ORBIT OPS</span></span>
          ${isDone ? '' : stepDots(state.step)}
        </header>
        <div class="ob__body">${body}</div>
        <footer class="ob__foot">${foot}</footer>
      </div>`;

    wire();
  }

  function wire() {
    // Data-source cards (step 1)
    scrim.querySelectorAll('[data-data]').forEach((el) => {
      el.addEventListener('click', () => {
        state.dataChoice = /** @type {HTMLElement} */ (el).getAttribute('data-data') || 'open';
        const url = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obTleUrl'));
        if (url) state.customTleUrl = url.value;
        render();
        if (state.dataChoice === 'own')
          /** @type {HTMLElement|null} */ (scrim.querySelector('#obTleUrl'))?.focus();
      });
    });
    // Model cards (step 2)
    scrim.querySelectorAll('[data-model]').forEach((el) => {
      el.addEventListener('click', () => {
        state.modelChoice = /** @type {HTMLElement} */ (el).getAttribute('data-model') || 'none';
        render();
        const focusId = state.modelChoice === 'orfree' ? '#obKeyFree' : state.modelChoice === 'advanced' ? '#obKeyAdv' : '';
        if (focusId) /** @type {HTMLElement|null} */ (scrim.querySelector(focusId))?.focus();
      });
    });
    // Advanced: reveal a custom base-URL field when the key shape is unknown.
    const advKey = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obKeyAdv'));
    if (advKey) {
      advKey.addEventListener('input', () => {
        const det = detectProvider(advKey.value);
        const customReveal = scrim.querySelector('[data-reveal="custombase"]');
        const status = scrim.querySelector('[data-adv-status]');
        if (advKey.value.trim() && !det) {
          customReveal?.classList.add('is-open');
          if (status) status.textContent = 'Unrecognised key shape — set the base URL for your OpenAI-compatible endpoint.';
        } else {
          customReveal?.classList.remove('is-open');
          if (status)
            status.textContent = det
              ? `Detected ${labelFor(det)} — we'll pick a working model on Finish.`
              : 'Paste a key — we detect the provider and pick a model automatically.';
        }
      });
    }
    // Footer actions
    scrim.querySelector('[data-act="skip"]')?.addEventListener('click', finish);
    scrim.querySelector('[data-act="enter"]')?.addEventListener('click', finish);
    scrim.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      state.step = 1;
      render();
    });
    scrim.querySelector('[data-act="next"]')?.addEventListener('click', onNext);
  }

  async function onNext() {
    if (state.step === 1) {
      const url = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obTleUrl'));
      state.customTleUrl = url ? url.value : '';
      saveSources(true, state.dataChoice === 'own' ? state.customTleUrl : '');
      state.step = 2;
      render();
      return;
    }
    // Step 2 — apply model choice, then finish.
    const nextBtn = /** @type {HTMLButtonElement|null} */ (scrim.querySelector('[data-act="next"]'));
    if (state.modelChoice === 'none') {
      setStoredKey(''); // deterministic only
      state.step = 3;
      render();
      return;
    }
    if (state.modelChoice === 'orfree') {
      const k = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obKeyFree'))?.value.trim() || '';
      if (!k) return flashRequired('#obKeyFree');
      setLlmConfig({ providerId: 'openrouter', model: '' }); // free fallback chain
      setStoredKey(k);
      state.step = 3;
      render();
      return;
    }
    // advanced
    const key = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obKeyAdv'))?.value.trim() || '';
    if (!key) return flashRequired('#obKeyAdv');
    const detected = detectProvider(key);
    const providerId = detected || 'custom';
    let baseUrl = baseUrlFor(providerId);
    if (providerId === 'custom') {
      baseUrl = /** @type {HTMLInputElement|null} */ (scrim.querySelector('#obBaseUrl'))?.value.trim() || '';
      if (!baseUrl) return flashRequired('#obBaseUrl');
    }
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = 'Connecting…';
    }
    const { model, verified } = await resolveAndSaveModel(providerId, baseUrl, key);
    const status = scrim.querySelector('[data-adv-status]');
    if (status) {
      status.textContent = verified
        ? `Connected to ${labelFor(providerId)} · model ${model}`
        : `Saved for ${labelFor(providerId)} · default model ${model || '(provider default)'} (couldn't verify live)`;
    }
    state.step = 3;
    render();
  }

  /** @param {string} sel */
  function flashRequired(sel) {
    const el = /** @type {HTMLElement|null} */ (scrim.querySelector(sel));
    if (!el) return;
    el.classList.add('is-error');
    el.focus();
    setTimeout(() => el.classList.remove('is-error'), 1200);
  }

  render();
  // Focus the first card for keyboard users.
  scrim.querySelector('.ob-card')?.setAttribute('tabindex', '0');
}

/** @param {string} providerId @returns {string} */
function labelFor(providerId) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  return p ? p.label : providerId;
}

/** Inject the wizard stylesheet once (same idempotent pattern as chrome-v2). */
function injectStyles() {
  if (document.querySelector('link[data-onboarding]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/src/styles/onboarding.css';
  link.setAttribute('data-onboarding', '');
  document.head.appendChild(link);
}

/**
 * Entry point — mount the first-run wizard when appropriate (app mode, not yet
 * onboarded, storage available). No-op otherwise. Call once after boot.
 * @returns {void}
 */
export function maybeShowOnboarding() {
  if (!shouldShow()) return;
  mount();
}
