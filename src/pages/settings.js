// @ts-check
/**
 * SETTINGS — the operator control surface for a self-hosted OrbitOps.
 *
 * OrbitOps is open-core (MIT), one public repo, bring-your-own-key. This page
 * is the honest settings surface a real operator expects. The rule for every
 * control on it:
 *
 *   - Anything that CAN work with no backend works here today and persists to
 *     localStorage (API keys, compute caps, custom TLE URL/upload, audit
 *     export/verify/clear). These carry a REAL chip.
 *   - Anything that needs a server we do not have yet is fully DESIGNED with an
 *     honest empty/disabled state and a PLANNED (amber) or CLOUD (mute) chip.
 *     No fake "connected" states, no invented numbers.
 *
 * Sections (mono index §01…§08):
 *   §01 AI & AGENTS      — OpenRouter key (REAL), routing profile + task→model
 *                          table (free REAL / balanced+frontier PLANNED),
 *                          per-task overrides (PLANNED), temperature (REAL),
 *                          run-location toggle (browser REAL / cloud PLANNED).
 *   §02 DATA SOURCES     — CelesTrak (REAL default feed), Space-Track / N2YO /
 *                          SatNOGS (PLANNED proxy), custom TLE URL (REAL),
 *                          TLE upload (REAL parse+count), ephemeris (PLANNED).
 *   §03 CONNECTED BACKEND— URL + API key + mode toggle (REAL), test connection
 *                          against a live /v1 backend (REAL). Off by default.
 *   §04 COMPUTE & PERF   — render cap, particle density, effect toggles,
 *                          reduced-motion override — all REAL, stored; cockpit
 *                          /dashboard will read these (TODO in those files).
 *   §05 OPERATIONS       — Pc threshold, screening window, escalation,
 *                          notifications — all PLANNED (CDM-triage roadmap).
 *   §06 AUDIT & DATA     — export chain (REAL), verify chain (REAL), clear
 *                          local caches (REAL), retention note.
 *   §07 ACCOUNT & TEAM   — login / org / RBAC / SSO — CLOUD · PLANNED.
 *   §08 ABOUT            — version, MIT, docs/github links, mode indicator.
 *
 * localStorage keys this page owns (all namespaced `orbitops:`):
 *   orbitops:openrouter_key           — via setStoredKey (openrouter-client.js)
 *   orbitops:settings:aiProfile       — 'free' | 'balanced' | 'frontier'
 *   orbitops:settings:aiTemperature   — number 0..1 (string)
 *   orbitops:settings:agentRunLocation— 'browser' (cloud is inert/PLANNED)
 *   orbitops:settings:sources         — JSON { celestrak:bool, customTleUrl:str }
 *   orbitops:tle:custom               — JSON { t, text } uploaded TLE (REAL)
 *   orbitops:backend:url              — connected-mode backend origin (REAL)
 *   orbitops:backend:key              — connected-mode API key (REAL, local only)
 *   orbitops:backend:mode             — 'simulated' | 'connected' (REAL)
 *   orbitops:settings:renderCap       — 800 | 2200 | 5000
 *   orbitops:settings:particleDensity — number 0..1 (string)
 *   orbitops:settings:fxAmbient       — '1' | '0'
 *   orbitops:settings:fxGrain         — '1' | '0'
 *   orbitops:settings:fxScanlines     — '1' | '0'
 *   orbitops:settings:reducedMotion   — 'system' | 'on' | 'off'
 *
 * @module pages/settings
 */

'use strict';

import { mountAmbient } from '../ui/ambient.js';
import {
  getStoredKey,
  setStoredKey,
  hasLiveAI,
} from '../core/openrouter-client.js';
import { PROVIDERS, getLlmConfig, setLlmConfig } from '../core/llm-provider.js';
import { MODEL_ROUTING, modelsFor } from '../core/model-routing.js';
import { audit } from '../core/audit-log.js';
import { isAppMode } from '../core/app-config.js';
import {
  getBackendConfig,
  setBackendConfig,
  BackendClient,
  DEFAULT_BACKEND_URL,
} from '../core/backend-client.js';
import { esc } from '../utils.js';

/* ============================================================
   Persistence helpers — namespaced, storage-safe (never throw)
   ============================================================ */

const K = {
  aiProfile: 'orbitops:settings:aiProfile',
  aiTemperature: 'orbitops:settings:aiTemperature',
  agentRunLocation: 'orbitops:settings:agentRunLocation',
  sources: 'orbitops:settings:sources',
  customTle: 'orbitops:tle:custom',
  renderCap: 'orbitops:settings:renderCap',
  particleDensity: 'orbitops:settings:particleDensity',
  fxAmbient: 'orbitops:settings:fxAmbient',
  fxGrain: 'orbitops:settings:fxGrain',
  fxScanlines: 'orbitops:settings:fxScanlines',
  reducedMotion: 'orbitops:settings:reducedMotion',
};

const DEFAULTS = {
  aiProfile: 'free',
  aiTemperature: '0.4',
  agentRunLocation: 'browser',
  renderCap: '2200',
  particleDensity: '0.5',
  fxAmbient: '1',
  fxGrain: '1',
  fxScanlines: '0',
  reducedMotion: 'system',
};

/**
 * @param {string} key
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
function getLS(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {string|number|null|undefined} value
 */
