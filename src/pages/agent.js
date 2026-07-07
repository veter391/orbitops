// @ts-check
/**
 * AI Agent deep-dive page — interactive live demo.
 *
 * The page is structured around a live demo console:
 *   - Pick a scenario → agent runs step-by-step in real-time (animated)
 *   - Each step renders in a "thinking" panel
 *   - Final proposal becomes interactive (approve/reject/modify)
 *   - Audit log updates live as decisions are made
 *
 * Less text, more functional demonstration.
 */

'use strict';

import { agent, SCENARIOS } from '../scenarios/index.js';
import { mountAgentPanel } from '../ui/agent-panel.js';
import { audit } from '../core/audit-log.js';
import { info, success, error } from '../ui/toast.js';
import { getStoredKey, setStoredKey, hasLiveAI } from '../core/openrouter-client.js';
import { mountAmbient } from '../ui/ambient.js';
import { esc } from '../utils.js';
import { isConnected, BackendClient } from '../core/backend-client.js';

/** Phase rail order shown in the console header. */
const PHASE_ORDER = ['OBSERVE', 'THINK', 'SCORE', 'PROPOSE', 'WAIT'];

/**
 * Chain phases that are not on the rail map onto the nearest rail chip.
 * @type {Record<string, string>}
 */
const PHASE_ALIAS = { SAFETY: 'PROPOSE' };

/**
 * Hairline-white instrument glyphs, one per scenario (fallback: scenario.icon).
 * @type {Record<string, string>}
 */
