// @ts-check
/**
 * Pricing page — indicative tiers for the planned managed service.
 *
 * Honesty contract: the core is an MIT-licensed open-source demo.
 * No managed service, pilot fleet, or compliance certification exists
 * yet — anything unshipped is marked PLANNED, and all contact routes
 * go through the public GitHub repository.
 */

'use strict';

import { mountAmbient } from '../ui/ambient.js';
import { getBackendConfig, BackendClient } from '../core/backend-client.js';

const GITHUB_URL = 'https://github.com/veter391/orbitops';

/** @param {HTMLElement} app */
export async function mount(app) {
  injectMiscV3();
  app.innerHTML = `
    <main class="pricing-page chrome-grain">
      <!-- page-unique ambient event: rare comet streak (~every 92 s, CSS-only) -->
      <div class="pricing-comet" aria-hidden="true"></div>

      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <span class="eyebrow">PRICING</span>
          <h1 class="page-header__title">Per satellite. Not per seat.</h1>
          <p class="page-header__sub">
            The core engine is open source and free to self-host today. We
            haven't set managed-service pricing yet — because we haven't decided
            whether to build it. That's your call: tell us what's worth shipping.
          </p>
        </div>
      </header>

      <section class="pricing-tiers">
        <div class="container">

          <div class="free-tier hover-lift" data-float>
            <div class="free-tier__badge">OPEN SOURCE · FREE FOREVER</div>
            <div class="free-tier__grid">
              <div class="free-tier__price">
                <div class="free-tier__num">$0</div>
                <div class="free-tier__unit">MIT core · self-host · forever</div>
              </div>
              <ul class="free-tier__features">
                <li>Full MIT-licensed core — cockpit, agent console, audit log, flight tools</li>
                <li>Every feature in this demo, no gating, no trial clock</li>
                <li>Self-host as a static site — no signup, no keys, no backend</li>
                <li>Optional live AI: bring your own OpenRouter key, free-tier models by default</li>
              </ul>
              <div class="free-tier__cta">
                <a href="/docs" data-route="/docs" class="btn btn--primary">GET STARTED →</a>
                <a href="${GITHUB_URL}" target="_blank" rel="noreferrer" class="free-tier__source">Source on GitHub ↗</a>
                <span class="free-tier__note">This is what exists today.</span>
              </div>
            </div>
          </div>

          <div class="tiers-planned-head" data-float>
            <span class="eyebrow">MANAGED SERVICE · UNDECIDED</span>
            <p class="tiers-planned-sub">Tiers we're considering for a hosted service. No pricing set, nothing shipped — help us decide what (if anything) to build.</p>
          </div>

          <div class="tiers-grid">

            <div class="tier" data-float>
              <div class="tier__name">Pilot</div>
              <div class="tier__desc">For evaluating OrbitOps on a single constellation or slice</div>
              <div class="tier__price tier__price--ask">
                <!-- price parked pending demand validation: $2,500 per satellite / month -->
                <div class="tier__q" aria-hidden="true">?</div>
                <div class="tier__q-sub">Pricing isn't set yet. Should this tier exist?</div>
              </div>
              <ul class="tier__features">
                <li>Up to 5 satellites</li>
                <li>Web cockpit + agent + audit log</li>
                <li>Email support · 24h SLA</li>
                <li>Single-tenant data plane</li>
                <li>Self-host or managed</li>
              </ul>
              <div class="tier__cta">
                <button class="btn btn--ask" type="button" data-ask>Should we build this? →</button>
                <a href="${GITHUB_URL}" target="_blank" rel="noreferrer" class="tier__watch">Watch on GitHub ↗</a>
              </div>
            </div>

            <div class="tier" data-float>
              <div class="tier__name">Growth</div>
              <div class="tier__desc">For commercial constellations ready to put the agent on shift</div>
              <div class="tier__price tier__price--ask">
                <!-- price parked pending demand validation: $2,000 per satellite / month -->
                <div class="tier__q" aria-hidden="true">?</div>
                <div class="tier__q-sub">Pricing isn't set yet. Should this tier exist?</div>
              </div>
              <ul class="tier__features">
                <li>Up to 50 satellites</li>
                <li>Everything in Pilot, plus:</li>
                <li>Slack + PagerDuty integration <span class="planned-chip">PLANNED</span></li>
                <li>Custom scenarios (up to 10)</li>
                <li>Priority support · 4h SLA</li>
              </ul>
              <div class="tier__roadmap">
                <div class="tier__roadmap-head">Roadmap</div>
                <ul>
                  <li>LeoLabs + 18 SDS integration <span class="planned-chip">PLANNED</span></li>
                  <li>SOC 2 Type I <span class="planned-chip">PLANNED</span></li>
                </ul>
              </div>
              <div class="tier__cta">
                <button class="btn btn--ask" type="button" data-ask>Should we build this? →</button>
                <a href="${GITHUB_URL}" target="_blank" rel="noreferrer" class="tier__watch">Watch on GitHub ↗</a>
              </div>
            </div>

            <div class="tier" data-float>
              <div class="tier__name">Mega</div>
              <div class="tier__desc">For megaconstellations at scale — Starlink-class operators</div>
              <div class="tier__price tier__price--ask">
                <!-- price parked pending demand validation: $1,500 per satellite / month -->
                <div class="tier__q" aria-hidden="true">?</div>
                <div class="tier__q-sub">Pricing isn't set yet. Should this tier exist?</div>
              </div>
              <ul class="tier__features">
                <li>500+ satellites</li>
                <li>Everything in Growth, plus:</li>
                <li>On-premise deployment</li>
                <li>Unlimited scenarios</li>
                <li>Dedicated CSM · 1h SLA</li>
              </ul>
              <div class="tier__roadmap">
                <div class="tier__roadmap-head">Roadmap</div>
                <ul>
                  <li>SOC 2 Type II <span class="planned-chip">PLANNED</span></li>
                  <li>FAA / FCC compliance exports <span class="planned-chip">PLANNED</span></li>
                  <li>Custom LLM fine-tuning <span class="planned-chip">PLANNED</span></li>
                </ul>
              </div>
              <div class="tier__cta">
                <button class="btn btn--ask" type="button" data-ask>Should we build this? →</button>
                <a href="${GITHUB_URL}" target="_blank" rel="noreferrer" class="tier__watch">Watch on GitHub ↗</a>
              </div>
            </div>

          </div>

          <p class="pricing-note">
            No managed-service pricing is set — these tiers are proposals, not offers.
            The core is MIT-licensed and free to self-host. Tap <em>Should we build this?</em>
            to weigh in.
          </p>
        </div>
      </section>

      <section class="pricing-selfhost">
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">SELF-HOST</span>
            <h2 class="section__title">Self-host in 60 seconds.</h2>
          </header>

          <div class="selfhost-console hover-lift" data-float>
            <div class="selfhost-console__bar">
              <span class="selfhost-console__title">STATIC BUNDLE · NO BUILD · DEPLOY ANYWHERE</span>
              <button class="selfhost-console__copy" id="selfhostCopy" type="button" aria-label="Copy quick start command">COPY</button>
            </div>
            <pre class="selfhost-console__code"><code><span class="selfhost-console__ps" aria-hidden="true">$</span> npx create-orbitops@latest my-ops
<span class="selfhost-console__ps" aria-hidden="true">$</span> cd my-ops &amp;&amp; npm start</code></pre>
            <div class="selfhost-console__tag">one command, any OS · ships with the open-source release · no signup · no keys · deploy anywhere</div>
          </div>
        </div>
      </section>

      <section class="pricing-faq">
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">TRANSMISSION LOG</span>
            <h2 class="section__title">Common questions.</h2>
          </header>

          <div class="tx-log" data-float>
            <details class="tx-item" open>
              <summary class="tx-item__q">
                <span class="tx-item__caret" aria-hidden="true">▸</span>
                <span class="tx-item__cmd" aria-hidden="true">QUERY:</span>
                Why per-satellite instead of per-seat?
              </summary>
              <div class="tx-item__a">
                <span class="tx-item__resp" aria-hidden="true">RESPONSE //</span>
                <p>Flight dynamics teams are small by design — usually 3–10 people per
                constellation. Per-seat pricing penalises automation: the better the
                agent does, the less you pay. Per-satellite aligns incentives:
                pricing tracks the fleet under monitoring, not the humans watching it.</p>
              </div>
            </details>

            <details class="tx-item">
              <summary class="tx-item__q">
                <span class="tx-item__caret" aria-hidden="true">▸</span>
                <span class="tx-item__cmd" aria-hidden="true">QUERY:</span>
                Can we self-host?
              </summary>
              <div class="tx-item__a">
                <span class="tx-item__resp" aria-hidden="true">RESPONSE //</span>
                <p>Yes — and today that is the only option. The core (agent loop,
                anomaly detector, manoeuvre planner, audit log, orbit propagator)
                is MIT-licensed: clone the repository and serve it as a static
                site. The managed service described on this page is planned but
                not yet available.</p>
              </div>
            </details>

            <details class="tx-item">
              <summary class="tx-item__q">
                <span class="tx-item__caret" aria-hidden="true">▸</span>
                <span class="tx-item__cmd" aria-hidden="true">QUERY:</span>
                What does the agent actually do autonomously?
              </summary>
              <div class="tx-item__a">
                <span class="tx-item__resp" aria-hidden="true">RESPONSE //</span>
                <p>Nothing. The agent proposes, the human approves. Every action goes
                through the audit log with full reasoning chain. You can read every
                decision, override every recommendation, and export the full audit
                trail.</p>
              </div>
            </details>

            <details class="tx-item">
              <summary class="tx-item__q">
                <span class="tx-item__caret" aria-hidden="true">▸</span>
                <span class="tx-item__cmd" aria-hidden="true">QUERY:</span>
                How accurate is the anomaly detection?
              </summary>
              <div class="tx-item__a">
                <span class="tx-item__resp" aria-hidden="true">RESPONSE //</span>
                <p>We don't publish accuracy numbers, because there is no pilot fleet
                yet. In this open-source demo the detector (Welford online
                statistics) runs on simulated telemetry. Real precision and
                lead-time figures will only be published once measured on real
                missions.</p>
              </div>
            </details>

            <details class="tx-item">
              <summary class="tx-item__q">
                <span class="tx-item__caret" aria-hidden="true">▸</span>
                <span class="tx-item__cmd" aria-hidden="true">QUERY:</span>
                What's the migration path from our existing ops stack?
              </summary>
              <div class="tx-item__a">
                <span class="tx-item__resp" aria-hidden="true">RESPONSE //</span>
                <p>Today OrbitOps is an open-source demo you can run in a browser in
                minutes. The managed service that would sit alongside an existing
                MOC — telemetry in via WebSocket, actions out via your commanding
                path — is planned, not shipped. There are no live pilots yet.</p>
              </div>
            </details>
          </div>
        </div>
      </section>

      <section class="pricing-contact">
        <div class="container">
          <div class="mission-panel hover-lift" data-float>
            <div class="mission-panel__sig" aria-hidden="true">TX · OPEN CHANNEL</div>
            <h2 class="mission-panel__title">Join the mission.</h2>
            <p class="mission-panel__line">
              OrbitOps is built in the open — no sales team, no demo call.
              Questions, bug reports, and pilot interest all route through the
              public repository.
            </p>
            <div class="mission-panel__row">
              <a class="mission-panel__link" href="${GITHUB_URL}" target="_blank" rel="noreferrer">github.com/veter391/orbitops ↗</a>
              <a class="mission-panel__link" href="${GITHUB_URL}/issues" target="_blank" rel="noreferrer">/issues — bugs &amp; ideas ↗</a>
              <a class="mission-panel__link" href="https://github.com/sponsors/veter391" target="_blank" rel="noreferrer">♥ sponsor the project ↗</a>
              <span class="mission-panel__chip">MIT LICENSE</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  const sideNavEl = app.querySelector('#sideNav');
  if (sideNavEl) sideNavEl.innerHTML = SIDE_NAV('pricing');

  // Ambient space layer — starfield + drifting hairline station.
  const ambient = mountAmbient(/** @type {HTMLElement} */ (app.querySelector('.pricing-page')), { object: 'station' });

  // Tiers and panels float in with staggered depth as they enter the
  // viewport (once each); the tx-log reveal also fires the one-time
  // type-in carets on the transmission-log questions (CSS).
  const floatIo = setupFloatReveals(app);

  // Self-host copy chip — copies the one-line quick start
  const copyBtn = app.querySelector('#selfhostCopy');
  if (copyBtn) {
    const cmd = 'npx create-orbitops@latest my-ops && cd my-ops && npm start';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        copyBtn.textContent = 'COPIED';
      } catch {
        copyBtn.textContent = 'COPY FAILED';
      }
      setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1600);
    });
  }

  // "Should we build this?" — a lightweight per-tier demand-validation brief.
  // Delegated so it survives the float-reveal DOM and needs one listener.
  /** @type {Array<() => void>} */
  const askCleanups = [];
  const tiersGrid = app.querySelector('.tiers-grid');
  if (tiersGrid) {
    /** @param {Event} e */
    const onAsk = (e) => {
      const btn = /** @type {Element} */ (e.target).closest('[data-ask]');
      if (!btn) return;
      const tier = btn.closest('.tier')?.querySelector('.tier__name')?.textContent?.trim() || 'Any';
      askCleanups.push(openBuildFeedback(tier));
    };
    tiersGrid.addEventListener('click', onAsk);
    askCleanups.push(() => tiersGrid.removeEventListener('click', onAsk));
  }

  return {
    unmount() {
      if (floatIo) floatIo.disconnect();
      askCleanups.forEach((fn) => fn());
      ambient.unmount();
    },
  };
}

/**
 * Demand-validation brief for a managed tier. Pricing isn't set; instead of a
 * number the operator tells us whether the tier is worth building. On submit it
 * composes a pre-filled GitHub issue (the repo's single, honest contact route) —
 * nothing is collected in the browser.
 * @param {string} tierName
 * @returns {() => void} cleanup that closes/removes the modal
 */
function openBuildFeedback(tierName) {
  const tiers = ['Pilot', 'Growth', 'Mega', 'Any'];
  const modal = document.createElement('div');
  modal.className = 'ask-modal';
  modal.innerHTML = `
    <div class="ask-modal__panel" role="dialog" aria-modal="true" aria-labelledby="askTitle">
      <button class="ask-modal__close" id="askClose" type="button" aria-label="Close">✕</button>
      <span class="ask-modal__eyebrow">SHAPE THE ROADMAP</span>
      <h3 class="ask-modal__title" id="askTitle">Is the ${tierName} tier worth building?</h3>
      <p class="ask-modal__lead">
        There's no managed service yet — and no pricing. ~20 seconds of signal
        decides what we build next. This opens a pre-filled GitHub issue; nothing
        is stored in this browser.
      </p>
      <div class="ask-field">
        <label class="ask-label" for="askTier">Tier</label>
        <select id="askTier" class="ask-input">
          ${tiers.map((t) => `<option value="${t}" ${t === tierName ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="ask-field">
        <span class="ask-label">Do you want a hosted (cloud) version?</span>
        <div class="ask-chips" id="askCloud">
          <button type="button" class="ask-chip is-active" data-v="Yes, hosted">Yes, hosted</button>
          <button type="button" class="ask-chip" data-v="Self-host only">Self-host only</button>
          <button type="button" class="ask-chip" data-v="Not sure">Not sure</button>
        </div>
      </div>
      <div class="ask-field">
        <label class="ask-label" for="askFleet">Fleet size <span class="ask-opt">(optional)</span></label>
        <input id="askFleet" class="ask-input" type="text" inputmode="numeric" placeholder="e.g. 40 satellites" autocomplete="off" />
      </div>
      <div class="ask-field">
        <label class="ask-label" for="askNote">Anything else? <span class="ask-opt">(optional)</span></label>
        <textarea id="askNote" class="ask-input ask-textarea" rows="3" placeholder="What would make this a yes for you?"></textarea>
      </div>
      <div class="ask-actions">
        <button class="btn btn--primary" id="askSubmit" type="button">Open a GitHub issue →</button>
        <span class="ask-note">A pre-filled issue opens in a new tab — edit before you post.</span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let cloud = 'Yes, hosted';
  const chipWrap = /** @type {HTMLElement} */ (modal.querySelector('#askCloud'));
  chipWrap.addEventListener('click', (e) => {
    const chip = /** @type {Element} */ (e.target).closest('.ask-chip');
    if (!chip) return;
    chipWrap.querySelectorAll('.ask-chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    cloud = chip.getAttribute('data-v') || cloud;
  });

  let closed = false;
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    modal.remove();
  };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('#askClose')?.addEventListener('click', close);

  /** Swap the panel to a brief thank-you, then auto-close. @param {string} msg */
  const showThanks = (msg) => {
    const panel = modal.querySelector('.ask-modal__panel');
    if (panel) {
      panel.innerHTML = `
        <div class="ask-thanks">
          <div class="ask-thanks__mark" aria-hidden="true">✓</div>
          <h3 class="ask-modal__title">Signal received</h3>
          <p class="ask-modal__lead">${msg}</p>
        </div>`;
    }
    setTimeout(close, 1800);
  };

  const submitBtn = /** @type {HTMLButtonElement|null} */ (modal.querySelector('#askSubmit'));
  submitBtn?.addEventListener('click', async () => {
    const tier = /** @type {HTMLSelectElement} */ (modal.querySelector('#askTier')).value;
    const fleet = /** @type {HTMLInputElement} */ (modal.querySelector('#askFleet')).value.trim();
    const note = /** @type {HTMLTextAreaElement} */ (modal.querySelector('#askNote')).value.trim();

    // Prefer the real backend (a durable feedback table the owner reads) when
    // one is configured; fall back to a pre-filled GitHub issue otherwise, so
    // this works today with no deployed backend and upgrades cleanly once one is.
    const cfg = getBackendConfig();
    if (cfg.url) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      try {
        await new BackendClient(cfg).submitFeedback({
          kind: 'pricing',
          source: 'pricing-page',
          tier,
          wantsCloud: cloud,
          fleetSize: fleet,
          note,
        });
        showThanks('Logged to the backend — thank you for shaping the roadmap.');
        return;
      } catch {
        // Backend unreachable — fall through to the GitHub route.
        submitBtn.disabled = false;
        submitBtn.textContent = 'Open a GitHub issue →';
      }
    }

    const title = `Pricing feedback: ${tier} tier`;
    const body = [
      `**Tier:** ${tier}`,
      `**Hosted (cloud) version wanted:** ${cloud}`,
      `**Fleet size:** ${fleet || '—'}`,
      '',
      '**What would make this worth building:**',
      note || '—',
      '',
      '---',
      '_Sent from the OrbitOps pricing page · demand validation_',
    ].join('\n');
    const url = `${GITHUB_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('pricing-feedback')}`;
    window.open(url, '_blank', 'noopener');
    close();
  });

  setTimeout(() => /** @type {HTMLElement|null} */ (modal.querySelector('#askTier'))?.focus(), 60);
  return close;
}

/**
 * Float-in reveals — every [data-float] block rises with depth (scale
 * 0.97→1, y 24→0, styled in misc-v3.css) the first time it enters the
 * viewport. Once-only: targets are unobserved after revealing.
 * @returns {IntersectionObserver|null}
 */
/** @param {HTMLElement} app */
function setupFloatReveals(app) {
  const targets = app.querySelectorAll('[data-float]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('is-float'));
    return null;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-float');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  targets.forEach((t) => io.observe(t));
  return io;
}

/** Inject the shared v3 stylesheet for TOOLS/PRICING/DOCS exactly once. */
function injectMiscV3() {
  if (document.getElementById('misc-v3')) return;
  const link = document.createElement('link');
  link.id = 'misc-v3';
  link.rel = 'stylesheet';
  link.href = '/src/styles/misc-v3.css';
  document.head.appendChild(link);
}

/** @param {string} active */
function SIDE_NAV(active) {
  const items = [
    { id: 'home', label: 'HOME', path: '/' },
    { id: 'cockpit', label: 'COCKPIT', path: '/cockpit' },
    { id: 'agent', label: 'AGENT', path: '/agent' },
    { id: 'dashboard', label: 'DASHBOARD', path: '/dashboard' },
    { id: 'tools', label: 'TOOLS', path: '/tools' },
    { id: 'pricing', label: 'PRICING', path: '/pricing' },
    { id: 'docs', label: 'DOCS', path: '/docs' },
  ];
  return items.map((i) => `
    <a href="${i.path}" data-route="${i.path}" class="side-nav__item ${i.id === active ? 'is-active' : ''}" title="${i.label}">
      <span class="side-nav__dot"></span>
      <span class="side-nav__label">${i.label}</span>
    </a>
  `).join('');
}