function setLS(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

function getSources() {
  try {
    const raw = getLS(K.sources);
    if (!raw) return { celestrak: true, customTleUrl: '' };
    const parsed = JSON.parse(raw);
    return {
      celestrak: parsed.celestrak !== false,
      customTleUrl: typeof parsed.customTleUrl === 'string' ? parsed.customTleUrl : '',
    };
  } catch {
    return { celestrak: true, customTleUrl: '' };
  }
}

/** @param {{ celestrak?: boolean, customTleUrl?: string }} patch */
function setSources(patch) {
  const next = { ...getSources(), ...patch };
  setLS(K.sources, JSON.stringify(next));
  return next;
}

/* Small utilities ------------------------------------------------------- */

/**
 * REAL / PLANNED / CLOUD honest chip.
 * @param {string} kind
 */
function chip(kind) {
  /** @type {Record<string, string[]>} */
  const map = {
    real: ['REAL', 'today'],
    planned: ['PLANNED', 'backend'],
    cloud: ['CLOUD', 'future'],
  };
  const [label] = map[kind] || map.planned;
  return `<span class="set-chip set-chip--${kind}">${label}</span>`;
}

/**
 * A right-aligned status readout inside a row.
 * @param {string} kind
 * @param {string} text
 */
function statusDot(kind, text) {
  return `<span class="set-status set-status--${kind}"><span class="set-status__dot"></span>${esc(text)}</span>`;
}

/* ============================================================
   Section index (left rail anchors)
   ============================================================ */

const SECTIONS = [
  { id: 'ai', idx: '01', label: 'AI & Agents' },
  { id: 'sources', idx: '02', label: 'Data Sources' },
  { id: 'backend', idx: '03', label: 'Connected Backend' },
  { id: 'compute', idx: '04', label: 'Compute & Performance' },
  { id: 'ops', idx: '05', label: 'Operations' },
  { id: 'audit', idx: '06', label: 'Audit & Data' },
  { id: 'account', idx: '07', label: 'Account & Team' },
  { id: 'about', idx: '08', label: 'About' },
];

/* ============================================================
   MOUNT
   ============================================================ */

/** @param {HTMLElement} app */
export async function mount(app) {
  injectSettingsV3();
  app.innerHTML = shellHTML();

  const root = /** @type {HTMLElement} */ (app.querySelector('.settings-page'));
  const ambient = mountAmbient(root, { object: 'station', density: 0.5 });

  // Effect toggles that this page can honor for itself immediately: grain +
  // scanlines classes on the page root. (Ambient stays on so the surface is
  // never dead; its own reduced-motion guard handles motion.)
  applyPageEffects(root);

  /** @type {Array<(() => void)|undefined>} */
  const cleanups = [];
  cleanups.push(wireSectionRail(root));
  cleanups.push(wireAiSection(root));
  cleanups.push(wireSourcesSection(root));
  cleanups.push(wireBackendSection(root));
  cleanups.push(wireComputeSection(root));
  cleanups.push(wireAuditSection(root));
  cleanups.push(wireAboutSection(root));

  return {
    unmount() {
      cleanups.forEach((fn) => {
        try {
          fn && fn();
        } catch (e) {
          console.warn('settings cleanup error', e);
        }
      });
      ambient.unmount();
    },
  };
}

/** @param {HTMLElement} root */
function applyPageEffects(root) {
  root.classList.toggle('chrome-grain', getLS(K.fxGrain, DEFAULTS.fxGrain) === '1');
  root.classList.toggle('set-scanlines', getLS(K.fxScanlines, DEFAULTS.fxScanlines) === '1');
}

/* ============================================================
   SHELL
   ============================================================ */

function shellHTML() {
  return `
    <main class="settings-page">
      <nav class="side-nav" id="sideNav">${sideNavHTML('settings')}</nav>

      <header class="set-header">
        <div class="set-header__wrap">
          <span class="set-eyebrow">OPERATOR CONSOLE · SELF-HOST · BYOK</span>
          <h1 class="set-title">Settings</h1>
          <p class="set-lead">
            Everything here that can run without a server runs now and is stored in
            this browser only &mdash; keys, compute caps, your own feeds. Anything
            that needs a backend is designed in full and clearly marked
            ${chip('planned')}. No data leaves your machine except calls you
            explicitly configure (OpenRouter, your own APIs).
          </p>
          <div class="set-header__legend">
            ${chip('real')}<span class="set-legend__t">works today, stored locally</span>
            ${chip('planned')}<span class="set-legend__t">designed, backend pending</span>
            ${chip('cloud')}<span class="set-legend__t">hosted OrbitOps, future</span>
          </div>
        </div>
      </header>

      <div class="set-body">
        <aside class="set-rail" aria-label="Settings sections">
          <ul class="set-rail__list">
            ${SECTIONS.map(
              (s) => `<li>
                <a class="set-rail__link" href="#/settings" data-anchor="${s.id}">
                  <span class="set-rail__idx">§${s.idx}</span>
                  <span class="set-rail__label">${s.label}</span>
                </a>
              </li>`,
            ).join('')}
          </ul>
          <div class="set-rail__mode">
            <span class="set-rail__mode-k">MODE</span>
            <span class="set-rail__mode-v" id="setModeIndicator">${isAppMode() ? 'APP' : 'SITE'}</span>
          </div>
        </aside>

        <div class="set-content">
          ${sectionAI()}
          ${sectionSources()}
          ${sectionBackend()}
          ${sectionCompute()}
          ${sectionOps()}
          ${sectionAudit()}
          ${sectionAccount()}
          ${sectionAbout()}
        </div>
      </div>
    </main>
  `;
}

/**
 * Generic glass section wrapper with corner ticks + mono index.
 * @param {string} id
 * @param {string} idx
 * @param {string} title
 * @param {string} chips
 * @param {string} bodyHTML
 */
function panel(id, idx, title, chips, bodyHTML) {
  return `
    <section class="set-panel" id="set-${id}" data-anchor-target="${id}">
      <div class="set-panel__head">
        <span class="set-panel__idx">§${idx}</span>
        <h2 class="set-panel__title">${title}</h2>
        <span class="set-panel__chips">${chips}</span>
      </div>
      <div class="set-panel__body">${bodyHTML}</div>
    </section>
  `;
}

/**
 * A labelled control row: label + help on the left, control on the right.
 * @param {string} label
 * @param {string} help
 * @param {string} controlHTML
 * @param {{ chip?: string, disabled?: boolean }} [opts]
 */
function row(label, help, controlHTML, { chip: rowChip = '', disabled = false } = {}) {
  return `
    <div class="set-row ${disabled ? 'is-disabled' : ''}">
      <div class="set-row__meta">
        <span class="set-row__label">${label} ${rowChip}</span>
        ${help ? `<span class="set-row__help">${help}</span>` : ''}
      </div>
      <div class="set-row__control">${controlHTML}</div>
    </div>
  `;
}

/* ============================================================
   §01 · AI & AGENTS
   ============================================================ */

function sectionAI() {
  const profile = getLS(K.aiProfile, DEFAULTS.aiProfile);
  const temp = getLS(K.aiTemperature, DEFAULTS.aiTemperature);
  const runLoc = getLS(K.agentRunLocation, DEFAULTS.agentRunLocation);
  const live = hasLiveAI();
  const llm = getLlmConfig();

  const providerField = `
    <div class="set-key">
      <div class="set-inline">
        <select id="aiProvider" class="set-select" aria-label="LLM provider">
          ${PROVIDERS.map(
            (p) => `<option value="${p.id}" ${p.id === llm.providerId ? 'selected' : ''}>${esc(p.label)}</option>`,
          ).join('')}
        </select>
        <span id="aiProviderHint" class="set-hint">${esc(llm.preset.note)}</span>
      </div>
      <div class="set-inline" id="aiBaseUrlWrap" style="${llm.preset.custom ? '' : 'display:none'}">
        <input type="text" id="aiBaseUrl" class="set-input set-input--mono"
          placeholder="https://your-endpoint/v1" autocomplete="off" spellcheck="false"
          value="${esc(llm.preset.custom ? llm.baseUrl : '')}" aria-label="Custom base URL" />
        <span class="set-hint">Only point this at an endpoint you trust — your API key is sent here.</span>
      </div>
      <div class="set-inline">
        <input type="text" id="aiModel" class="set-input set-input--mono"
          placeholder="${esc(llm.preset.modelHint || 'model id')}" autocomplete="off" spellcheck="false"
          value="${esc(llm.model)}" aria-label="Model id" />
        <button type="button" class="set-btn" id="aiProviderSave">Save</button>
        <span id="aiProviderStatus"></span>
      </div>
    </div>
  `;

  const keyField = `
    <div class="set-key">
      <div class="set-key__inputwrap">
        <input type="password" id="aiKey" class="set-input set-input--mono"
          placeholder="your API key" autocomplete="off" spellcheck="false"
          value="${esc(getStoredKey() || '')}" aria-label="Provider API key" />
        <button type="button" class="set-ghost-btn" id="aiKeyToggle"
          aria-pressed="false" aria-label="Show API key">SHOW</button>
      </div>
      <div class="set-key__actions">
        <button type="button" class="set-btn set-btn--primary" id="aiKeySave">Save key</button>
        <button type="button" class="set-btn" id="aiKeyClear">Clear</button>
        <span id="aiKeyStatus">${
          live
            ? statusDot('ok', 'LIVE · key stored in this browser')
            : statusDot('mute', 'NO KEY · deterministic fallback')
        }</span>
      </div>
      <p class="set-note">
        The key is stored only in this browser's localStorage and sent only to the
        provider endpoint you set above. It is never committed, proxied, or logged.
      </p>
    </div>
  `;

  const profileSelect = `
    <div class="set-inline">
      <select id="aiProfile" class="set-select" aria-label="Model routing profile">
        <option value="free" ${profile === 'free' ? 'selected' : ''}>free — verified free models (works now)</option>
        <option value="balanced" ${profile === 'balanced' ? 'selected' : ''}>balanced — operator-supplied (empty)</option>
        <option value="frontier" ${profile === 'frontier' ? 'selected' : ''}>frontier — operator-supplied (empty)</option>
      </select>
      <span id="aiProfileHint" class="set-hint">${profileHint(/** @type {string} */ (profile))}</span>
    </div>
  `;

  return panel(
    'ai',
    '01',
    'AI &amp; Agents',
    `${chip('real')}${chip('planned')}`,
    `
    ${row(
      'LLM provider',
      'Route the optional live AI through any OpenAI-compatible endpoint — OpenRouter, OpenAI, xAI (Grok), Groq, or your own (self-hosted vLLM/Ollama, an Azure gateway, or a LiteLLM proxy fronting Anthropic/Bedrock). Not locked to any vendor.',
      providerField,
      { chip: chip('real') },
    )}

    ${row(
      'Provider API key',
      'Bring your own key. On OpenRouter, free-tier models run the public demo at zero cost.',
      keyField,
      { chip: chip('real') },
    )}

    ${row(
      'Model routing profile',
      'Selects which fallback chain each agent task uses. <code>balanced</code> and <code>frontier</code> are yours to fill in <code>core/model-routing.js</code> — we do not invent paid model IDs.',
      profileSelect,
      { chip: chip('real') },
    )}

    ${row(
      'Task → model mapping',
      'Read-only view of the resolved chain for the selected profile. Empty operator profiles fall back to the free chain at lookup time.',
      `<div class="set-modeltable" id="aiModelTable">${modelTableHTML(/** @type {string} */ (profile))}</div>`,
    )}

    ${row(
      'Per-task model override',
      'Pin a specific model per task, overriding the profile. Needs the agent runner to read overrides — designed, not wired.',
      `<div class="set-overrides">
        ${['analyst', 'strategist', 'safety']
          .map(
            (t) => `<label class="set-override">
              <span class="set-override__task">${t}</span>
              <input type="text" class="set-input set-input--mono" placeholder="provider/model-id" disabled />
            </label>`,
          )
          .join('')}
      </div>`,
      { chip: chip('planned'), disabled: true },
    )}

    ${row(
      'Agent temperature',
      'Sampling temperature passed to every agent call. Lower = more deterministic reasoning.',
      `<div class="set-slider">
        <input type="range" id="aiTemp" min="0" max="1" step="0.05" value="${esc(temp)}"
          class="set-range" aria-label="Agent temperature" />
        <output id="aiTempOut" class="set-slider__out">${Number(temp).toFixed(2)}</output>
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Run agents',
      'Browser BYOK runs calls straight from this tab to OpenRouter — no server. Cloud execution (queued, rate-managed, server-side keys) is a hosted feature.',
      `<div class="set-segment" role="group" aria-label="Agent run location">
        <button type="button" class="set-seg ${runLoc === 'browser' ? 'is-active' : ''}" data-runloc="browser">Browser · BYOK</button>
        <button type="button" class="set-seg is-planned" data-runloc="cloud" disabled>Cloud ${chip('planned')}</button>
      </div>`,
      { chip: chip('real') },
    )}
  `,
  );
}

/** @param {string} profile */
function profileHint(profile) {
  if (profile === 'free') return 'Zero-cost verified free models. Ready now.';
  const filled = ['analyst', 'strategist', 'safety'].some(
    (t) => (MODEL_ROUTING[profile]?.[t] || []).length > 0,
  );
  return filled
    ? 'Operator models detected for this profile.'
    : 'Empty — operator-supplied, PLANNED. Falls back to the free chain until you fill it.';
}

/** @param {string} profile */
function modelTableHTML(profile) {
  const tasks = [
    ['analyst', 'high-volume interpretation'],
    ['strategist', 'tradeoff reasoning'],
    ['safety', 'adversarial second opinion'],
  ];
  const rows = tasks
    .map(([task, desc]) => {
      const own = (MODEL_ROUTING[profile]?.[task] || []).length > 0;
      const chain = modelsFor(
        /** @type {'analyst'|'bulk'|'strategist'|'reasoning'|'safety'} */ (task),
        /** @type {'free'|'balanced'|'frontier'} */ (profile),
      );
      const badge = own
        ? '<span class="set-mt__badge">operator</span>'
        : profile === 'free'
          ? '<span class="set-mt__badge set-mt__badge--free">free</span>'
          : '<span class="set-mt__badge set-mt__badge--fallback">→ free</span>';
      return `<div class="set-mt__row">
        <div class="set-mt__task"><span class="set-mt__name">${task}</span><span class="set-mt__desc">${desc}</span></div>
        <div class="set-mt__models">
          ${chain.map((m, i) => `<code class="set-mt__model ${i === 0 ? 'is-primary' : ''}">${esc(m)}</code>`).join('')}
          ${badge}
        </div>
      </div>`;
    })
    .join('');
  return `<div class="set-mt">${rows}</div>`;
}

/** @param {HTMLElement} root */
function wireAiSection(root) {
  const keyInput = /** @type {HTMLInputElement} */ (root.querySelector('#aiKey'));
  const toggle = /** @type {HTMLElement} */ (root.querySelector('#aiKeyToggle'));
  const save = root.querySelector('#aiKeySave');
  const clear = root.querySelector('#aiKeyClear');
  const status = /** @type {HTMLElement} */ (root.querySelector('#aiKeyStatus'));
  const profile = /** @type {HTMLSelectElement} */ (root.querySelector('#aiProfile'));
  const profileHintEl = root.querySelector('#aiProfileHint');
  const table = root.querySelector('#aiModelTable');
  const temp = /** @type {HTMLInputElement} */ (root.querySelector('#aiTemp'));
  const tempOut = /** @type {HTMLElement} */ (root.querySelector('#aiTempOut'));
  const segBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (root.querySelectorAll('.set-segment .set-seg'));

  /** @type {Array<() => void>} */
  const listeners = [];
  /**
   * @param {EventTarget|null} el
   * @param {string} ev
   * @param {EventListener} fn
   */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  const refreshStatus = () => {
    status.innerHTML = hasLiveAI()
      ? statusDot('ok', 'LIVE · key stored in this browser')
      : statusDot('mute', 'NO KEY · deterministic fallback');
  };

  // Provider selection — switch the LLM endpoint without touching any vendor lock.
  const provider = /** @type {HTMLSelectElement|null} */ (root.querySelector('#aiProvider'));
  const providerHint = /** @type {HTMLElement|null} */ (root.querySelector('#aiProviderHint'));
  const baseUrlWrap = /** @type {HTMLElement|null} */ (root.querySelector('#aiBaseUrlWrap'));
  const baseUrl = /** @type {HTMLInputElement|null} */ (root.querySelector('#aiBaseUrl'));
  const model = /** @type {HTMLInputElement|null} */ (root.querySelector('#aiModel'));
  const providerSave = root.querySelector('#aiProviderSave');
  const providerStatus = /** @type {HTMLElement|null} */ (root.querySelector('#aiProviderStatus'));

  on(provider, 'change', () => {
    if (!provider) return;
    setLlmConfig({ providerId: provider.value });
    const cfg = getLlmConfig();
    if (providerHint) providerHint.textContent = cfg.preset.note;
    // Note: rely on inline display, not the `hidden` attribute — `.set-inline`
    // forces display:flex and would override [hidden].
    if (baseUrlWrap) baseUrlWrap.style.display = cfg.preset.custom ? '' : 'none';
    if (baseUrl) baseUrl.value = cfg.preset.custom ? cfg.baseUrl : '';
    if (model) model.placeholder = cfg.preset.modelHint || 'model id';
    // The API key is provider-scoped — show the key stored for this provider.
    keyInput.value = getStoredKey() || '';
    refreshStatus();
  });

  on(providerSave, 'click', () => {
    setLlmConfig({ baseUrl: baseUrl ? baseUrl.value : '', model: model ? model.value : '' });
    if (providerStatus) providerStatus.innerHTML = statusDot('ok', 'endpoint saved');
  });

  on(toggle, 'click', () => {
    const showing = keyInput.type === 'text';
    keyInput.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? 'SHOW' : 'HIDE';
    toggle.setAttribute('aria-pressed', String(!showing));
  });

  on(save, 'click', () => {
    setStoredKey(keyInput.value.trim());
    refreshStatus();
    flash(save, 'Saved ✓');
  });

  on(clear, 'click', () => {
    setStoredKey('');
    keyInput.value = '';
    refreshStatus();
    flash(clear, 'Cleared');
  });

  on(profile, 'change', () => {
    const p = profile.value;
    setLS(K.aiProfile, p);
    if (profileHintEl) profileHintEl.textContent = profileHint(p);
    if (table) table.innerHTML = modelTableHTML(p);
  });

  on(temp, 'input', () => {
    tempOut.textContent = Number(temp.value).toFixed(2);
  });
  on(temp, 'change', () => setLS(K.aiTemperature, temp.value));

  segBtns.forEach((btn) => {
    on(btn, 'click', () => {
      if (btn.disabled) return;
      segBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      setLS(K.agentRunLocation, btn.dataset.runloc);
    });
  });

  return () => listeners.forEach((fn) => fn());
}

/* ============================================================
   §02 · DATA SOURCES
   ============================================================ */

function sectionSources() {
  const src = getSources();
  const customTle = readCustomTle();

  /**
   * @param {string} name
   * @param {string} chipKind
   * @param {string} statusHTML
   * @param {string} controlHTML
   * @param {string} help
   */
  const feed = (name, chipKind, statusHTML, controlHTML, help) => `
    <div class="set-feed">
      <div class="set-feed__meta">
        <span class="set-feed__name">${name} ${chip(chipKind)}</span>
        <span class="set-feed__help">${help}</span>
      </div>
      <div class="set-feed__control">${statusHTML}${controlHTML}</div>
    </div>
  `;

  return panel(
    'sources',
    '02',
    'Data Sources',
    `${chip('real')}${chip('planned')}`,
    `
    <p class="set-note set-note--lead">
      Your own APIs override the bundled open feeds. Disable CelesTrak and point
      OrbitOps at your Space-Track proxy, an N2YO key, or your own TLE URL/upload
      and the app uses yours instead. Keyless sources work now; keyed sources
      that require a CORS-safe server proxy are designed and marked PLANNED.
    </p>

    ${feed(
      'CelesTrak',
      'real',
      `<label class="set-switch"><input type="checkbox" id="srcCelestrak" ${src.celestrak ? 'checked' : ''}><span class="set-switch__track"></span></label>`,
      '',
      'The default open feed — real catalogued TLEs, CORS-enabled, no key, ~2h cadence. Toggle off to rely on your own source.',
    )}

    ${feed(
      'Space-Track.org',
      'planned',
      statusDot('mute', 'NEEDS PROXY'),
      `<div class="set-creds">
        <input type="text" class="set-input" placeholder="identity" disabled aria-label="Space-Track identity" />
        <input type="password" class="set-input" placeholder="password" disabled aria-label="Space-Track password" />
      </div>`,
      'Full public catalog incl. debris. Requires a server-side proxy (no browser CORS, ToS-bound auth). Designed; backend pending.',
    )}

    ${feed(
      'N2YO',
      'planned',
      statusDot('mute', 'NEEDS PROXY'),
      `<input type="text" class="set-input set-input--mono" placeholder="N2YO API key" disabled aria-label="N2YO API key" />`,
      'Radio-pass and visual-pass data by key. Needs a proxy to keep the key off the client and satisfy CORS. Designed; backend pending.',
    )}

    ${feed(
      'SatNOGS',
      'planned',
      statusDot('mute', 'NEEDS BACKEND'),
      `<button type="button" class="set-btn" disabled>Connect network</button>`,
      'Community ground-station telemetry & observations. Ingest + normalisation is a backend job. Designed; pending.',
    )}

    ${feed(
      'Custom TLE URL',
      'real',
      '<span id="srcCustomUrlStatus">' +
        (src.customTleUrl ? statusDot('ok', 'STORED') : statusDot('mute', 'NONE')) +
        '</span>',
      `<div class="set-inline">
        <input type="url" id="srcCustomUrl" class="set-input set-input--mono"
          placeholder="https://…/elements.tle" value="${esc(src.customTleUrl)}"
          aria-label="Custom TLE URL" spellcheck="false" />
        <button type="button" class="set-btn set-btn--primary" id="srcCustomUrlSave">Save</button>
        <button type="button" class="set-btn" id="srcCustomUrlClear">Clear</button>
      </div>`,
      'Point at any URL that returns 3-line TLE text (your GS software, an internal mirror). Stored now; the loader reads it once wired in.',
    )}

    ${feed(
      'Upload TLE / ephemeris',
      'real',
      `<span id="srcUploadStatus">${
        customTle
          ? statusDot('ok', `${customTle.count} objects · ${ageLabel(customTle.t)}`)
          : statusDot('mute', 'NO FILE')
      }</span>`,
      `<div class="set-inline">
        <label class="set-file">
          <input type="file" id="srcTleFile" accept=".tle,.txt,.3le" aria-label="Upload TLE file" />
          <span class="set-file__btn">Choose TLE file…</span>
        </label>
        <button type="button" class="set-btn" id="srcTleClear" ${customTle ? '' : 'disabled'}>Remove</button>
      </div>
      <p class="set-note">TLE / 3LE parses and stores here now (${chip('real')}). Ephemeris formats (OEM/SP3) parse ${chip('planned')} — a validated parser lands with the backend.</p>`,
      'Drop in your own element set. We parse and count objects client-side to confirm it, then store it in this browser.',
    )}
  `,
  );
}

/** Read the uploaded custom TLE store, returning {t,count} or null. */
function readCustomTle() {
  try {
    const raw = getLS(K.customTle);
    if (!raw) return null;
    const { t, text } = JSON.parse(raw);
    if (!text) return null;
    return { t, count: countTle(text) };
  } catch {
    return null;
  }
}

/**
 * Count TLE objects in raw text (lines beginning "1 " = line-1 of a set).
 * @param {unknown} text
 */
function countTle(text) {
  let n = 0;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('1 ')) n++;
  }
  return n;
}

/** @param {number} t */
function ageLabel(t) {
  if (!Number.isFinite(t)) return 'stored';
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** @param {HTMLElement} root */
function wireSourcesSection(root) {
  const celestrak = /** @type {HTMLInputElement} */ (root.querySelector('#srcCelestrak'));
  const urlInput = /** @type {HTMLInputElement} */ (root.querySelector('#srcCustomUrl'));
  const urlSave = root.querySelector('#srcCustomUrlSave');
  const urlClear = root.querySelector('#srcCustomUrlClear');
  const urlStatus = /** @type {HTMLElement} */ (root.querySelector('#srcCustomUrlStatus'));
  const fileInput = /** @type {HTMLInputElement} */ (root.querySelector('#srcTleFile'));
  const fileClear = /** @type {HTMLButtonElement} */ (root.querySelector('#srcTleClear'));
  const uploadStatus = /** @type {HTMLElement} */ (root.querySelector('#srcUploadStatus'));

  /** @type {Array<() => void>} */
  const listeners = [];
  /**
   * @param {EventTarget|null} el
   * @param {string} ev
   * @param {EventListener} fn
   */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  on(celestrak, 'change', () => setSources({ celestrak: celestrak.checked }));

  on(urlSave, 'click', () => {
    const val = urlInput.value.trim();
    if (val && !/^https?:\/\//i.test(val)) {
      urlStatus.innerHTML = statusDot('warn', 'MUST BE http(s)://');
      return;
    }
    setSources({ customTleUrl: val });
    urlStatus.innerHTML = val ? statusDot('ok', 'STORED') : statusDot('mute', 'NONE');
    flash(urlSave, 'Saved ✓');
  });

  on(urlClear, 'click', () => {
    urlInput.value = '';
    setSources({ customTleUrl: '' });
    urlStatus.innerHTML = statusDot('mute', 'NONE');
  });

  on(fileInput, 'change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      uploadStatus.innerHTML = statusDot('warn', 'FILE TOO LARGE (>6MB)');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const count = countTle(text);
      if (count === 0) {
        uploadStatus.innerHTML = statusDot('warn', 'NO VALID TLE LINES FOUND');
        fileInput.value = '';
        return;
      }
      const ok = setLS(K.customTle, JSON.stringify({ t: Date.now(), text }));
      uploadStatus.innerHTML = ok
        ? statusDot('ok', `${count} objects · just now`)
        : statusDot('warn', 'STORAGE FULL — NOT SAVED');
      if (fileClear) fileClear.disabled = !ok;
    };
    reader.onerror = () => {
      uploadStatus.innerHTML = statusDot('warn', 'COULD NOT READ FILE');
    };
    reader.readAsText(file);
  });

  on(fileClear, 'click', () => {
    setLS(K.customTle, null);
    if (fileInput) fileInput.value = '';
    uploadStatus.innerHTML = statusDot('mute', 'NO FILE');
    fileClear.disabled = true;
  });

  return () => listeners.forEach((fn) => fn());
}

/* ============================================================
   §03 · CONNECTED BACKEND  (REAL — optional live /v1 API)
   ============================================================ */

function sectionBackend() {
  const cfg = getBackendConfig();
  const connected = cfg.mode === 'connected';

  const urlField = `
    <div class="set-inline">
      <input type="text" id="beUrl" class="set-input set-input--mono"
        placeholder="${esc(DEFAULT_BACKEND_URL)}" autocomplete="off" spellcheck="false"
        value="${esc(cfg.url)}" aria-label="Backend base URL" />
    </div>`;

  const keyField = `
    <div class="set-key">
      <div class="set-key__inputwrap">
        <input type="password" id="beKey" class="set-input set-input--mono"
          placeholder="operator API key" autocomplete="off" spellcheck="false"
          value="${esc(cfg.key)}" aria-label="Backend API key" />
        <button type="button" class="set-ghost-btn" id="beKeyToggle"
          aria-pressed="false" aria-label="Show API key">SHOW</button>
      </div>
    </div>`;

  const modeToggle = `
    <div class="set-inline">
      <select id="beMode" class="set-select" aria-label="Data source mode">
        <option value="simulated" ${connected ? '' : 'selected'}>Simulation — in-browser, deterministic (default)</option>
        <option value="connected" ${connected ? 'selected' : ''}>Connected — read the live backend</option>
      </select>
      <span id="beModeHint" class="set-hint">${
        connected
          ? 'Screens read live proposals, audit, and telemetry.'
          : 'Everything runs offline in this browser.'
      }</span>
    </div>`;

  return panel(
    'backend',
    '03',
    'Connected Backend',
    chip('real'),
    `
    <p class="set-note set-note--lead">
      By default OrbitOps runs entirely in your browser on a deterministic
      simulation &mdash; no server required. Point it at a running OrbitOps
      backend to switch the operator screens over to live data: the real triage
      queue, the tamper-evident audit chain, and streamed telemetry, all over the
      documented <code>/v1</code> API. This is additive; simulation stays the
      default until you explicitly connect.
    </p>

    ${row(
      'Backend URL',
      `Origin of your OrbitOps backend, e.g. <code>${esc(DEFAULT_BACKEND_URL)}</code> for a local dev server. A cross-origin backend must allow this page's origin via its <code>CORS_ORIGINS</code> env.`,
      urlField,
      { chip: chip('real') },
    )}

    ${row(
      'API key',
      'Sent as the <code>x-api-key</code> header on every call. Stored only in this browser and never placed in a URL.',
      keyField,
      { chip: chip('real') },
    )}

    ${row(
      'Data source',
      'Switch the operator screens between the offline simulation and the live backend.',
      modeToggle,
      { chip: chip('real') },
    )}

    ${row(
      'Connection',
      'Save your settings, then test reachability and authentication against the live backend before switching screens over.',
      `<div class="set-key__actions">
        <button type="button" class="set-btn set-btn--primary" id="beSave">Save</button>
        <button type="button" class="set-btn" id="beTest">Test connection</button>
        <span id="beStatus">${
          connected
            ? statusDot('ok', 'CONNECTED mode · not yet tested')
            : statusDot('mute', 'SIMULATION mode')
        }</span>
      </div>`,
      { chip: chip('real') },
    )}

    <p class="set-note">
      The key lives only in this browser's localStorage and is sent only to the
      backend URL you set here. No third party sees it. Switching to Connected
      takes effect on the operator screens after they next load.
    </p>
  `,
  );
}

/** @param {HTMLElement} root */
function wireBackendSection(root) {
  const urlInput = /** @type {HTMLInputElement|null} */ (root.querySelector('#beUrl'));
  const keyInput = /** @type {HTMLInputElement|null} */ (root.querySelector('#beKey'));
  const keyToggle = root.querySelector('#beKeyToggle');
  const modeSelect = /** @type {HTMLSelectElement|null} */ (root.querySelector('#beMode'));
  const modeHint = /** @type {HTMLElement|null} */ (root.querySelector('#beModeHint'));
  const saveBtn = root.querySelector('#beSave');
  const testBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#beTest'));
  const status = /** @type {HTMLElement} */ (root.querySelector('#beStatus'));

  /** @type {Array<() => void>} */
  const listeners = [];
  /**
   * @param {EventTarget|null} el @param {string} ev @param {EventListener} fn
   */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  on(keyToggle, 'click', () => {
    if (!keyInput || !keyToggle) return;
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    keyToggle.setAttribute('aria-pressed', String(show));
    keyToggle.textContent = show ? 'HIDE' : 'SHOW';
  });

  on(modeSelect, 'change', () => {
    if (!modeHint || !modeSelect) return;
    modeHint.textContent =
      modeSelect.value === 'connected'
        ? 'Screens read live proposals, audit, and telemetry.'
        : 'Everything runs offline in this browser.';
  });

  const persist = () => {
    const url = urlInput ? urlInput.value.trim() : '';
    const key = keyInput ? keyInput.value.trim() : '';
    const mode = /** @type {'simulated'|'connected'} */ (modeSelect ? modeSelect.value : 'simulated');
    setBackendConfig({ url, key, mode });
    return { url, key, mode };
  };

  on(saveBtn, 'click', () => {
    const { url, key, mode } = persist();
    if (mode === 'connected' && (!url || !key)) {
      // Connected requested but incomplete — isConnected() needs both, so the
      // app stays in simulation. Don't show a falsely-confident green dot.
      status.innerHTML = statusDot('warn', 'saved · CONNECTED needs a URL and key — simulation still active');
    } else if (mode === 'connected') {
      status.innerHTML = statusDot('ok', 'saved · CONNECTED — test the connection');
    } else {
      status.innerHTML = statusDot('mute', 'saved · SIMULATION mode');
    }
  });

  on(testBtn, 'click', async () => {
    const { url, key } = persist();
    if (!url || !key) {
      status.innerHTML = statusDot('warn', 'set a URL and an API key first');
      return;
    }
    status.innerHTML = statusDot('mute', 'testing…');
    if (testBtn) testBtn.disabled = true;
    try {
      const client = new BackendClient({ url, key, mode: 'connected' });
      // 1) Reachability (no auth). 2) Auth + a real read.
      const health = await client.health();
      if (!health || health.status !== 'ok') {
        status.innerHTML = statusDot('warn', 'reachable but not healthy');
        return;
      }
      const list = await client.listProposals({ limit: 1 });
      const n = Array.isArray(list.proposals) ? list.proposals.length : 0;
      status.innerHTML = statusDot('ok', `connected · authenticated · queue reachable (${n} shown)`);
    } catch (e) {
      const err = /** @type {{status?: number, message?: string}} */ (e);
      const msg =
        err.status === 401 || err.status === 403
          ? 'reached backend but API key was rejected'
          : err.status === 0
            ? 'unreachable (check URL, CORS, and that the backend is running)'
            : err.message || 'connection failed';
      status.innerHTML = statusDot('alert', msg);
    } finally {
      if (testBtn) testBtn.disabled = false;
    }
  });

  return () => listeners.forEach((fn) => fn());
}

/* ============================================================
   §04 · COMPUTE & PERFORMANCE
   ============================================================ */

function sectionCompute() {
  const cap = getLS(K.renderCap, DEFAULTS.renderCap);
  const density = getLS(K.particleDensity, DEFAULTS.particleDensity);
  const rm = getLS(K.reducedMotion, DEFAULTS.reducedMotion);

  /**
   * @param {string} v
   * @param {string} label
   * @param {string} note
   */
  const capBtn = (v, label, note) =>
    `<button type="button" class="set-cap ${cap === v ? 'is-active' : ''}" data-cap="${v}">
      <span class="set-cap__n">${label}</span><span class="set-cap__note">${note}</span>
    </button>`;

  /**
   * @param {string} id
   * @param {string} key
   * @param {string} label
   * @param {string} help
   */
  const fxRow = (id, key, label, help) => {
    const on = getLS(key, /** @type {Record<string, string>} */ (DEFAULTS)[keyName(key)]) === '1';
    return `<label class="set-fx">
      <span class="set-fx__meta"><span class="set-fx__label">${label}</span><span class="set-fx__help">${help}</span></span>
      <span class="set-switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="set-switch__track"></span></span>
    </label>`;
  };

  return panel(
    'compute',
    '04',
    'Compute &amp; Performance',
    chip('real'),
    `
    <p class="set-note set-note--lead">
      Stored to this browser and read by the cockpit &amp; dashboard renderers.
      Lower caps keep old hardware smooth; higher caps show more of the real
      catalogue. Changes apply next time a render view mounts.
    </p>

    ${row(
      'Render cap',
      'Maximum satellites propagated &amp; drawn at once. The real catalogue total is still reported as "N of M shown".',
      `<div class="set-capgrid" id="setCapGrid">
        ${capBtn('800', '800', 'Light · old GPUs')}
        ${capBtn('2200', '2,200', 'Balanced · default')}
        ${capBtn('5000', '5,000', 'Heavy · discrete GPU')}
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Particle density',
      'Ambient starfield / particle multiplier across pages. 0 disables particles entirely.',
      `<div class="set-slider">
        <input type="range" id="setDensity" min="0" max="1" step="0.1" value="${esc(density)}" class="set-range" aria-label="Particle density" />
        <output id="setDensityOut" class="set-slider__out">${Number(density).toFixed(1)}×</output>
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Effects',
      'Toggle the atmospheric layers. Turning these off is the fastest way to reclaim frames on low-power machines.',
      `<div class="set-fxlist">
        ${fxRow('fxAmbient', K.fxAmbient, 'Ambient scene', 'drifting starfield + vector object')}
        ${fxRow('fxGrain', K.fxGrain, 'Film grain', 'subtle sensor-noise overlay')}
        ${fxRow('fxScanlines', K.fxScanlines, 'Scanlines', 'CRT instrument texture')}
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Reduced motion',
      'Override the OS preference. "System" honors <code>prefers-reduced-motion</code>; force on/off for this browser.',
      `<div class="set-segment" role="group" aria-label="Reduced motion override">
        ${['system', 'off', 'on']
          .map(
            (v) =>
              `<button type="button" class="set-seg ${rm === v ? 'is-active' : ''}" data-rm="${v}">${v === 'system' ? 'System' : v === 'on' ? 'Force on' : 'Force off'}</button>`,
          )
          .join('')}
      </div>`,
      { chip: chip('real') },
    )}

    <p class="set-note">
      FPS note: on integrated graphics, 800 objects + effects off holds 60fps;
      5,000 objects is for discrete GPUs. These caps are advisory to the
      renderers &mdash; they read <code>orbitops:settings:*</code> on mount.
    </p>
  `,
  );
}

/**
 * Map a full LS key back to its DEFAULTS field name (fxAmbient etc.).
 * @param {string} fullKey
 * @returns {string}
 */
function keyName(fullKey) {
  return fullKey.split(':').pop() || '';
}

/** @param {HTMLElement} root */
function wireComputeSection(root) {
  const capGrid = root.querySelector('#setCapGrid');
  const density = /** @type {HTMLInputElement} */ (root.querySelector('#setDensity'));
  const densityOut = /** @type {HTMLElement} */ (root.querySelector('#setDensityOut'));
  const fxAmbient = /** @type {HTMLInputElement} */ (root.querySelector('#fxAmbient'));
  const fxGrain = /** @type {HTMLInputElement} */ (root.querySelector('#fxGrain'));
  const fxScanlines = /** @type {HTMLInputElement} */ (root.querySelector('#fxScanlines'));
  const rmBtns = /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-rm]'));
  const page = root; // .settings-page

  /** @type {Array<() => void>} */
  const listeners = [];
  /**
   * @param {EventTarget|null} el
   * @param {string} ev
   * @param {EventListener} fn
   */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  if (capGrid) {
    const caps = /** @type {NodeListOf<HTMLElement>} */ (capGrid.querySelectorAll('.set-cap'));
    caps.forEach((btn) =>
      on(btn, 'click', () => {
        caps.forEach((b) => b.classList.toggle('is-active', b === btn));
        setLS(K.renderCap, btn.dataset.cap);
      }),
    );
  }

  on(density, 'input', () => {
    densityOut.textContent = `${Number(density.value).toFixed(1)}×`;
  });
  on(density, 'change', () => setLS(K.particleDensity, density.value));

  // Effect toggles apply to THIS page immediately where they can (grain,
  // scanlines); ambient is a page-render setting other views read on mount.
  on(fxAmbient, 'change', () => setLS(K.fxAmbient, fxAmbient.checked ? '1' : '0'));
  on(fxGrain, 'change', () => {
    setLS(K.fxGrain, fxGrain.checked ? '1' : '0');
    page.classList.toggle('chrome-grain', fxGrain.checked);
  });
  on(fxScanlines, 'change', () => {
    setLS(K.fxScanlines, fxScanlines.checked ? '1' : '0');
    page.classList.toggle('set-scanlines', fxScanlines.checked);
  });

  rmBtns.forEach((btn) =>
    on(btn, 'click', () => {
      rmBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      setLS(K.reducedMotion, btn.dataset.rm);
    }),
  );

  return () => listeners.forEach((fn) => fn());
}

