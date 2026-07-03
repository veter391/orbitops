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
import { toast } from '../ui/toast.js';
import { getStoredKey, setStoredKey, hasLiveAI } from '../core/openrouter-client.js';

const AI_STAGE_LABELS = {
  analyst: 'LIVE AI · ANALYST THINKING…',
  strategist: 'LIVE AI · STRATEGIST WEIGHING OPTIONS…',
  safety: 'LIVE AI · SAFETY REVIEWER CHECKING…',
  fallback: 'LIVE AI UNAVAILABLE · USING DEMO REASONING',
  done: 'LIVE AI COMPLETE',
};

let abortRun = null;
let auditRefreshTimer = null;

export async function mount(app) {
  app.innerHTML = `
    <main class="agent-page page-bg page-bg--agent">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <div class="page-header__top">
            <span class="eyebrow">DEEP DIVE · MODULE 03</span>
            <span class="agent-status-pill" id="agentStatus">
              <span class="agent-status-pill__dot"></span>
              <span id="agentStatusText">AGENT ONLINE · 5 SCENARIOS · SHA-256 AUDIT</span>
            </span>
            <button class="agent-status-pill ai-settings-btn" id="aiSettingsBtn" title="Configure live AI (OpenRouter)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span id="aiSettingsLabel">AI: SIMULATED</span>
            </button>
          </div>
          <h1 class="page-header__title">The AI agent.</h1>
          <p class="page-header__sub">
            Real Kepler physics. Real anomaly detection. Real audit chain.
            The agent proposes — the operator decides. Always.
          </p>
        </div>
      </header>

      <!-- LIVE DEMO CONSOLE — the centerpiece -->
      <section class="agent-console">
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
                  <div class="agent-pick__icon">${s.icon}</div>
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

            <!-- Reasoning console — animated step-by-step -->
            <div class="agent-console__panel">
              <div class="agent-console__head">
                <span class="agent-console__phase" id="agentPhase">READY</span>
                <span class="agent-console__timer" id="agentTimer">0 ms</span>
              </div>

              <div class="agent-console__stream" id="agentStream">
                <div class="agent-console__hint">
                  <div class="agent-console__hint-icon">▶</div>
                  <div>Click any scenario to run. Each step takes ~250 ms to display.</div>
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
      <section class="agent-audit">
        <div class="container">
          <header class="section__head section__head--inline">
            <div>
              <span class="eyebrow">Audit log · live</span>
              <h2 class="section__title">Every decision, hash-chained.</h2>
            </div>
            <div class="agent-audit__chain-status">
              <span class="agent-audit__chain-status-dot"></span>
              <span>Chain verified · <span id="chainLen">0</span> entries</span>
            </div>
          </header>
          <div class="agent-audit__table" id="auditTable"></div>
        </div>
      </section>

      <!-- ARCHITECTURE — short flow diagram -->
      <section class="agent-architecture">
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">Architecture</span>
            <h2 class="section__title">How the agent reasons.</h2>
          </header>
          <div class="arch-flow">
            <div class="arch-step">
              <div class="arch-step__num">01</div>
              <div class="arch-step__title">OBSERVE</div>
              <div class="arch-step__body">Pull telemetry · cross-reference with LeoLabs, 18 SDS, ExoAnalytic</div>
            </div>
            <div class="arch-arrow">→</div>
            <div class="arch-step">
              <div class="arch-step__num">02</div>
              <div class="arch-step__title">THINK</div>
              <div class="arch-step__body">Kepler propagation · Welford stats · hypothesis generation</div>
            </div>
            <div class="arch-arrow">→</div>
            <div class="arch-step">
              <div class="arch-step__num">03</div>
              <div class="arch-step__title">SCORE</div>
              <div class="arch-step__body">Rank candidates by safety, fuel cost, mission impact, time</div>
            </div>
            <div class="arch-arrow">→</div>
            <div class="arch-step">
              <div class="arch-step__num">04</div>
              <div class="arch-step__title">PROPOSE</div>
              <div class="arch-step__body">Generate proposal with full chain · alternatives · audit hash</div>
            </div>
            <div class="arch-arrow">→</div>
            <div class="arch-step arch-step--wait">
              <div class="arch-step__num">05</div>
              <div class="arch-step__title">WAIT</div>
              <div class="arch-step__body">Agent halts. Operator reviews and decides.</div>
            </div>
          </div>
        </div>
      </section>

      <section class="agent-cta">
        <div class="container">
          <div class="agent-cta__inner">
            <h2>Ready to add the agent to your ops?</h2>
            <p>MIT-licensed. Self-host or managed. SOC 2 roadmap in flight.</p>
            <a href="/pricing" data-route="/pricing" class="btn btn--primary btn--lg">PRICING &amp; PILOT →</a>
          </div>
        </div>
      </section>
    </main>

    <div class="modal-backdrop" id="proposalModal">
      <div class="modal" id="proposalCard"></div>
    </div>
  `;

  mountSideNav(app.querySelector('#sideNav'));
  wireScenarioPicker(app);
  wireAISettings(app);
  refreshAuditTable(app.querySelector('#auditTable'));
  auditRefreshTimer = setInterval(() => {
    refreshAuditTable(app.querySelector('#auditTable'));
    updateChainStatus();
  }, 1500);

  const onAIStage = ({ stage }) => {
    const phase = app.querySelector('#agentPhase');
    if (phase && AI_STAGE_LABELS[stage]) {
      phase.textContent = AI_STAGE_LABELS[stage];
      phase.className = `agent-console__phase agent-console__phase--${stage === 'fallback' ? 'alert' : 'running'}`;
    }
  };
  agent.on('ai-stage', onAIStage);

  return {
    unmount() {
      if (abortRun) abortRun();
      if (auditRefreshTimer) clearInterval(auditRefreshTimer);
      agent.off('ai-stage', onAIStage);
    },
  };
}