const SCENARIO_GLYPHS = {
  // warning triangle + dotted conjunction arc
  conjunction: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true">
    <path d="M12 6.5 19.5 19h-15z"/><path d="M12 11v3.5"/><path d="M12 16.8v.4"/>
    <path d="M3.5 7a12 12 0 0 1 17 0" stroke-dasharray="1 3"/></svg>`,
  // battery cell with charge bar
  battery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true">
    <rect x="4" y="9" width="14" height="8" rx="1"/><path d="M20 11.5v3"/><path d="M7 12v2M10 12v2"/></svg>`,
  // thermometer, rising
  thermal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true">
    <path d="M10.5 5.5a1.5 1.5 0 0 1 3 0v8a3.5 3.5 0 1 1-3 0z"/><path d="M12 9v7"/><path d="M17 7h3M17 10h2"/></svg>`,
  // maneuver vector, up and prograde
  commanded: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true">
    <path d="M5 19 17 7"/><path d="M11.5 7H17v5.5"/><circle cx="5" cy="19" r="1.4"/></svg>`,
  // ground station dish + uplink
  handoff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true">
    <path d="M5 12a7.4 7.4 0 0 0 7.4 7.4"/><circle cx="9.5" cy="15" r="2.6"/>
    <path d="M11.4 13 19 5.5"/><path d="M15.8 5.5H19V8.7"/><path d="M9.5 19.5V21"/></svg>`,
};

/** @param {{ id: string, icon: string }} s */
function scenarioGlyph(s) {
  return SCENARIO_GLYPHS[s.id] || s.icon;
}

/** @type {Record<string, string>} */
const AI_STAGE_LABELS = {
  analyst: 'LIVE AI · ANALYST THINKING…',
  strategist: 'LIVE AI · STRATEGIST WEIGHING OPTIONS…',
  safety: 'LIVE AI · SAFETY REVIEWER CHECKING…',
  fallback: 'LIVE AI UNAVAILABLE · USING DEMO REASONING',
  done: 'LIVE AI COMPLETE',
};

/** @type {(() => void) | null} */
let abortRun = null;
/** Monotonic run token. Every scenario run captures the current value; any
 *  later run (or unmount) increments it, so a superseded run bails at its next
 *  checkpoint instead of racing DOM writes / double-counting stats. */
let runGen = 0;
/** Live-elapsed timer of the in-flight scenario run, so a rapid re-click can
 *  clear it before starting the next run (prevents orphaned timers). */
/** @type {ReturnType<typeof setInterval> | null} */
let activeRunTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let auditRefreshTimer = null;
/** @type {{ unmount: () => void } | null} */
let ambient = null;
/** @type {IntersectionObserver | null} */
let deckIo = null;
/** @type {(() => void) | null} */
let unmountDepthGrid = null;

/** agent-v3.css loads after the base stylesheets; inject once (idempotent). */
function ensureStyles() {
  if (document.getElementById('agent-v3')) return;
  const link = document.createElement('link');
  link.id = 'agent-v3';
  link.rel = 'stylesheet';
  link.href = '/src/styles/agent-v3.css';
  document.head.appendChild(link);
}

/** @param {HTMLElement} app */
export async function mount(app) {
  ensureStyles();
  app.innerHTML = `
    <main class="agent-page">
      <!-- depth layer 2: faint hairline grid gliding at 0.3x scroll (layer 1 = ambient stars) -->
      <div class="agent-depth-grid" aria-hidden="true"></div>

      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header" data-deck="right">
        <!-- reasoning constellation — hairline nodes + links behind the title -->
        <svg class="agent-constellation" viewBox="0 0 640 300" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
          <g class="agent-constellation__links" stroke="rgba(255,255,255,0.10)" stroke-width="1">
            <path d="M60 210 180 120 320 160 430 70 560 130" stroke-dasharray="3 9"/>
            <path d="M180 120 250 40 430 70" stroke-dasharray="3 9"/>
            <path d="M320 160 380 240 560 130" stroke-dasharray="3 9"/>
          </g>
          <g fill="rgba(255,255,255,0.28)">
            <circle cx="60" cy="210" r="1.6"/><circle cx="180" cy="120" r="2"/>
            <circle cx="250" cy="40" r="1.4"/><circle cx="320" cy="160" r="2"/>
            <circle cx="380" cy="240" r="1.4"/><circle cx="430" cy="70" r="2"/>
            <circle cx="560" cy="130" r="1.6"/>
          </g>
          <circle cx="320" cy="160" r="5.5" stroke="rgba(143,198,255,0.35)" stroke-width="1"/>
        </svg>
        <div class="container">
          <div class="page-header__top">
            <span class="eyebrow">DEEP DIVE · MODULE 03</span>
            <span class="agent-status-pill" id="agentStatus">
              <span class="agent-status-pill__dot"></span>
              <span id="agentStatusText">AGENT ONLINE · ${SCENARIOS.length} SCENARIOS · SHA-256 AUDIT</span>
            </span>
            <button class="agent-status-pill ai-settings-btn" id="aiSettingsBtn" title="Configure live AI (OpenRouter)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span id="aiSettingsLabel">AI: SIMULATED</span>
            </button>
          </div>
          <h1 class="page-header__title">The AI agent.</h1>
          <p class="page-header__sub">
            Real Kepler physics. Anomaly detection running on simulated telemetry, clearly labelled.
            Real audit chain. The agent proposes — the operator decides. Always.
          </p>
        </div>
      </header>

      <!-- CONNECTED-MODE LIVE TRIAGE — additive, rendered only when a backend is
           configured (§03 Settings). Hidden and inert in the default simulation. -->
      <section class="agent-live-triage" id="agentLiveTriage" hidden></section>

      <!-- LIVE DEMO CONSOLE — the centerpiece -->
      <section class="agent-console" data-deck="left">
        <div class="container">
          <header class="section__head section__head--inline">
            <div>
              <span class="eyebrow">Live demo</span>
              <h2 class="section__title">Run a scenario. Watch the agent think.</h2>
            </div>
            <div class="agent-console__chips">
              <span class="agent-stat"><span id="agentRunCount">0</span> runs</span>
              <span class="agent-stat"><span id="agentApproveCount">0</span> approved</span>
              <span class="agent-stat"><span id="agentRejectCount">0</span> rejected</span>
            </div>
          </header>

          <div class="agent-demo-grid">
            <!-- Scenario picker — compact, click-to-run -->
            <aside class="agent-picker" id="agentPicker">
              ${SCENARIOS.map((s, i) => `
                <button class="agent-pick ${i === 0 ? 'is-active' : ''}" data-scenario="${s.id}">
                  <div class="agent-pick__icon">${scenarioGlyph(s)}</div>
                  <div class="agent-pick__body">
                    <div class="agent-pick__title">${s.title}</div>
                    <div class="agent-pick__desc">${s.description}</div>
                    <div class="agent-pick__meta">
                      <span class="agent-pick__sev agent-pick__sev--${s.severity}">${s.severity}</span>
                      <span>· ${s.chainLength} steps</span>
                    </div>
                  </div>
                </button>
              `).join('')}
            </aside>

            <!-- Reasoning console — flight-ops terminal -->
            <div class="agent-console__panel">
              <div class="agent-console__head">
                <span class="agent-console__scenario" id="consoleScenario">FLIGHT-OPS // STANDBY</span>
                <div class="agent-console__phases" id="phaseRail" aria-hidden="true">
                  ${PHASE_ORDER.map((p) => `<span class="phase-chip" data-phase="${p}">${p}</span>`).join('')}
                </div>
                <span class="agent-console__phase" id="agentPhase">READY</span>
                <span class="agent-console__timer" id="agentTimer">0 ms</span>
              </div>

              <div class="agent-console__stream" id="agentStream">
                <div class="agent-console__hint">
                  <div class="agent-console__ready">READY<span class="agent-console__cursor">_</span></div>
                  <div class="agent-console__hint-text">Select a scenario to start a run · each step renders in ~400 ms · real elapsed time</div>
                </div>
              </div>

              <div class="agent-console__footer" id="agentFooter" hidden>
                <div class="agent-console__confidence">
                  <div class="agent-console__confidence-label">Confidence</div>
                  <div class="agent-console__confidence-bar"><div class="agent-console__confidence-fill" id="agentConfidenceFill"></div></div>
                  <div class="agent-console__confidence-val" id="agentConfidenceVal">0%</div>
                </div>
                <div class="agent-console__actions">
                  <button class="btn btn--ghost btn--sm" id="agentRejectBtn">Reject</button>
                  <button class="btn btn--secondary btn--sm" id="agentModifyBtn">Modify</button>
                  <button class="btn btn--primary btn--sm" id="agentApproveBtn">Approve &amp; execute</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- AUDIT LOG — live feed of every action -->
      <section class="agent-audit" data-deck="right">
        <div class="container">
          <header class="section__head section__head--inline">
            <div>
              <span class="eyebrow">Audit log · live</span>
              <h2 class="section__title">Every decision, hash-chained.</h2>
            </div>
            <div class="agent-audit__status-group">
              <div class="agent-audit__chain-status">
                <span class="agent-audit__chain-status-dot"></span>
                <span>CHAIN VERIFIED · <span id="chainLen">0</span> ENTRIES · SHA-256</span>
              </div>
              <div class="agent-audit__actions">
                <button type="button" class="agent-audit__btn" id="auditVerify" title="Recompute every SHA-256 hash and confirm the chain is unbroken">VERIFY CHAIN</button>
                <button type="button" class="agent-audit__btn agent-audit__btn--primary" id="auditExport" title="Download the full hash-chained log as a verifiable JSON pack — evidence for insurers, regulators, or your own records">EXPORT ↓</button>
              </div>
            </div>
          </header>
          <p class="agent-audit__note">
            A verifiable decision pack: every proposal, approval, rejection and override,
            hash-chained so any tampering shows. Export it as JSON for an insurer, a
            regulator, or your own incident record — it verifies offline.
          </p>
          <div class="agent-audit__table" id="auditTable"></div>
        </div>
      </section>

      <!-- ARCHITECTURE — short flow diagram -->
      <section class="agent-architecture" data-deck="left">
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">Architecture</span>
            <h2 class="section__title">How the agent reasons.</h2>
          </header>
          <div class="arch-pipeline">
            ${[
              { n: '01', t: 'OBSERVE', b: 'Pull telemetry · designed to ingest public SSA feeds (planned)',
                g: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true"><path d="M3 12s3.5-5.5 9-5.5S21 12 21 12s-3.5 5.5-9 5.5S3 12 3 12z"/><circle cx="12" cy="12" r="2.2"/></svg>' },
              { n: '02', t: 'THINK', b: 'Kepler propagation · Welford stats · hypothesis generation',
                g: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true"><circle cx="7" cy="12" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="17" cy="18" r="2"/><path d="M9 11.2 15 6.8M9 12.8l6 4.4"/></svg>' },
              { n: '03', t: 'SCORE', b: 'Rank candidates by safety, fuel cost, mission impact, time',
                g: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-7"/><path d="M3.5 19h17"/></svg>' },
              { n: '04', t: 'PROPOSE', b: 'Generate proposal with full chain · alternatives · audit hash',
                g: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true"><path d="M7 3.5h7L18.5 8v12.5h-11z"/><path d="M14 3.5V8h4.5"/><path d="M9.5 13.5l1.8 1.8 3.4-3.4"/></svg>' },
              { n: '05', t: 'WAIT', b: 'Agent halts. Operator reviews and decides.', wait: true,
                g: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="18" height="18" aria-hidden="true"><path d="M9 8v8M15 8v8"/><circle cx="12" cy="12" r="9"/></svg>' },
            ].map((s, i, arr) => `
              <div class="arch-node ${s.wait ? 'arch-node--wait' : ''}">
                <div class="arch-node__head">
                  <span class="arch-node__idx">${s.n}</span>
                  <span class="arch-node__glyph">${s.g}</span>
                </div>
                <div class="arch-node__title">${s.t}</div>
                <div class="arch-node__body">${s.b}</div>
              </div>
              ${i < arr.length - 1 ? `
              <div class="arch-link" aria-hidden="true">
                <svg viewBox="0 0 40 8" preserveAspectRatio="none">
                  <line class="arch-link__dash" x1="0" y1="4" x2="40" y2="4"
                    stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 5"/>
                </svg>
              </div>` : ''}
            `).join('')}
          </div>
        </div>
      </section>

      <!-- F1 · THE GATE, STEP BY STEP — approval flow as a drawn timeline -->
      <section class="agent-gate" data-deck="right">
        <div class="container">
          <header class="section__head section__head--inline">
            <div>
              <span class="eyebrow">Approval flow</span>
              <h2 class="section__title">The gate, step by step.</h2>
            </div>
            <span class="agent-gate__tag">HUMAN-IN-THE-LOOP · ENFORCED IN ARCHITECTURE</span>
          </header>
          <ol class="gate-flow">
            <li class="gate-step">
              <div class="gate-step__idx">01</div>
              <div class="gate-step__title">ALERT RECEIVED</div>
              <div class="gate-step__body">A conjunction or anomaly trips the watchline.
                In this demo, alerts come from the five simulated scenarios above.
                Live SSA feed <span class="planned-chip">PLANNED</span></div>
            </li>
            <li class="gate-step">
              <div class="gate-step__idx">02</div>
              <div class="gate-step__title">AGENT DRAFTS</div>
              <div class="gate-step__body">The agent runs the physics, scores the
                alternatives, and drafts one proposal with its full reasoning chain
                attached. It cannot execute anything.</div>
            </li>
            <li class="gate-step gate-step--gate">
              <div class="gate-step__idx">03</div>
              <div class="gate-step__title">HUMAN REVIEWS</div>
              <div class="gate-step__body">A named operator reads the chain, then
                approves, modifies, or rejects. The gate is architecture, not policy —
                there is no autopilot code path.</div>
            </li>
            <li class="gate-step">
              <div class="gate-step__idx">04</div>
              <div class="gate-step__title">DECISION HASH-CHAINED</div>
              <div class="gate-step__body">The decision is appended to the SHA-256
                audit chain, sealed by the entry before it. Alter one record and the
                chain breaks — visibly.</div>
            </li>
            <li class="gate-step">
              <div class="gate-step__idx">05</div>
              <div class="gate-step__title">EXPORTABLE EVIDENCE</div>
              <div class="gate-step__body">The full chain exports as JSON — who
                decided what, when, on which reasoning. Runs in this browser today;
                insurer/regulator pack formats <span class="planned-chip">PLANNED</span></div>
            </li>
          </ol>
          <p class="gate-flow__note">Steps 02–05 run in this demo on the real in-browser
            hash chain. Step 01 uses simulated scenarios until a live feed ships.</p>
        </div>
      </section>

      <section class="agent-cta" data-deck="left">
        <div class="container">
          <div class="agent-cta__inner">
            <h2>Ready to add the agent to your ops?</h2>
            <p>MIT-licensed. Self-host or managed.</p>
            <a href="/pricing" data-route="/pricing" class="btn btn--primary btn--lg">PRICING &amp; PILOT →</a>
          </div>
        </div>
      </section>
    </main>

    <div class="modal-backdrop" id="proposalModal">
      <div class="modal" id="proposalCard"></div>
    </div>
  `;

  // Ambient space layer — starfield + drifting hairline satellite.
  ambient = mountAmbient(/** @type {HTMLElement} */ (app.querySelector('.agent-page')), { object: 'satellite' });

  // Console decks slide in laterally as they enter the viewport (once each),
  // and the hairline grid layer glides at 0.3x scroll behind them.
  deckIo = setupDeckReveals(app);
  unmountDepthGrid = mountDepthGrid(/** @type {HTMLElement|null} */ (app.querySelector('.agent-depth-grid')));

  mountSideNav(/** @type {HTMLElement|null} */ (app.querySelector('#sideNav')));
  wireScenarioPicker(app);
  wireAISettings(app);
  refreshAuditTable(app.querySelector('#auditTable'));
  auditRefreshTimer = setInterval(() => {
    refreshAuditTable(app.querySelector('#auditTable'));
    updateChainStatus();
  }, 1500);

  // D4 — verifiable audit export. One-click download of the REAL hash-chained
  // log as JSON (an evidence pack for insurers/regulators/incident records),
  // plus a live chain verify. Both run entirely client-side; nothing here is
  // simulated — it's the same tamper-evident chain the cockpit and agent write.
  const exportBtn = /** @type {HTMLElement|null} */ (app.querySelector('#auditExport'));
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const json = audit.export();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbitops-audit-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    info(`Exported ${audit.entries.length} entries · verifiable JSON`, { title: 'Audit export', durationMs: 3500 });
  });
  const verifyBtn = /** @type {HTMLElement|null} */ (app.querySelector('#auditVerify'));
  if (verifyBtn) verifyBtn.addEventListener('click', async () => {
    const res = await audit.verify();
    if (res.valid) {
      success(`Chain intact · ${audit.entries.length} entries verified`, { title: 'Audit verify', durationMs: 3500 });
    } else {
      error(`Chain broken at entry ${res.brokenAt} (${res.reason})`, { title: 'Audit verify', durationMs: 5000 });
    }
  });

  /** @param {{ stage: string }} arg */
  const onAIStage = ({ stage }) => {
    const phase = app.querySelector('#agentPhase');
    if (phase && AI_STAGE_LABELS[stage]) {
      phase.textContent = AI_STAGE_LABELS[stage];
      phase.className = `agent-console__phase agent-console__phase--${stage === 'fallback' ? 'alert' : 'running'}`;
    }
  };
  agent.on('ai-stage', onAIStage);

  // Connected mode (§03 Settings): surface the LIVE backend triage queue above
  // the simulation console. Additive — untouched when no backend is configured.
  const liveTriage = isConnected() ? mountLiveTriage(app) : null;

  return {
    unmount() {
      if (abortRun) abortRun();
      if (activeRunTimer) { clearInterval(activeRunTimer); activeRunTimer = null; }
      if (auditRefreshTimer) clearInterval(auditRefreshTimer);
      agent.off('ai-stage', onAIStage);
      if (liveTriage) liveTriage();
      if (deckIo) { deckIo.disconnect(); deckIo = null; }
      if (unmountDepthGrid) { unmountDepthGrid(); unmountDepthGrid = null; }
      if (ambient) { ambient.unmount(); ambient = null; }
    },
  };
}

/* ============================================================
   CONNECTED-MODE LIVE TRIAGE (real backend, not simulation)
   ============================================================ */

/** Scientific-notation Pc, e.g. 5.4e-3. @param {number} pc */
function fmtPc(pc) {
  return pc > 0 ? pc.toExponential(1) : '0';
}

/** UTC HH:MM:SS from an ISO timestamp. @param {string} ts */
function fmtTs(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(11, 19)}Z`;
}

/** Human message from a thrown BackendError (or anything). @param {unknown} e */
function triageErr(e) {
  const err = /** @type {{status?: number, message?: string}} */ (e);
  if (err && err.status === 0) return 'backend unreachable — check URL, CORS, and that it is running';
  if (err && (err.status === 401 || err.status === 403)) return 'API key rejected by the backend';
  return (err && err.message) || 'request failed';
}

/**
 * Read the REAL backend's proposal queue, open a proposal's full reasoning chain
 * (the explainable panel), and approve/reject it through the live HITL endpoints
 * — then re-verify the tamper-evident audit chain server-side. Every value here
 * is live backend data, never the in-browser simulation. Purely additive.
 * @param {HTMLElement} app
 * @returns {() => void} cleanup
 */
function mountLiveTriage(app) {
  const host = /** @type {HTMLElement|null} */ (app.querySelector('#agentLiveTriage'));
  if (!host) return () => {};
  const client = new BackendClient();

  host.hidden = false;
  host.innerHTML = `
    <div class="container">
      <header class="lt-head">
        <div>
          <span class="eyebrow">Connected · live backend</span>
          <h2 class="section__title">Triage queue</h2>
        </div>
        <div class="lt-head__actions">
          <span class="lt-conn" id="ltConn"><span class="lt-conn__dot"></span>connecting…</span>
          <button class="agent-status-pill" id="ltRefresh" type="button">Refresh</button>
        </div>
      </header>
      <div class="lt-grid">
        <aside class="lt-queue" id="ltQueue" aria-label="Proposal queue"></aside>
        <div class="lt-detail" id="ltDetail">
          <div class="lt-empty">Select a proposal to see its reasoning chain.</div>
        </div>
      </div>
    </div>
  `;

  const queueEl = /** @type {HTMLElement} */ (host.querySelector('#ltQueue'));
  const detailEl = /** @type {HTMLElement} */ (host.querySelector('#ltDetail'));
  const connEl = /** @type {HTMLElement} */ (host.querySelector('#ltConn'));
  const refreshBtn = host.querySelector('#ltRefresh');

  let disposed = false;
  /** @type {string|null} */
  let selectedId = null;
  /** @type {Array<() => void>} */
  const listeners = [];
  /** @param {EventTarget|null} el @param {string} ev @param {EventListener} fn */
  const on = (el, ev, fn) => {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  };

  /** @param {string} kind @param {string} text */
  const setConn = (kind, text) => {
    connEl.className = `lt-conn lt-conn--${kind}`;
    connEl.innerHTML = `<span class="lt-conn__dot"></span>${esc(text)}`;
  };

  async function loadQueue() {
    try {
      const { proposals } = await client.listProposals({ limit: 50 });
      if (disposed) return;
      const list = Array.isArray(proposals) ? proposals : [];
      renderQueue(list);
      const pending = list.filter((p) => p.status === 'pending').length;
      setConn('ok', `${list.length} in queue · ${pending} pending`);
    } catch (e) {
      if (disposed) return;
      queueEl.innerHTML = `<div class="lt-empty lt-empty--err">${esc(triageErr(e))}</div>`;
      setConn('err', 'disconnected');
    }
  }

  /** @param {any[]} list */
  function renderQueue(list) {
    if (!list.length) {
      queueEl.innerHTML = `<div class="lt-empty">Queue empty — no proposals yet.</div>`;
      return;
    }
    queueEl.innerHTML = list
      .map((p) => {
        const a = p.proposedAction || {};
        const band = a.riskBand || a.type || '—';
        return `<button class="lt-row ${p.id === selectedId ? 'is-active' : ''}" data-id="${esc(p.id)}" type="button">
          <div class="lt-row__top">
            <span class="lt-sat">${esc(p.satelliteId || '—')}</span>
            <span class="lt-status lt-status--${esc(p.status)}">${esc(p.status)}</span>
          </div>
          <div class="lt-row__meta">
            <span class="lt-band lt-band--${esc(a.riskBand || 'none')}">${esc(band)}</span>
            ${typeof a.pc === 'number' ? `<span class="lt-pc">Pc ${fmtPc(a.pc)}</span>` : ''}
            <span class="lt-ts">${fmtTs(p.ts)}</span>
          </div>
        </button>`;
      })
      .join('');
  }

  on(queueEl, 'click', (e) => {
    const target = /** @type {Element} */ (e.target);
    const btn = target.closest('.lt-row');
    if (btn) selectProposal(btn.getAttribute('data-id') || '');
  });
  on(refreshBtn, 'click', () => loadQueue());

  /** @param {string} id */
  async function selectProposal(id) {
    if (!id) return;
    selectedId = id;
    queueEl.querySelectorAll('.lt-row').forEach((el) =>
      el.classList.toggle('is-active', el.getAttribute('data-id') === id),
    );
    detailEl.innerHTML = `<div class="lt-empty">Loading…</div>`;
    try {
      const { proposal } = await client.getProposal(id);
      if (disposed) return;
      renderDetail(proposal);
    } catch (e) {
      if (disposed) return;
      detailEl.innerHTML = `<div class="lt-empty lt-empty--err">${esc(triageErr(e))}</div>`;
    }
  }

  /** @param {any} p */
  function renderDetail(p) {
    const a = p.proposedAction || {};
    const chain = Array.isArray(p.reasoningChain) ? p.reasoningChain : [];
    const pending = p.status === 'pending';
    /** @type {Array<[string, string]>} */
    const facts = [];
    if (a.type) facts.push(['action', String(a.type)]);
    if (a.riskBand) facts.push(['risk band', String(a.riskBand)]);
    if (typeof a.pc === 'number') facts.push(['Pc', fmtPc(a.pc)]);
    if (typeof a.deltaVMs === 'number') facts.push(['Δv', `${a.deltaVMs.toFixed(4)} m/s`]);
    if (typeof a.propellantKg === 'number') facts.push(['propellant', `${a.propellantKg.toFixed(4)} kg`]);
    if (typeof a.missDistanceKm === 'number') facts.push(['miss', `${a.missDistanceKm} km`]);

    detailEl.innerHTML = `
      <header class="lt-detail__head">
        <div>
          <span class="lt-sat">${esc(p.satelliteId || '—')}</span>
          <span class="lt-status lt-status--${esc(p.status)}">${esc(p.status)}</span>
        </div>
        <span class="lt-id" title="proposal id">${esc(String(p.id).slice(0, 8))}</span>
      </header>
      <div class="lt-facts">
        ${facts
          .map(
            ([k, v]) =>
              `<div class="lt-fact"><span class="lt-fact__k">${esc(k)}</span><span class="lt-fact__v">${esc(v)}</span></div>`,
          )
          .join('')}
      </div>
      <div class="lt-chain">
        <div class="lt-chain__label">Reasoning chain · ${chain.length} steps</div>
        ${chain
          .map(
            /** @param {any} s */ (s) => `
          <div class="lt-step">
            <span class="lt-step__phase">${esc(s.phase || '')}</span>
            <div class="lt-step__body">
              <span class="lt-step__agent">${esc(s.agent || '')}</span>
              <span class="lt-step__text">${esc(s.text || '')}</span>
            </div>
          </div>`,
          )
          .join('')}
      </div>
      ${
        pending
          ? `<div class="lt-actions">
        <textarea class="lt-reason" id="ltReason" rows="2" placeholder="Rejection reason (optional)"></textarea>
        <div class="lt-actions__btns">
          <button class="btn btn--primary" id="ltApprove" type="button">Approve</button>
          <button class="btn" id="ltReject" type="button">Reject</button>
        </div>
        <div class="lt-result" id="ltResult"></div>
      </div>`
          : `<div class="lt-decided">Decided${p.approvedBy ? ` · ${esc(p.approvedBy)}` : ''} — no further action.</div>`
      }
    `;
    if (pending) wireDecision(p.id);
  }

  /** @param {string} id */
  function wireDecision(id) {
    const approve = /** @type {HTMLButtonElement|null} */ (detailEl.querySelector('#ltApprove'));
    const reject = /** @type {HTMLButtonElement|null} */ (detailEl.querySelector('#ltReject'));
    const result = /** @type {HTMLElement|null} */ (detailEl.querySelector('#ltResult'));
    const reasonEl = /** @type {HTMLTextAreaElement|null} */ (detailEl.querySelector('#ltReason'));
    if (!approve || !reject || !result) return;

    /** @param {() => Promise<unknown>} fn @param {string} label */
    const decide = async (fn, label) => {
      approve.disabled = true;
      reject.disabled = true;
      result.innerHTML = `<span class="lt-result__pending">${esc(label)}…</span>`;
      try {
        await fn();
        // Re-verify the tamper-evident chain server-side after the write.
        let chainMsg = '';
        try {
          const v = await client.verifyAudit();
          chainMsg = v && v.valid ? ' · audit chain intact' : ' · audit chain BROKEN';
        } catch {
          chainMsg = ' · chain re-verify unavailable';
        }
        if (disposed) return;
        result.innerHTML = `<span class="lt-result__ok">${esc(label)} recorded${esc(chainMsg)}</span>`;
        success(`Proposal ${label.toLowerCase()} · live backend`, { title: 'Triage', durationMs: 3000 });
        await loadQueue();
        await selectProposal(id);
      } catch (e) {
        if (disposed) return;
        approve.disabled = false;
        reject.disabled = false;
        result.innerHTML = `<span class="lt-result__err">${esc(triageErr(e))}</span>`;
        error(triageErr(e), { title: 'Triage failed', durationMs: 4000 });
      }
    };

    on(approve, 'click', () => decide(() => client.approveProposal(id), 'Approved'));
    on(reject, 'click', () =>
      decide(() => client.rejectProposal(id, reasonEl ? reasonEl.value.trim() : ''), 'Rejected'),
    );
  }

  setConn('mute', 'connecting…');
  loadQueue();

  return () => {
    disposed = true;
    listeners.forEach((fn) => fn());
  };
}

/**
 * Deck reveals — each [data-deck] section slides in laterally (side per its
 * data-deck value, styled in agent-v3.css) the first time it enters the
 * viewport. Once-only: targets are unobserved after docking.
 * @param {HTMLElement} app
 * @returns {IntersectionObserver|null} the observer (for unmount), or null.
 */
function setupDeckReveals(app) {
  const decks = app.querySelectorAll('[data-deck]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    decks.forEach((d) => d.classList.add('is-docked'));
    return null;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-docked');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  decks.forEach((d) => io.observe(d));
  return io;
}

/**
 * Depth grid — the fixed hairline grid layer translates its background at
 * 0.3x scroll speed, so scrolling reads as gliding past console decks.
 * rAF-throttled, passive listener; disabled under prefers-reduced-motion.
 * @param {HTMLElement|null} grid
 * @returns {() => void} cleanup for unmount.
 */
function mountDepthGrid(grid) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!grid || reduced) return () => {};
  let raf = 0;
  const sync = () => {
    raf = 0;
    grid.style.backgroundPosition = `0 ${(-(window.scrollY || 0) * 0.3).toFixed(1)}px`;
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
  window.addEventListener('scroll', onScroll, { passive: true });
  sync();
  return () => {
    window.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}

/** @param {HTMLElement} app */
function updateAILabel(app) {
  const label = app.querySelector('#aiSettingsLabel');
  if (label) label.textContent = hasLiveAI() ? 'AI: LIVE (OpenRouter)' : 'AI: SIMULATED';
}

/** @param {HTMLElement} app */
function wireAISettings(app) {
  updateAILabel(app);
  app.querySelector('#aiSettingsBtn')?.addEventListener('click', () => openAISettingsModal(app));
}

/** @param {HTMLElement} app */
function openAISettingsModal(app) {
  const existing = document.getElementById('ai-settings-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'ai-settings-modal';
  modal.className = 'modal-backdrop is-show';
  modal.innerHTML = `
    <div class="modal modal--small">
      <div class="modal__header">
        <div>
          <div class="modal__eyebrow">Live AI · OpenRouter</div>
          <h3 class="modal__title">Bring your own API key</h3>
        </div>
        <button class="proposal__close" id="aiModalClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">
        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6; margin: 0 0 12px;">
          OrbitOps is a static site with no backend — your key is stored only in this browser's
          <code>localStorage</code> and sent directly to <code>openrouter.ai</code>, never to any OrbitOps server
          (there isn't one). Get a free key at
          <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai/settings/keys</a>.
        </p>
        <label class="modal__field">
          <span>OpenRouter API key</span>
          <input type="password" id="aiKeyInput" class="modal__textarea" style="min-height:auto; padding:10px 12px;"
            placeholder="sk-or-v1-…" value="${getStoredKey() ? '••••••••••••••••••••••••' : ''}" autocomplete="off" />
        </label>
        <div class="modal__actions">
          <button class="btn btn--ghost" id="aiKeyClear">Clear key</button>
          <button class="btn btn--primary" id="aiKeySave">Save &amp; enable live AI</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  const closeBtn = /** @type {HTMLElement|null} */ (modal.querySelector('#aiModalClose'));
  if (closeBtn) closeBtn.onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  const clearBtn = /** @type {HTMLElement|null} */ (modal.querySelector('#aiKeyClear'));
  if (clearBtn) clearBtn.onclick = () => {
    setStoredKey('');
    updateAILabel(app);
    info('OpenRouter key cleared — back to simulated reasoning', { title: 'AI settings', durationMs: 3000 });
    close();
  };
  const saveBtn = /** @type {HTMLElement|null} */ (modal.querySelector('#aiKeySave'));
  if (saveBtn) saveBtn.onclick = () => {
    const input = /** @type {HTMLInputElement|null} */ (modal.querySelector('#aiKeyInput'));
    if (!input) return;
    const value = input.value.trim();
    if (value && !value.startsWith('••')) {
      setStoredKey(value);
      success('Live AI enabled — scenarios now reason via OpenRouter', { title: 'AI settings', durationMs: 3500 });
    }
    updateAILabel(app);
    close();
  };
}

/** @param {HTMLElement} app */
function wireScenarioPicker(app) {
  const picker = /** @type {HTMLElement|null} */ (app.querySelector('#agentPicker'));
  const stream = /** @type {HTMLElement|null} */ (app.querySelector('#agentStream'));
  const phase = /** @type {HTMLElement|null} */ (app.querySelector('#agentPhase'));
  const timer = /** @type {HTMLElement|null} */ (app.querySelector('#agentTimer'));
  const footer = /** @type {HTMLElement|null} */ (app.querySelector('#agentFooter'));
  const confidenceFill = /** @type {HTMLElement|null} */ (app.querySelector('#agentConfidenceFill'));
  const confidenceVal = /** @type {HTMLElement|null} */ (app.querySelector('#agentConfidenceVal'));
  if (!picker || !stream || !phase || !timer || !footer || !confidenceFill || !confidenceVal) return;

  picker.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-scenario]');
    if (!btn) return;
    picker.querySelectorAll('.agent-pick').forEach((b) => b.classList.toggle('is-active', b === btn));
    const id = /** @type {HTMLElement} */ (btn).dataset.scenario;
    if (!id) return;
    const scenario = SCENARIOS.find((s) => s.id === id);

    // Supersede any in-flight run. Bumping runGen invalidates the previous run
    // at every checkpoint (including while it awaits runScenario), so it can't
    // interleave DOM writes into the shared stream or double-count stats. The
    // stale timer is cleared here; abortRun lets unmount invalidate this run.
    const myGen = ++runGen;
    abortRun = () => { runGen++; };
    if (activeRunTimer) { clearInterval(activeRunTimer); activeRunTimer = null; }

    // Reset UI
    stream.innerHTML = '';
    footer.hidden = true;
    setScenarioLabel(app, scenario ? scenario.title : id);
    setPhaseRail(app, null);
    phase.textContent = 'RUNNING';
    phase.className = 'agent-console__phase agent-console__phase--running';
    const startTs = performance.now();
    timer.textContent = '0 ms';
    const timerInt = setInterval(() => {
      timer.textContent = `${Math.round(performance.now() - startTs)} ms`;
    }, 50);
    activeRunTimer = timerInt;

    // Compute proposal
    let proposal;
    try {
      proposal = await agent.runScenario(id);
    } catch (e) {
      clearInterval(timerInt);
      if (myGen !== runGen) return; // superseded — don't clobber the newer run's UI
      activeRunTimer = null;
      phase.textContent = 'ERROR';
      phase.className = 'agent-console__phase agent-console__phase--alert';
      stream.innerHTML = `<div class="agent-console__error">${esc(e instanceof Error ? e.message : String(e))}</div>`;
      return;
    }

    // A newer run may have started while runScenario() was in flight.
    if (myGen !== runGen) { clearInterval(timerInt); return; }

    // Animate the reasoning chain
    for (let i = 0; i < proposal.chain.length; i++) {
      if (myGen !== runGen) break;
      const step = proposal.chain[i];
      phase.textContent = step.phase;
      phase.className = 'agent-console__phase agent-console__phase--running';
      setPhaseRail(app, step.phase);
      const stepEl = renderStep(step, Math.round(performance.now() - startTs));
      stream.appendChild(stepEl);
      stepEl.classList.add('is-entering');
      requestAnimationFrame(() => stepEl.classList.add('is-shown'));
      stream.scrollTop = stream.scrollHeight;
      await sleep(380);
    }

    if (myGen !== runGen) {
      clearInterval(timerInt);
      return;
    }

    // Final state — WAIT for operator
    phase.textContent = 'WAITING FOR OPERATOR';
    phase.className = 'agent-console__phase agent-console__phase--wait';
    setPhaseRail(app, 'WAIT');
    clearInterval(timerInt);
    activeRunTimer = null;
    timer.textContent = `${Math.round(performance.now() - startTs)} ms`;

    // Confidence + actions
    confidenceFill.style.width = `${(proposal.confidence * 100).toFixed(0)}%`;
    confidenceVal.textContent = `${(proposal.confidence * 100).toFixed(0)}%`;
    footer.hidden = false;

    // Wire approve/reject/modify
    const approveBtn = /** @type {HTMLElement|null} */ (app.querySelector('#agentApproveBtn'));
    const rejectBtn = /** @type {HTMLElement|null} */ (app.querySelector('#agentRejectBtn'));
    const modifyBtn = /** @type {HTMLElement|null} */ (app.querySelector('#agentModifyBtn'));
    if (approveBtn) approveBtn.onclick = async () => {
      await agent.approve(proposal.id, 'demo-operator');
      success('Proposal approved · burn queued', { title: 'Agent', durationMs: 3500 });
      bumpCounter('agentApproveCount');
      refreshAuditTable(app.querySelector('#auditTable'));
    };
    if (rejectBtn) rejectBtn.onclick = () => {
      openRejectDialog(proposal, (reason) => {
        agent.reject(proposal.id, 'demo-operator', reason);
        info('Proposal rejected', { title: 'Agent', durationMs: 3500 });
        bumpCounter('agentRejectCount');
        refreshAuditTable(app.querySelector('#auditTable'));
      });
    };
    if (modifyBtn) modifyBtn.onclick = () => {
      const modal = app.querySelector('#proposalModal');
      const card = /** @type {HTMLElement|null} */ (app.querySelector('#proposalCard'));
      if (!modal || !card) return;
      mountAgentPanel(card, proposal, {
        onClose: () => modal.classList.remove('is-show'),
        onApprove: async () => {
          await agent.approve(proposal.id, 'demo-operator');
          modal.classList.remove('is-show');
          success('Modified proposal approved', { title: 'Agent', durationMs: 3500 });
          bumpCounter('agentApproveCount');
          refreshAuditTable(app.querySelector('#auditTable'));
        },
        onReject: (r) => {
          agent.reject(proposal.id, 'demo-operator', r);
          modal.classList.remove('is-show');
          info('Proposal rejected', { title: 'Agent', durationMs: 3500 });
          bumpCounter('agentRejectCount');
          refreshAuditTable(app.querySelector('#auditTable'));
        },
      });
      modal.classList.add('is-show');
    };

    bumpCounter('agentRunCount');
    abortRun = null;
  });
}

/**
 * @param {any} proposal - AgentProposal, rendered dynamically
 * @param {(reason: string) => void} onSubmit
 */
function openRejectDialog(proposal, onSubmit) {
  // Remove existing modal if any
  const existing = document.getElementById('agent-reject-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'agent-reject-modal';
  modal.className = 'modal-backdrop is-show';
  modal.innerHTML = `
    <div class="modal modal--small">
      <div class="modal__header">
        <div>
          <div class="modal__eyebrow">Action · Reject</div>
          <h3 class="modal__title">Reject this proposal?</h3>
        </div>
        <button class="proposal__close" id="rejectClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">
        <div class="modal__proposal-info">
          <span class="proposal__chip">${esc(proposal.satelliteId)}</span>
          <span class="proposal__chip">${esc(proposal.scenarioId)}</span>
        </div>
        <div class="modal__proposal-title">${esc(proposal.title)}</div>
        <div class="modal__proposal-summary">${esc(proposal.summary)}</div>
        <label class="modal__field">
          <span>Reason for rejection (optional)</span>
          <textarea id="rejectReason" class="modal__textarea" rows="3" placeholder="e.g. Conflicts with current mission timeline…"></textarea>
        </label>
        <div class="modal__actions">
          <button class="btn btn--ghost" id="rejectCancel">Cancel</button>
          <button class="btn btn--danger" id="rejectConfirm">Reject proposal</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  const rejectClose = /** @type {HTMLElement|null} */ (modal.querySelector('#rejectClose'));
  if (rejectClose) rejectClose.onclick = close;
  const rejectCancel = /** @type {HTMLElement|null} */ (modal.querySelector('#rejectCancel'));
  if (rejectCancel) rejectCancel.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  const rejectConfirm = /** @type {HTMLElement|null} */ (modal.querySelector('#rejectConfirm'));
  if (rejectConfirm) rejectConfirm.onclick = () => {
    const reasonEl = /** @type {HTMLTextAreaElement|null} */ (modal.querySelector('#rejectReason'));
    const reason = reasonEl ? reasonEl.value.trim() : '';
    close();
    onSubmit(reason);
  };
  setTimeout(() => /** @type {HTMLElement|null} */ (modal.querySelector('#rejectReason'))?.focus(), 100);
}

/**
 * Update the mono scenario label in the console header rail.
 * @param {HTMLElement} app
 * @param {string} title
 */
function setScenarioLabel(app, title) {
  const el = app.querySelector('#consoleScenario');
  if (el) el.textContent = `FLIGHT-OPS // ${String(title).toUpperCase()}`;
}

/**
 * Light the phase chips as the run progresses.
 * @param {Element} app
 * @param {string|null} phase  Current chain phase (null = reset all chips).
 */
function setPhaseRail(app, phase) {
  const rail = app.querySelector('#phaseRail');
  if (!rail) return;
  const resolved = phase ? (PHASE_ALIAS[phase] || phase) : null;
  const idx = resolved ? PHASE_ORDER.indexOf(resolved) : -1;
  rail.querySelectorAll('.phase-chip').forEach((chip, i) => {
    chip.classList.toggle('is-done', idx >= 0 && i < idx);
    chip.classList.toggle('is-active', i === idx);
  });
}

/**
 * Render a small subset of markdown (**bold**, *italic*) as HTML. HTML-escapes
 * the input FIRST so externally-sourced text (LLM output) can never inject
 * markup — only the bold/italic tags we add are real HTML.
 * @param {string} [s]
 */
function renderText(s) {
  if (!s) return '';
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** @param {any} step @param {number} elapsedMs */
function renderStep(step, elapsedMs) {
  const wrap = document.createElement('div');
  wrap.className = 'agent-step';
  wrap.dataset.phase = step.phase; // drives the thin left phase rail (CSS)
  const isLive = step.source === 'live-ai';
  wrap.innerHTML = `
    <div class="agent-step__head">
      <span class="agent-step__phase">${step.phase}</span>
      ${isLive ? `<span class="chain-step__source chain-step__source--live" title="Genuine LLM call via OpenRouter">LIVE AI · ${step.model || ''}</span>` : ''}
      <span class="agent-step__ts">+${elapsedMs} ms</span>
    </div>
    <div class="agent-step__title">${renderText(step.title)}</div>
    <div class="agent-step__body">${renderText(step.body)}</div>
    ${renderStepData(step.data)}
  `;
  return wrap;
}

/** @param {any} data */
function renderStepData(data) {
  if (!data) return '';
  if (data.alternatives && Array.isArray(data.alternatives)) {
    return `
      <table class="agent-step__table">
        <thead><tr><th>Strategy</th><th>Δv</th><th>Fuel</th><th>Margin</th></tr></thead>
        <tbody>
          ${data.alternatives.map((/** @type {any} */ alt) => `
            <tr class="${alt.kind === 'Recommended' ? 'is-recommended' : ''}">
              <td><span class="agent-step__kind">${alt.kind}</span> ${alt.label}${alt.kind === 'Recommended' ? ' <span class="agent-step__winner">WINNER</span>' : ''}</td>
              <td>${alt.dv.toFixed(2)} m/s</td>
              <td>${alt.fuel.toFixed(3)} kg</td>
              <td class="${alt.safetyMargin > 0 ? 'text-ok' : 'text-alert'}">${alt.safetyMargin > 0 ? '+' : ''}${alt.safetyMargin.toFixed(1)} km</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  if (data.hypotheses && Array.isArray(data.hypotheses)) {
    return `
      <div class="agent-step__bars">
        ${data.hypotheses.map((/** @type {any} */ h) => `
          <div class="agent-step__bar-row">
            <span class="agent-step__bar-label">${h.label}</span>
            <div class="agent-step__bar"><div class="agent-step__bar-fill" style="width: ${(h.likelihood * 100).toFixed(0)}%;"></div></div>
            <span class="agent-step__bar-val">${(h.likelihood * 100).toFixed(0)}%</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (data.options && Array.isArray(data.options)) {
    return `
      <div class="agent-step__bars">
        ${data.options.map((/** @type {any} */ o) => `
          <div class="agent-step__bar-row ${o.id === data.winner ? 'is-recommended' : ''}">
            <span class="agent-step__bar-label">${o.id === data.winner ? '★ ' : ''}${o.label}</span>
            <div class="agent-step__bar"><div class="agent-step__bar-fill" style="width: ${Math.min(100, o.weeksGained * 8)}%;"></div></div>
            <span class="agent-step__bar-val">+${o.weeksGained} wk</span>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (data.gapSeconds !== undefined) {
    return `
      <div class="agent-step__kv">
        <span>Gap: <strong>${data.gapSeconds}s</strong></span>
        <span>Buffer: <strong>${data.storageUsed}/${data.storageCapacity} MB</strong></span>
        <span>Strategy: <strong>${data.strategy}</strong></span>
      </div>
    `;
  }
  return '';
}

/** @param {string} id */
function bumpCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(Number(el.textContent || '0') + 1);
}

function updateChainStatus() {
  const len = document.getElementById('chainLen');
  if (len) len.textContent = String(audit.all().length);
}

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {HTMLElement|null} host */
function mountSideNav(host) {
  if (!host) return;
  host.innerHTML = `
    <a href="/" data-route="/" class="side-nav__item" title="Home"><span class="side-nav__dot"></span><span class="side-nav__label">HOME</span></a>
    <a href="/cockpit" data-route="/cockpit" class="side-nav__item" title="Cockpit"><span class="side-nav__dot"></span><span class="side-nav__label">COCKPIT</span></a>
    <a href="/agent" data-route="/agent" class="side-nav__item is-active" title="Agent"><span class="side-nav__dot"></span><span class="side-nav__label">AGENT</span></a>
    <a href="/dashboard" data-route="/dashboard" class="side-nav__item" title="Dashboard"><span class="side-nav__dot"></span><span class="side-nav__label">DASHBOARD</span></a>
    <a href="/tools" data-route="/tools" class="side-nav__item" title="Tools"><span class="side-nav__dot"></span><span class="side-nav__label">TOOLS</span></a>
    <a href="/pricing" data-route="/pricing" class="side-nav__item" title="Pricing"><span class="side-nav__dot"></span><span class="side-nav__label">PRICING</span></a>
    <a href="/docs" data-route="/docs" class="side-nav__item" title="Docs"><span class="side-nav__dot"></span><span class="side-nav__label">DOCS</span></a>
  `;
}

/** @param {HTMLElement|null} host */
function refreshAuditTable(host) {
  if (!host) return;
  const entries = audit.all().slice(-10).reverse();
  if (entries.length === 0) {
    host.innerHTML = `
      <div class="agent-audit__empty">
        <div class="agent-audit__empty-icon">◌</div>
        <div>No decisions yet</div>
        <div class="agent-audit__empty-hint">Run a scenario above — approved/rejected actions appear here</div>
      </div>
    `;
    return;
  }
  host.innerHTML = `
    <div class="agent-audit__headrow" aria-hidden="true">
      <div>SEQ</div><div>TIME</div><div>ACTOR</div><div>ACTION</div><div>SHA-256</div>
    </div>
    <div class="agent-audit__rows">
      ${entries.map((e) => `
        <div class="agent-audit__row">
          <div class="agent-audit__seq">#${String(e.seq).padStart(3, '0')}</div>
          <div class="agent-audit__time">${new Date(e.ts).toLocaleTimeString()}</div>
          <div class="agent-audit__actor">${e.actor}</div>
          <div class="agent-audit__action">${e.action}</div>
          <div class="agent-audit__hash">${/** @type {string} */ (e.hash).slice(0, 12)}…${/** @type {string} */ (e.hash).slice(-6)}</div>
        </div>
      `).join('')}
    </div>
  `;
}