/* ============================================================
   §05 · OPERATIONS  (all PLANNED — CDM-triage roadmap)
   ============================================================ */

function sectionOps() {
  /**
   * @param {string} label
   * @param {string} help
   * @param {string} controlHTML
   */
  const disabledRow = (label, help, controlHTML) =>
    row(label, help, controlHTML, { chip: chip('planned'), disabled: true });

  return panel(
    'ops',
    '05',
    'Operations',
    chip('planned'),
    `
    <p class="set-note set-note--lead">
      Conjunction triage, screening, and on-call policy need the SSA ingest +
      alerting backend from the roadmap (CDM triage). These rows are the real
      operator design; inputs are disabled until that backend lands &mdash; no
      fake thresholds, no fake alerts.
    </p>

    ${disabledRow(
      'Collision probability (Pc) threshold',
      'Auto-escalate a conjunction when its probability of collision crosses this value. Industry practice screens at 1e-4.',
      `<div class="set-inline">
        <input type="text" class="set-input set-input--mono" value="1e-4" disabled aria-label="Pc threshold" />
        <span class="set-hint">alert above</span>
      </div>`,
    )}

    ${disabledRow(
      'Screening window',
      'How far ahead conjunctions are screened and re-screened as new CDMs arrive.',
      `<div class="set-inline">
        <input type="text" class="set-input set-input--mono" value="72" disabled aria-label="Screening window hours" />
        <span class="set-hint">hours ahead</span>
      </div>`,
    )}

    ${disabledRow(
      'Escalation / on-call policy',
      'Who gets paged, in what order, and after what silence — the triage escalation ladder.',
      `<select class="set-select" disabled aria-label="Escalation policy">
        <option>Primary → secondary → duty officer (15 min)</option>
      </select>`,
    )}

    ${disabledRow(
      'Notification channels',
      'Where alerts land. Each needs its own signed webhook / integration handled server-side.',
      `<div class="set-channels">
        ${['Slack', 'PagerDuty', 'Email', 'Webhook']
          .map(
            (c) =>
              `<span class="set-channel"><span class="set-channel__dot"></span>${c}</span>`,
          )
          .join('')}
      </div>`,
    )}

    <p class="set-note">
      Roadmap: the dashboard already ships the CONJUNCTION WATCH triage-queue
      design with an honest "awaiting SSA feed" state. These settings configure
      that queue once the ingest + alerting service is live.
    </p>
  `,
  );
}