function updateAILabel(app) {
  const label = app.querySelector('#aiSettingsLabel');
  if (label) label.textContent = hasLiveAI() ? 'AI: LIVE (OpenRouter)' : 'AI: SIMULATED';
}

function wireAISettings(app) {
  updateAILabel(app);
  app.querySelector('#aiSettingsBtn')?.addEventListener('click', () => openAISettingsModal(app));
}

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
  modal.querySelector('#aiModalClose').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#aiKeyClear').onclick = () => {
    setStoredKey('');
    updateAILabel(app);
    toast.info('OpenRouter key cleared — back to simulated reasoning', { title: 'AI settings', durationMs: 3000 });
    close();
  };
  modal.querySelector('#aiKeySave').onclick = () => {
    const input = modal.querySelector('#aiKeyInput');
    const value = input.value.trim();
    if (value && !value.startsWith('••')) {
      setStoredKey(value);
      toast.success('Live AI enabled — scenarios now reason via OpenRouter', { title: 'AI settings', durationMs: 3500 });
    }
    updateAILabel(app);
    close();
  };
}

function wireScenarioPicker(app) {
  const picker = app.querySelector('#agentPicker');
  const stream = app.querySelector('#agentStream');
  const phase = app.querySelector('#agentPhase');
  const timer = app.querySelector('#agentTimer');
  const footer = app.querySelector('#agentFooter');
  const confidenceFill = app.querySelector('#agentConfidenceFill');
  const confidenceVal = app.querySelector('#agentConfidenceVal');

  picker.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-scenario]');
    if (!btn) return;
    picker.querySelectorAll('.agent-pick').forEach((b) => b.classList.toggle('is-active', b === btn));
    const id = btn.dataset.scenario;

    // Reset UI
    stream.innerHTML = '';
    footer.hidden = true;
    phase.textContent = 'RUNNING';
    phase.className = 'agent-console__phase agent-console__phase--running';
    const startTs = performance.now();
    timer.textContent = '0 ms';
    const timerInt = setInterval(() => {
      timer.textContent = `${Math.round(performance.now() - startTs)} ms`;
    }, 50);

    // Compute proposal
    let proposal;
    try {
      proposal = await agent.runScenario(id);
    } catch (e) {
      clearInterval(timerInt);
      phase.textContent = 'ERROR';
      phase.className = 'agent-console__phase agent-console__phase--alert';
      stream.innerHTML = `<div class="agent-console__error">${e.message}</div>`;
      return;
    }

    // Animate the reasoning chain
    let cancelled = false;
    abortRun = () => { cancelled = true; };

    for (let i = 0; i < proposal.chain.length; i++) {
      if (cancelled) break;
      const step = proposal.chain[i];
      phase.textContent = step.phase;
      phase.className = 'agent-console__phase agent-console__phase--running';
      const stepEl = renderStep(step);
      stream.appendChild(stepEl);
      stepEl.classList.add('is-entering');
      requestAnimationFrame(() => stepEl.classList.add('is-shown'));
      stream.scrollTop = stream.scrollHeight;
      await sleep(380);
    }

    if (cancelled) {
      clearInterval(timerInt);
      return;
    }

    // Final state — WAIT for operator
    phase.textContent = 'WAITING FOR OPERATOR';
    phase.className = 'agent-console__phase agent-console__phase--wait';
    clearInterval(timerInt);
    timer.textContent = `${Math.round(performance.now() - startTs)} ms`;

    // Confidence + actions
    confidenceFill.style.width = `${(proposal.confidence * 100).toFixed(0)}%`;
    confidenceVal.textContent = `${(proposal.confidence * 100).toFixed(0)}%`;
    footer.hidden = false;

    // Wire approve/reject/modify
    const approveBtn = app.querySelector('#agentApproveBtn');
    const rejectBtn = app.querySelector('#agentRejectBtn');
    const modifyBtn = app.querySelector('#agentModifyBtn');
    approveBtn.onclick = async () => {
      await agent.approve(proposal.id, 'demo-operator');
      toast.success('Proposal approved · burn queued', { title: 'Agent', durationMs: 3500 });
      bumpCounter('agentApproveCount');
      refreshAuditTable(app.querySelector('#auditTable'));
    };
    rejectBtn.onclick = () => {
      openRejectDialog(proposal, (reason) => {
        agent.reject(proposal.id, 'demo-operator', reason);
        toast.info('Proposal rejected', { title: 'Agent', durationMs: 3500 });
        bumpCounter('agentRejectCount');
        refreshAuditTable(app.querySelector('#auditTable'));
      });
    };
    modifyBtn.onclick = () => {
      const modal = app.querySelector('#proposalModal');
      const card = app.querySelector('#proposalCard');
      mountAgentPanel(card, proposal, {
        onClose: () => modal.classList.remove('is-show'),
        onApprove: async () => {
          await agent.approve(proposal.id, 'demo-operator');
          modal.classList.remove('is-show');
          toast.success('Modified proposal approved', { title: 'Agent', durationMs: 3500 });
          bumpCounter('agentApproveCount');
          refreshAuditTable(app.querySelector('#auditTable'));
        },
        onReject: (r) => {
          agent.reject(proposal.id, 'demo-operator', r);
          modal.classList.remove('is-show');
          toast.info('Proposal rejected', { title: 'Agent', durationMs: 3500 });
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
          <span class="proposal__chip">${proposal.satelliteId}</span>
          <span class="proposal__chip">${proposal.scenarioId}</span>
        </div>
        <div class="modal__proposal-title">${proposal.title}</div>
        <div class="modal__proposal-summary">${proposal.summary}</div>
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
  modal.querySelector('#rejectClose').onclick = close;
  modal.querySelector('#rejectCancel').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('#rejectConfirm').onclick = () => {
    const reason = modal.querySelector('#rejectReason').value.trim();
    close();
    onSubmit(reason);
  };
  setTimeout(() => modal.querySelector('#rejectReason')?.focus(), 100);
}

function renderText(s) {
  if (!s) return '';
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderStep(step) {
  const wrap = document.createElement('div');
  wrap.className = 'agent-step';
  const isLive = step.source === 'live-ai';
  wrap.innerHTML = `
    <div class="agent-step__head">
      <span class="agent-step__phase">${step.phase}</span>
      ${isLive ? `<span class="chain-step__source chain-step__source--live" title="Genuine LLM call via OpenRouter">LIVE AI · ${step.model || ''}</span>` : ''}
      <span class="agent-step__ts">+${Date.now() % 10000} ms</span>
    </div>
    <div class="agent-step__title">${renderText(step.title)}</div>
    <div class="agent-step__body">${renderText(step.body)}</div>
    ${renderStepData(step.data)}
  `;
  return wrap;
}

function renderStepData(data) {
  if (!data) return '';
  if (data.alternatives && Array.isArray(data.alternatives)) {
    return `
      <table class="agent-step__table">
        <thead><tr><th>Strategy</th><th>Δv</th><th>Fuel</th><th>Margin</th></tr></thead>
        <tbody>
          ${data.alternatives.map((alt) => `
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
        ${data.hypotheses.map((h) => `
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
        ${data.options.map((o) => `
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

function bumpCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(Number(el.textContent || '0') + 1);
}

function updateChainStatus() {
  const len = document.getElementById('chainLen');
  if (len) len.textContent = String(audit.all().length);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mountSideNav(host) {
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
    <div class="agent-audit__rows">
      ${entries.map((e) => `
        <div class="agent-audit__row">
          <div class="agent-audit__seq">#${String(e.seq).padStart(3, '0')}</div>
          <div class="agent-audit__time">${new Date(e.ts).toLocaleTimeString()}</div>
          <div class="agent-audit__actor">${e.actor}</div>
          <div class="agent-audit__action">${e.action}</div>
          <div class="agent-audit__hash">${e.hash.slice(0, 12)}…${e.hash.slice(-6)}</div>
        </div>
      `).join('')}
    </div>
  `;
}