/* ============================================================
   §06 · AUDIT & DATA  (REAL)
   ============================================================ */

function sectionAudit() {
  return panel(
    'audit',
    '06',
    'Audit &amp; Data',
    chip('real'),
    `
    <p class="set-note set-note--lead">
      OrbitOps keeps a tamper-evident, hash-chained audit log of operator
      actions and AI proposals in memory. Export it as a verifiable decision
      pack, verify the chain, or wipe every local cache this browser holds.
    </p>

    ${row(
      'Export audit chain',
      'Download the full hash-chained log as JSON — the verifiable "decision pack" an insurer or regulator can re-check offline.',
      `<div class="set-inline">
        <button type="button" class="set-btn set-btn--primary" id="auditExport">Export JSON</button>
        <span id="auditExportStatus">${statusDot('mute', `${audit.all().length} entries in memory`)}</span>
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Verify chain',
      'Re-hash every entry and confirm each links to its predecessor. Any tampering breaks the chain and is reported with the broken index.',
      `<div class="set-inline">
        <button type="button" class="set-btn" id="auditVerify">Verify integrity</button>
        <span id="auditVerifyStatus">${statusDot('mute', 'not checked')}</span>
      </div>`,
      { chip: chip('real') },
    )}

    ${row(
      'Clear local caches',
      'Removes cached TLEs (CelesTrak + your upload) and every <code>orbitops:settings:*</code> value from this browser. Your API key is <strong>not</strong> touched here — clear it in §01.',
      `<div class="set-inline">
        <button type="button" class="set-btn set-btn--danger" id="cacheClear">Clear caches…</button>
        <span id="cacheClearStatus">${statusDot('mute', cacheSummary())}</span>
      </div>`,
      { chip: chip('real') },
    )}

    <p class="set-note">
      Data retention: everything on this page lives in <em>this browser's</em>
      localStorage only. There is no server, no telemetry, and no third party —
      clearing your browser data erases all of it. The audit log is in-memory and
      resets on reload unless exported.
    </p>
  `,
  );
}

/** Count orbitops:* keys and total size for the clear-caches status line. */
function cacheSummary() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('orbitops:') && key !== 'orbitops:openrouter_key') n++;
    }
    return `${n} cache ${n === 1 ? 'entry' : 'entries'}`;
  } catch {
    return 'unavailable';
  }
}

/** @param {HTMLElement} root */
function wireAuditSection(root) {
  const exportBtn = root.querySelector('#auditExport');
  const exportStatus = /** @type {HTMLElement} */ (root.querySelector('#auditExportStatus'));
  const verifyBtn = root.querySelector('#auditVerify');
  const verifyStatus = /** @type {HTMLElement} */ (root.querySelector('#auditVerifyStatus'));
  const clearBtn = root.querySelector('#cacheClear');
  const clearStatus = /** @type {HTMLElement} */ (root.querySelector('#cacheClearStatus'));

  /** @type {Array<() => void>} */
  const listeners = [];
  /** @type {ReturnType<typeof setTimeout>[]} */
  const timers = [];
  /**
   * @param {EventTarget|null} el
   * @param {string} ev
   * @param {EventListener} fn
   */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  on(exportBtn, 'click', () => {
    try {
      const json = audit.export();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `orbitops-audit-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      timers.push(setTimeout(() => URL.revokeObjectURL(url), 4000));
      exportStatus.innerHTML = statusDot('ok', `exported ${audit.all().length} entries`);
    } catch (e) {
      exportStatus.innerHTML = statusDot('warn', 'export failed');
      console.warn('audit export failed', e);
    }
  });

  on(verifyBtn, 'click', async () => {
    verifyStatus.innerHTML = statusDot('mute', 'checking…');
    try {
      const res = await audit.verify();
      verifyStatus.innerHTML = res.valid
        ? statusDot('ok', `chain intact · ${audit.all().length} entries`)
        : statusDot('alert', `broken at #${res.brokenAt} (${res.reason})`);
    } catch (e) {
      verifyStatus.innerHTML = statusDot('warn', 'verify failed');
      console.warn('audit verify failed', e);
    }
  });

  on(clearBtn, 'click', () => {
    const ok = window.confirm(
      'Clear all local OrbitOps caches?\n\nThis removes cached TLEs and every ' +
        'settings value from this browser. Your OpenRouter API key is kept ' +
        '(clear it separately in §01). This cannot be undone.',
    );
    if (!ok) return;
    let removed = 0;
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('orbitops:') && key !== 'orbitops:openrouter_key') {
          toRemove.push(key);
        }
      }
      toRemove.forEach((k) => {
        localStorage.removeItem(k);
        removed++;
      });
      clearStatus.innerHTML = statusDot('ok', `cleared ${removed} entries · reload to apply`);
    } catch (e) {
      clearStatus.innerHTML = statusDot('warn', 'clear failed');
      console.warn('cache clear failed', e);
    }
  });

  return () => {
    listeners.forEach((fn) => fn());
    timers.forEach((t) => clearTimeout(t));
  };
}

/* ============================================================
   §07 · ACCOUNT & TEAM  (CLOUD · PLANNED)
   ============================================================ */

function sectionAccount() {
  /**
   * @param {string} label
   * @param {string} help
   */
  const cloudRow = (label, help) => `
    <div class="set-cloudrow">
      <div class="set-cloudrow__meta">
        <span class="set-cloudrow__label">${label}</span>
        <span class="set-cloudrow__help">${help}</span>
      </div>
      <span class="set-cloudrow__lock" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
        </svg>
      </span>
    </div>
  `;

  return panel(
    'account',
    '07',
    'Account &amp; Team',
    chip('cloud'),
    `
    <div class="set-cloudcard">
      <div class="set-cloudcard__head">
        <span class="set-cloudcard__badge">HOSTED ORBITOPS</span>
        <p>
          Self-hosting is <strong>keyless and local by design</strong> — there is
          no login, no account, and nothing to sign into. Your data stays in this
          browser and the APIs you configure. Teams, roles, and org-wide audit
          arrive with the future hosted tier.
        </p>
      </div>
      <div class="set-cloudlist">
        ${cloudRow('Sign in / SSO', 'SAML &amp; OIDC single sign-on for your org identity provider.')}
        ${cloudRow('Organisation & workspaces', 'Shared constellations, saved views, and per-workspace config.')}
        ${cloudRow('Roles & permissions (RBAC)', 'Operator / analyst / read-only scopes on every action.')}
        ${cloudRow('Per-tenant audit', 'The hash chain, but multi-user and retained server-side for compliance.')}
      </div>
      <p class="set-note">
        None of this is required to run OrbitOps. The open-core build is fully
        functional without it — this section reserves the surface so the cloud
        upgrade is additive, never a rewrite.
      </p>
    </div>
  `,
  );
}

/* ============================================================
   §08 · ABOUT
   ============================================================ */

function sectionAbout() {
  const mode = isAppMode() ? 'APP' : 'SITE';
  /**
   * @param {string} href
   * @param {string} label
   * @param {string} sub
   * @param {boolean} [external=true]
   */
  const linkRow = (href, label, sub, external = true) => `
    <a class="set-about__link" href="${href}" ${external ? 'target="_blank" rel="noreferrer"' : 'data-route="' + href + '"'}>
      <span class="set-about__link-label">${label}</span>
      <span class="set-about__link-sub">${sub}</span>
      <span class="set-about__link-arrow" aria-hidden="true">→</span>
    </a>
  `;

  return panel(
    'about',
    '08',
    'About',
    chip('real'),
    `
    <div class="set-about">
      <div class="set-about__id">
        <div class="set-about__ver">
          <span class="set-about__ver-k">ORBITOPS</span>
          <span class="set-about__ver-v">v0.1.0</span>
        </div>
        <div class="set-about__tags">
          <span class="set-about__tag">open source</span>
          <span class="set-about__tag">self-host</span>
          <span class="set-about__tag">BYOK</span>
          <span class="set-about__tag">MIT</span>
        </div>
        <div class="set-about__mode">
          <span class="set-about__mode-k">RUNNING AS</span>
          <span class="set-about__mode-v">${mode} MODE</span>
        </div>
      </div>

      <div class="set-about__links">
        ${linkRow('https://github.com/veter391/orbitops', 'GitHub repository', 'source, issues, roadmap')}
        ${linkRow('#/docs/data', 'Data sources & accuracy', 'CelesTrak cadence, SGP4 drift honesty', false)}
        ${linkRow('#/docs/terms', 'Terms & legal', 'usage, warranty, data handling', false)}
        ${linkRow('https://github.com/veter391/orbitops/blob/main/LICENSE', 'MIT License', 'the core is free forever')}
      </div>

      <p class="set-note">
        OrbitOps is open-core: one public MIT repository. Self-hosters get the
        full functional app and this Settings surface, run everything with their
        own keys, and owe nothing. Hosted, multi-tenant OrbitOps is a future
        add-on, never a gate on the core.
      </p>
    </div>
  `,
  );
}

/** @param {HTMLElement} root */
function wireAboutSection(root) {
  // Keep the mode indicators (rail + about) in sync in case the flag was set
  // via ?app during this view. No listeners to clean up — return a noop.
  const mode = isAppMode() ? 'APP' : 'SITE';
  const railEl = root.querySelector('#setModeIndicator');
  if (railEl) railEl.textContent = mode;
  return () => {};
}

/* ============================================================
   SECTION RAIL — scroll-spy + smooth anchor scroll
   ============================================================ */

/** @param {HTMLElement} root */
function wireSectionRail(root) {
  const links = /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll('.set-rail__link')));
  const targets = Array.from(root.querySelectorAll('[data-anchor-target]'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** @type {Array<() => void>} */
  const listeners = [];
  /**
   * @param {EventTarget} el
   * @param {string} ev
   * @param {EventListener} fn
   * @param {boolean|AddEventListenerOptions} [opts]
   */
  const on = (el, ev, fn, opts) => {
    el.addEventListener(ev, fn, opts);
    listeners.push(() => el.removeEventListener(ev, fn, opts));
  };

  // Click → smooth-scroll to the matching panel (never mutates the hash route).
  links.forEach((link) => {
    on(link, 'click', (e) => {
      e.preventDefault();
      const id = link.dataset.anchor;
      const target = /** @type {HTMLElement|null} */ (root.querySelector(`#set-${id}`));
      if (!target) return;
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });

  // Scroll-spy — highlight the section nearest the top.
  /** @type {IntersectionObserver|null} */
  let io = null;
  if ('IntersectionObserver' in window) {
    /** @param {string|undefined} id */
    const setActive = (id) => {
      links.forEach((l) => l.classList.toggle('is-active', l.dataset.anchor === id));
    };
    io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((en) => en.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(/** @type {HTMLElement} */ (visible.target).dataset.anchorTarget);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    const observer = io;
    targets.forEach((t) => observer.observe(t));
  }

  return () => {
    listeners.forEach((fn) => fn());
    if (io) io.disconnect();
  };
}

/* ============================================================
   Shared bits
   ============================================================ */

/**
 * Brief button label flash to confirm an action, then restore.
 * @param {Element|null} btn
 * @param {string} msg
 */
function flash(btn, msg) {
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('is-flashed');
  setTimeout(() => {
    btn.textContent = prev;
    btn.classList.remove('is-flashed');
  }, 1400);
}

/**
 * Side dot-rail — matches the shared v3 SIDE_NAV, plus Settings.
 * @param {string} active
 */
function sideNavHTML(active) {
  const items = [
    { id: 'home', label: 'HOME', path: '/' },
    { id: 'cockpit', label: 'COCKPIT', path: '/cockpit' },
    { id: 'agent', label: 'AGENT', path: '/agent' },
    { id: 'dashboard', label: 'DASHBOARD', path: '/dashboard' },
    { id: 'tools', label: 'TOOLS', path: '/tools' },
    { id: 'pricing', label: 'PRICING', path: '/pricing' },
    { id: 'docs', label: 'DOCS', path: '/docs' },
    { id: 'settings', label: 'SETTINGS', path: '/settings' },
  ];
  return items
    .map(
      (i) => `
    <a href="${i.path}" data-route="${i.path}" class="side-nav__item ${i.id === active ? 'is-active' : ''}" title="${i.label}">
      <span class="side-nav__dot"></span>
      <span class="side-nav__label">${i.label}</span>
    </a>`,
    )
    .join('');
}

/** Inject the settings stylesheet exactly once (id="settings-v3"). */
function injectSettingsV3() {
  if (document.getElementById('settings-v3')) return;
  const link = document.createElement('link');
  link.id = 'settings-v3';
  link.rel = 'stylesheet';
  link.href = '/src/styles/settings-v3.css';
  document.head.appendChild(link);
}
