// @ts-check
/**
 * Docs page — documentation portal, rendered as a file console.
 *
 * Honesty contract: every command, import path, and architecture claim
 * in these docs describes the REAL current codebase — a no-build vanilla
 * JS static site. Unshipped capabilities live in the "Planned" doc and
 * are explicitly marked PLANNED. Legal docs are restyled as a policy
 * console — the policy text itself is unchanged.
 */

'use strict';

import { mountAmbient } from '../ui/ambient.js';

const GITHUB_URL = 'https://github.com/veter391/orbitops';

/** Docs rendered as POLICY:// consoles with §-numbered sections. */
const LEGAL_IDS = new Set(['terms', 'privacy', 'datapolicy']);

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @param {HTMLElement} app */
export async function mount(app) {
  injectMiscV3();
  app.innerHTML = `
    <main class="docs-page chrome-grain">
      <!-- depth layer 2: static faint hairline grid (ambient stars parallax above it) -->
      <div class="docs-depth" aria-hidden="true"></div>

      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <span class="eyebrow">DOCUMENTATION</span>
          <h1 class="page-header__title">Engineer docs.</h1>
          <p class="page-header__sub">
            Everything you need to run, read, and extend the OrbitOps
            open-source demo. MIT-licensed. No build step.
          </p>
        </div>
      </header>

      <section class="docs-layout">
        <div class="container">
          <div class="docs-grid">

            <aside class="docs-sidebar">
              <div class="docs-sidebar__root" style="--tree-d: 0s">
                <span class="docs-beacon" aria-hidden="true"></span>ROOT://ORBITOPS
              </div>
              ${sidebarGroupHtml('getting-started', 'Getting started', [
                ['quickstart', 'Quick start'],
                ['going-live', 'Going live · connect'],
                ['arch', 'Architecture'],
                ['accuracy', 'Data sources & accuracy'],
              ], 0)}
              ${sidebarGroupHtml('core-modules', 'Core modules', [
                ['propagator', 'Orbit propagator'],
                ['anomaly', 'Anomaly detector'],
                ['maneuver', 'Manoeuvre planner'],
                ['audit', 'Audit log'],
              ], 1)}
              ${sidebarGroupHtml('ai-agent', 'AI agent', [
                ['scenarios', 'Pre-built scenarios'],
                ['custom', 'Custom scenarios'],
                ['llm', 'LLM integration'],
              ], 2)}
              ${sidebarGroupHtml('project', 'Project', [
                ['contributing', 'Contributing'],
                ['planned', 'Roadmap &amp; planned'],
              ], 3)}
              ${sidebarGroupHtml('legal', 'Legal', [
                ['terms', 'Terms of Use'],
                ['privacy', 'Privacy &amp; GDPR'],
                ['datapolicy', 'Data policy'],
              ], 4)}
            </aside>

            <article class="docs-content">
              <div class="docs-statusbar">
                <span class="docs-statusbar__crumb" id="docsCrumb">DOC://QUICKSTART</span>
                <span class="docs-statusbar__meta">ORBITOPS · v0.1.0 · MIT · NO BUILD</span>
              </div>
              <div class="docs-body" id="docsContent"></div>
            </article>
          </div>
        </div>
      </section>
    </main>
  `;

  const sideNavEl = app.querySelector('#sideNav');
  if (sideNavEl) sideNavEl.innerHTML = SIDE_NAV('docs');

  // Ambient space layer — starfield + drifting hairline station, low density
  // so the console stays legible. Grain comes from chrome-grain on the root.
  const ambient = mountAmbient(/** @type {HTMLElement} */ (app.querySelector('.docs-page')), { object: 'station', density: 0.6 });

  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  /** @param {() => void} fn @param {number} ms */
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  // FILE:// tree draws in on mount (staggered fade + x, once). The class is
  // added after a paint so the animation actually runs; under reduced motion
  // the hidden states never apply (CSS-gated) and this is a harmless no-op.
  const sidebar = app.querySelector('.docs-sidebar');
  let treeRaf = 0;
  if (sidebar) {
    treeRaf = requestAnimationFrame(() => {
      treeRaf = requestAnimationFrame(() => sidebar.classList.add('is-drawn'));
    });
  }

  const docLinks = app.querySelectorAll('.docs-sidebar__link');
  const article = /** @type {HTMLElement} */ (app.querySelector('.docs-content'));
  const content = /** @type {HTMLElement} */ (app.querySelector('#docsContent'));
  const crumb = /** @type {HTMLElement} */ (app.querySelector('#docsCrumb'));

  /** Render a doc: crumb, legal console mode, code chrome, fade+rise (200 ms). @param {string} id */
  function renderDoc(id) {
    const realId = DOCS[id] ? id : 'quickstart';
    const isLegal = LEGAL_IDS.has(realId);
    crumb.textContent = `${isLegal ? 'POLICY' : 'DOC'}://${realId.toUpperCase()}`;

    const paint = () => {
      content.classList.toggle('docs-body--legal', isLegal);
      content.innerHTML = DOCS[realId];
      decorateCodeBlocks(content, later);
      if (prefersReduced()) {
        content.classList.add('is-in');
      } else {
        // force a style flush so the 200 ms fade+rise transition runs
        void content.offsetWidth;
        content.classList.add('is-in');
      }
    };

    if (prefersReduced() || !content.classList.contains('is-in')) {
      content.classList.remove('is-in');
      paint();
    } else {
      content.classList.remove('is-in');
      later(paint, 130); // let the outgoing doc fade before the new one rises
    }
  }

  /** Sidebar active state + render + keep the console in view on mobile.
   * @param {string} id @param {{scroll?: boolean}} [opts] */
  function openDoc(id, { scroll = true } = {}) {
    docLinks.forEach((x) => x.classList.toggle('is-active', /** @type {HTMLElement} */ (x).dataset.doc === id));
    renderDoc(id);
    if (scroll) {
      const top = article.getBoundingClientRect().top;
      if (top < 0) {
        window.scrollTo({ top: window.scrollY + top - 84, behavior: prefersReduced() ? 'auto' : 'smooth' });
      }
    }
  }

  // Doc nav. Legal deep links from the footer arrive as /docs/terms,
  // /docs/privacy, /docs/data (registered as routes in main.js) — resolve
  // the sub-path to its doc id, otherwise open the quick start.
  /** @type {Record<string, string>} */
  const LEGAL_ROUTE_DOC = {
    '/docs/terms': 'terms',
    '/docs/privacy': 'privacy',
    '/docs/data': 'datapolicy',
    '/docs/going-live': 'going-live',
  };
  openDoc(LEGAL_ROUTE_DOC[window.location.pathname] || 'quickstart', { scroll: false });

  docLinks.forEach((l) => {
    l.addEventListener('click', () => {
      const doc = /** @type {HTMLElement} */ (l).dataset.doc;
      if (doc) openDoc(doc);
    });
  });

  // Cross-links inside doc bodies (e.g. "Architecture overview →") switch
  // docs in place instead of falling through to the hash router.
  content.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-doc]');
    if (!link || !content.contains(link)) return;
    e.preventDefault();
    const doc = /** @type {HTMLElement} */ (link).dataset.doc;
    if (doc) openDoc(doc, { scroll: false });
    window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
  });

  return {
    unmount() {
      if (treeRaf) cancelAnimationFrame(treeRaf);
      ambient.unmount();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    },
  };
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

/**
 * Sidebar group: mono FILE:// header + hairline tree of doc buttons.
 * groupIdx feeds the mount draw-in stagger (--tree-d is animation-delay
 * only, so hover transitions stay instant — see misc-v3.css).
 */
/** @param {string} slug @param {string} _label @param {[string, string][]} entries @param {number} [groupIdx] */
function sidebarGroupHtml(slug, _label, entries, groupIdx = 0) {
  const headDelay = 80 + groupIdx * 110;
  return `
    <div class="docs-sidebar__group">
      <div class="docs-sidebar__head" style="--tree-d: ${headDelay}ms"><span class="docs-sidebar__proto">FILE://</span>${slug}</div>
      <div class="docs-sidebar__tree">
        ${entries.map(([id, label], i) => `
          <button type="button" class="docs-sidebar__link" data-doc="${id}" style="--tree-d: ${headDelay + 50 + i * 45}ms">${label}</button>`).join('')}
      </div>
    </div>`;
}

/**
 * Wrap each pre.code in console chrome: a mono header strip naming the block
 * plus a COPY chip wired to the clipboard.
 */
/** @param {HTMLElement} content @param {(fn: () => void, ms: number) => void} later */
function decorateCodeBlocks(content, later) {
  content.querySelectorAll('pre.code').forEach((pre) => {
    const codeText = pre.textContent || '';
    const label = codeText.trimStart().startsWith('git ') || /python -m|^cd |\ncd /.test(codeText)
      ? 'SHELL'
      : /(^|\n)\s*import /.test(codeText) ? 'ES MODULE' : 'CODE';

    const shell = document.createElement('div');
    shell.className = 'docs-code';
    const bar = document.createElement('div');
    bar.className = 'docs-code__bar';
    bar.innerHTML = `
      <span class="docs-code__lang">${label}</span>
      <button type="button" class="docs-code__copy" aria-label="Copy code block">COPY</button>`;
    pre.replaceWith(shell);
    shell.append(bar, pre);

    const btn = bar.querySelector('.docs-code__copy');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        btn.textContent = 'COPIED';
        btn.classList.add('is-done');
      } catch {
        btn.textContent = 'FAILED';
      }
      later(() => { btn.textContent = 'COPY'; btn.classList.remove('is-done'); }, 1400);
    });
  });
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

/**
 * Legal doc header: POLICY CONSOLE strip — mono key-fact chips + an honest
 * three-line TL;DR. Presentation only; the policy body below is unchanged.
 */
/** @param {string[]} chips @param {string[]} tldr */
function policyConsoleHtml(chips, tldr) {
  return `
    <div class="docs-policy">
      <div class="docs-policy__head">POLICY CONSOLE</div>
      <div class="docs-policy__chips">
        ${chips.map((c) => `<span class="docs-policy__chip">${c}</span>`).join('')}
      </div>
      <div class="docs-policy__tldr">
        <span class="docs-policy__tldr-k">TL;DR</span>
        <ul>${tldr.map((t) => `<li>${t}</li>`).join('')}</ul>
      </div>
    </div>`;
}

/** @type {Record<string, string>} */
const DOCS = {
  quickstart: `<h1>Quick start</h1>
    <p>OrbitOps runs entirely in the browser — vanilla ES modules, no build step,
       no signup, no keys. Get your own copy running in under a minute.</p>

    <h2>Install <span class="doc-chip doc-chip--real">recommended</span></h2>
    <p>One command scaffolds and starts a local copy. Works on Linux, macOS and
       Windows (needs <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js</a>).</p>
    <pre class="code"><code>npx create-orbitops@latest my-ops
cd my-ops &amp;&amp; npm start</code></pre>
    <p>It prints a local URL — open it and you have the full system: cockpit,
       dashboard, agent, tools, settings. <span class="doc-chip doc-chip--planned">the installer ships with the open-source release</span></p>

    <h2>Deploy anywhere</h2>
    <p>The result is a static bundle — host it on Cloudflare Pages, Netlify,
       Vercel, GitHub Pages, or any static file server. No server-side runtime
       is required to run the app. The <strong>Node + TypeScript backend</strong>
       (<code>backend/</code>) is optional and additive: connect it in
       Settings → Connected Backend for live telemetry, the multi-agent copilot,
       and the tamper-evident audit chain. Hosted multi-tenant SSO/RBAC remains
       <strong>planned</strong>.</p>

    <h2>Run from source <span class="doc-chip">for contributors</span></h2>
    <p>Hacking on OrbitOps? Clone the repo and serve the folder — same code, no
       build:</p>
    <pre class="code"><code>git clone ${GITHUB_URL}
cd orbitops
npx serve .          # or: python -m http.server 8080</code></pre>
    <p>Open the URL it prints. See <a href="#" data-doc="contributing">Contributing</a>
       for the code layout and conventions.</p>

    <h2>What you get</h2>
    <ul>
      <li>3D cockpit rendering a live constellation (three.js, vendored)</li>
      <li>CelesTrak TLE data propagated with SGP4 via satellite.js (vendored)</li>
      <li>An AI agent walking deterministic reasoning chains, with optional live
          LLM reasoning via your own OpenRouter key</li>
      <li>SHA-256 hash-chained audit log, entirely in the browser</li>
      <li>A Settings console for keys, data sources and compute profiles</li>
    </ul>
    <h2>Next</h2>
    <ul>
      <li><a href="#" data-doc="arch">Architecture overview →</a></li>
      <li><a href="#" data-doc="accuracy">Data sources &amp; accuracy →</a></li>
      <li><a href="#" data-doc="propagator">Orbit propagator reference →</a></li>
    </ul>`,

  contributing: `<h1>Contributing</h1>
    <p>OrbitOps is open source (MIT) and built in the open. No build step, no
       framework, no ceremony — clone it, serve it, edit a file, refresh.</p>
    <h2>Run from source</h2>
    <pre class="code"><code>git clone ${GITHUB_URL}
cd orbitops
npx serve .          # or any static file server</code></pre>
    <h2>Code layout</h2>
    <ul>
      <li><code>src/main.js</code> — boot, hash-router registration, top nav</li>
      <li><code>src/pages/</code> — one module per route (home, cockpit, agent,
          dashboard, tools, pricing, docs, settings)</li>
      <li><code>src/core/</code> — the real engine: <code>sgp4.js</code>,
          <code>orbit-propagator.js</code>, <code>anomaly-detector.js</code>,
          <code>maneuver-planner.js</code>, <code>audit-log.js</code>,
          <code>model-routing.js</code>, <code>app-config.js</code></li>
      <li><code>src/ui/</code> — shared UI (cockpit, ambient layer, toasts)</li>
      <li><code>public/vendor/</code> — pinned copies of three.js, GSAP, Lenis,
          satellite.js (no CDN, no npm at runtime)</li>
    </ul>
    <h2>Conventions</h2>
    <ul>
      <li>Vanilla ES modules only — no build tooling in the shipped app.</li>
      <li>ESLint + Prettier configs are in the repo; keep the lint clean.</li>
      <li>Honesty rule: never show fabricated data. Real values are labelled
          <strong>REAL</strong>; anything backend-bound is <strong>PLANNED</strong>;
          simulated telemetry is labelled <strong>SIMULATED</strong>.</li>
    </ul>
    <p>Open an issue or PR on
       <a href="${GITHUB_URL}" target="_blank" rel="noreferrer">GitHub</a>.</p>`,

  'going-live': `<h1>Going live · connect a backend</h1>
    <p>OrbitOps runs a lot for real with <strong>zero setup</strong>: the live
       catalog, SGP4 propagation, conjunction &amp; Pc math, ground tracks, the
       manoeuvre tools, the deorbit bands and the in-browser audit chain are all
       real, computed on your machine. A few panels are marked
       <span class="doc-chip doc-chip--connect">CONNECT FOR LIVE</span> — they are
       real too, they just need a data source. Here is how to switch each on.</p>

    <h2>1 · Connect a backend <span class="doc-chip doc-chip--connect">CONNECT FOR LIVE</span></h2>
    <p>The open-source Node backend (<code>backend/</code>) powers the live
       conjunction triage queue, per-license deorbit compliance verdicts, real
       telemetry, and the tamper-evident HMAC audit chain. Run it locally with no
       external database:</p>
    <pre class="code"><code>cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev            # API on http://localhost:8790</code></pre>
    <p>Then open <strong>Settings → Connected Backend</strong>, set the URL
       (<code>http://localhost:8790</code>), paste your API key, switch the mode to
       <em>Connected</em>, and hit test. The dashboard's Conjunction Watch and
       Compliance Tracker, and the Agent's live triage queue, immediately fill with
       real backend output. Nothing about the offline demo changes — connected mode
       is purely additive.</p>

    <h2>2 · Stream your fleet's telemetry <span class="doc-chip doc-chip--connect">CONNECT FEED</span></h2>
    <p>No public feed exists for a satellite's internal health (battery, thermal,
       comms) — that data belongs to whoever operates the spacecraft. In the demo
       those readings are modelled and labelled. To see <em>live</em> readings in
       the cockpit, push your own fleet's telemetry to the connected backend:</p>
    <pre class="code"><code>POST /v1/telemetry
{ "satelliteId": "&lt;your-id&gt;", "ts": "&lt;iso&gt;", "metrics": { "batteryV": 27.4, ... } }</code></pre>
    <p>When the backend reports readings for the selected object (matched by NORAD
       id or name), the cockpit footer switches from the amber connect chip to a
       green <strong>LIVE</strong> readout.</p>

    <h2>3 · Turn on the AI advisory layer <span class="doc-chip doc-chip--connect">ADD A MODEL KEY</span></h2>
    <p>The agent's reasoning is deterministic and runs with no key
       (<strong>AI: MATH-ONLY</strong>). Add a model to layer an advisory note on
       top — it never changes a computed decision. Open the Agent page's AI button
       (or Settings → AI) and paste a key for any OpenAI-compatible provider:
       OpenRouter, OpenAI, xAI (Grok), Groq, or your own endpoint. Free tiers work.
       The key stays only in this browser and goes straight to your provider.</p>

    <h2>Prefer the full stack?</h2>
    <p>Self-host the whole thing — <code>npx create-orbitops@latest my-ops</code> —
       and everything above is wired locally out of the box. See
       <a href="#" data-doc="quickstart">Quick start</a> and
       <a href="#" data-doc="contributing">Contributing</a>.</p>`,

  accuracy: `<h1>Data sources &amp; accuracy</h1>
    <p>OrbitOps shows real orbital data wherever a public source exists, and
       labels everything else. This page states exactly where each number comes
       from and how far to trust it.</p>
    <h2>Orbital elements &mdash; CelesTrak</h2>
    <p>TLEs come from CelesTrak GP groups (starlink, oneweb, stations), fetched
       from your browser. CelesTrak refreshes on a ~2&#8209;hour cycle, so
       OrbitOps caches each group in localStorage for 2&nbsp;hours. The UI
       always shows which layer served the data: <strong>LIVE</strong> (just
       fetched) &middot; <strong>CACHED</strong> (a local copy younger than
       2h) &middot; <strong>SNAPSHOT</strong> (the bundled offline fallback).
       A SNAPSHOT badge means elements may be days old &mdash; positions stay
       mathematically real, but increasingly stale.</p>
    <h2>Propagation &mdash; SGP4, honestly bounded</h2>
    <p>All catalog positions use SGP4 (vendored satellite.js). What SGP4 does
       <em>not</em> give you:</p>
    <ul>
      <li><strong>Element-set age is the dominant error.</strong> Km-level when
          fresh, growing by kilometres per day; pass timings drift by minutes
          within days. The pass predictor prints the TLE epoch age for exactly
          this reason.</li>
      <li><strong>No manoeuvre knowledge.</strong> A satellite that burned
          after the TLE epoch is simply somewhere else.</li>
      <li><strong>Screening, not operations.</strong> Nothing here replaces
          operational conjunction assessment (CDMs, covariance, Pc). Demo
          mini-tools on the simplified Kepler engine are labelled on-page.</li>
    </ul>
    <p>Rule of thumb: good enough to point a camera or an antenna &mdash;
       verify with a fresh element set before pointing anything expensive.</p>
    <h2>What is simulated (and says so)</h2>
    <p>Per-satellite health telemetry and fuel have no public feed. Where
       shown, they are modelled values with a SIMULATED label. They never mix
       into real readouts.</p>
    <h2>Imagery credits</h2>
    <ul>
      <li>Earth landmass raster (particle continents): NASA Blue Marble /
          Visible Earth &mdash; used for geography sampling only; the
          photograph itself is never displayed.</li>
      <li>Country borders: public-domain world boundaries GeoJSON, rendered as
          hairline vectors.</li>
      <li>Everything else is drawn procedurally &mdash; no stock imagery.</li>
    </ul>
    <h2>Offline behaviour</h2>
    <p>With no network, OrbitOps falls back to the bundled TLE snapshot and
       marks every affected view SNAPSHOT. It never fabricates fresher data
       than it has.</p>`,
  arch: `<h1>Architecture</h1>
    <p>This describes the stack as it exists today — not a target state.</p>
    <h2>Current stack</h2>
    <ul>
      <li><strong>Frontend</strong> — vanilla JavaScript ES modules, hash-based router, no build step, no framework</li>
      <li><strong>3D</strong> — three.js, vendored locally under <code>/public/vendor</code></li>
      <li><strong>Orbital data</strong> — TLEs from CelesTrak, propagated with SGP4 via satellite.js (vendored)</li>
      <li><strong>Mini-tools</strong> — simplified Keplerian propagator (<code>src/core/orbit-propagator.js</code>) for interactive visualisation</li>
      <li><strong>Anomaly detection</strong> — Welford online statistics over simulated telemetry (<code>src/core/anomaly-detector.js</code>)</li>
      <li><strong>Audit log</strong> — SHA-256 hash-chained, append-only, runs in the browser (<code>src/core/audit-log.js</code>)</li>
      <li><strong>AI agent</strong> — deterministic reasoning chains (<code>src/scenarios/index.js</code>), optionally augmented by live LLM calls via OpenRouter</li>
    </ul>
    <h2>Backend <span class="doc-chip doc-chip--real">REAL · optional</span></h2>
    <p>The app runs fully client-side, and there is also a real
       <strong>Node&nbsp;+&nbsp;TypeScript backend</strong> (<code>backend/</code>,
       Fastify + pglite/Postgres): authenticated REST + WebSocket, real telemetry
       ingest, a LangGraph multi-agent copilot, and an HMAC-signed tamper-evident
       audit chain. It is optional and additive — connect it in
       <strong>Settings → Connected Backend</strong> (URL + key), or run it locally
       with <code>cd backend &amp;&amp; npm i &amp;&amp; npm run dev</code>. Hosted
       multi-tenant SSO/RBAC is <span class="planned-chip">PLANNED</span>. See
       <a href="#" data-doc="planned">Planned services</a>.</p>`,

  propagator: `<h1>Orbit propagator</h1>
    <p>Simplified Keplerian model used by the mini-tools. Suitable for
       visualisation and order-of-magnitude planning.</p>
    <h2>API</h2>
    <pre class="code"><code>import { propagate, propagateECI, closestApproach }
  from './src/core/orbit-propagator.js';

propagate(elements, t)                          // => Position {x,y,z,lat,lon,alt,vx,vy,vz}
propagateECI(elements, t)                       // => {x,y,z}
closestApproach(elA, elB, tStart, tEnd, stepSec) // => {tClosest, distanceKm}</code></pre>
    <h2>Accuracy</h2>
    <p>This is a simplified model, and even full TLE+SGP4 accuracy degrades over
       days — suitable for visualization, not operations. Do not use any
       propagator on this site for real conjunction screening or manoeuvre
       decisions.</p>`,

  anomaly: `<h1>Anomaly detector</h1>
    <p>Welford online statistics on per-satellite baselines, running over
       simulated telemetry in this demo.</p>
    <h2>Usage</h2>
    <pre class="code"><code>import { train, trainAll, detect, detectAll }
  from './src/core/anomaly-detector.js';

train(satellite, durationSec, sampleStepSec); // build a baseline
const anomalies = detect(satellite, t, telemetry);</code></pre>
    <h2>Anomaly types</h2>
    <ul>
      <li><strong>Point</strong> — single sample beyond 3σ</li>
      <li><strong>Contextual</strong> — within range but wrong context (e.g. low voltage during sun)</li>
      <li><strong>Collective</strong> — sequence of points trending toward failure</li>
    </ul>
    <p>No accuracy figures are published: the detector has only run on simulated
       telemetry, never on a real fleet.</p>`,

  maneuver: `<h1>Manoeuvre planner</h1>
    <p>Hohmann transfer approximation with Tsiolkovsky fuel calculation.</p>
    <h2>API</h2>
    <pre class="code"><code>import { avoidanceBurn, planAvoidance, findBurnWindows }
  from './src/core/maneuver-planner.js';

const burn = avoidanceBurn(elements, deltaAltKm);
// => { dvMs, fuelKg, durationSec, direction }</code></pre>
    <p>Educational-grade physics: correct in shape and order of magnitude, not
       flight-dynamics grade.</p>`,

  audit: `<h1>Audit log</h1>
    <p>SHA-256 hash-chained, append-only. Runs entirely in the browser in this
       demo.</p>
    <h2>API</h2>
    <pre class="code"><code>import { audit } from './src/core/audit-log.js';

await audit.append('operator-1', 'maneuver.approved', { satId, burn });
const valid = await audit.verify(); // walk the chain, detect tampering</code></pre>
    <h2>Export</h2>
    <pre class="code"><code>const json = audit.export(); // ISO 8601 timestamps, hash chain</code></pre>`,

  scenarios: `<h1>Pre-built scenarios</h1>
    <p>Five scenarios ship with the demo. Each is a complete deterministic
       reasoning chain grounded in the physics modules.</p>
    <h2>Included</h2>
    <ol>
      <li><strong>Conjunction alert</strong> — close approach detected, plan avoidance burn</li>
      <li><strong>Battery degradation</strong> — gradual voltage drop, plan intervention</li>
      <li><strong>Thermal anomaly</strong> — sudden temperature spike, mitigate before emergency</li>
      <li><strong>Commanded manoeuvre</strong> — operator requests orbit adjustment, plan and verify</li>
      <li><strong>Ground station handoff</strong> — current link degrading, plan transition</li>
    </ol>
    <h2>Running one</h2>
    <pre class="code"><code>import { agent, SCENARIOS } from './src/scenarios/index.js';

const proposal = await agent.runScenario('conjunction', { satelliteId: 'SAT-1' });
console.log(proposal.chain); // step-by-step reasoning</code></pre>`,

  custom: `<h1>Custom scenarios</h1>
    <p>Scenarios are plain async functions that return a proposal with a
       reasoning chain. Study the five built-ins in
       <code>src/scenarios/index.js</code> and follow the same shape:</p>
    <pre class="code"><code>{
  id: uid(),
  scenarioId: 'payload-degraded',
  satelliteId: ctx.satelliteId,
  title: '...',
  confidence: 0.85,
  chain: [ { phase: 'OBSERVE', title: '...', body: '...' }, /* ... */ ],
  action: 'payload.reconfigure',
  actionData: {},
  status: 'pending',
}</code></pre>
    <p>The chain phases (OBSERVE → ORIENT → DECIDE → …) drive the step-by-step
       playback on the Agent page.</p>`,

  llm: `<h1>LLM integration</h1>
    <p>The demo agent is deterministic by default. Optionally, it can layer live
       LLM reasoning on top via OpenRouter — using a key you provide, stored
       only in your browser's localStorage.</p>
    <h2>How it works</h2>
    <pre class="code"><code>import { setStoredKey, hasLiveAI } from './src/core/openrouter-client.js';
import { runLiveAgentPipeline } from './src/core/llm-agents.js';

setStoredKey('sk-or-...');  // stays in localStorage, never in source
hasLiveAI();                // => true

// The agent page calls this after the deterministic proposal is built.
// onStage flips the console phase; onToken streams each agent's narrative
// token-by-token into the console while it generates:
await runLiveAgentPipeline(scenarioTitle, proposal, alternatives, onStage, onToken);</code></pre>
    <p>The LLM never invents numbers — it interprets values already computed by
       the deterministic flight-dynamics code. Without a key, the agent falls
       back to the deterministic chains and everything still works.</p>`,

  planned: `<h1>Roadmap — shipped &amp; planned</h1>
    <p>This page keeps the line between product and plans explicit, so nobody
       mistakes one for the other — in either direction.</p>
    <h2>Backend — shipped</h2>
    <p>The backend is <strong>built and open source</strong> (Node + TypeScript,
       Fastify): authenticated REST + WebSocket API, telemetry ingest with
       time-bucket downsampling, a tamper-evident HMAC audit chain, multi-tenant
       isolation, and the LangGraph multi-agent copilot. The public demo runs it
       live behind this very site. See <a href="/docs/going-live" data-route="/docs/going-live">Going live</a>
       to connect your own.</p>
    <h2>Integrations <span class="planned-chip">PLANNED</span></h2>
    <ul>
      <li>Credentialed SSA feeds — Space-Track / LeoLabs / 18 SDS (the vendor-neutral ingest layer ships today; the paid-feed fetchers do not)</li>
      <li>Alert delivery — Slack / PagerDuty webhooks (the escalation policy engine ships today; delivery wiring does not)</li>
      <li>OpenMCT / Yamcs interop — OrbitOps as a copilot + audit layer on an existing C2 stack</li>
    </ul>
    <h2>Platform <span class="planned-chip">PLANNED</span></h2>
    <ul>
      <li>Managed hosted tier — durable multi-tenant Postgres, SSO/RBAC, encryption at rest</li>
      <li>Full 3D / Monte-Carlo probability of collision for slow or highly-curved encounters</li>
      <li>Fleet-wide ground-contact / pass-scheduling board</li>
    </ul>
    <p>Progress happens in the open — follow the
       <a href="${GITHUB_URL}" target="_blank" rel="noreferrer">GitHub repository</a>.</p>`,

  terms: `${policyConsoleHtml(
    ['MIT LICENSED', 'NO ACCOUNTS', 'NO PAYMENTS', 'NOT FOR REAL OPS'],
    [
      'Free, open-source demo — nothing on this site sells you anything.',
      'MIT license: use, copy, modify, redistribute; no warranty of any kind.',
      'Educational-grade physics — never use it for real flight decisions.',
    ]
  )}
    <h1>Terms of Use</h1>
    <p class="legal-updated">LAST UPDATED · 2026-07-03</p>
    <p>OrbitOps is a free, open-source demonstration project. These terms are
       short because the product is simple: there are no accounts, no payments,
       and no managed service.</p>
    <h2>What you are using</h2>
    <ul>
      <li>A demo site that runs in your browser — no sign-up, no login, no accounts</li>
      <li>The public demo also talks to a live demo backend whose database is ephemeral (it resets on restart); nothing you submit there is durably stored</li>
      <li>The managed service described on the pricing page is planned, not available; nothing on this site sells you anything</li>
    </ul>
    <h2>License</h2>
    <p>All code is released under the MIT License. You may use, copy, modify,
       and redistribute it — including commercially — provided the copyright
       and license notice are preserved. See the
       <a href="${GITHUB_URL}/blob/main/LICENSE" target="_blank" rel="noreferrer">LICENSE file</a>.</p>
    <h2>No warranty</h2>
    <p>Per the MIT License, the software is provided <strong>“as is”</strong>,
       without warranty of any kind, express or implied. The authors are not
       liable for any claim, damages, or other liability arising from its use.</p>
    <h2>Not for real operations</h2>
    <p>The propagators, anomaly detection, and manoeuvre planning on this site
       are educational-grade. Do not use them for real conjunction screening,
       manoeuvre decisions, or any safety-of-flight purpose.</p>
    <h2>Changes</h2>
    <p>These terms may change as the project evolves. The full history is
       public in the git log of the repository.</p>`,

  privacy: `${policyConsoleHtml(
    ['NO TRACKING', 'NO COOKIES', 'NO ACCOUNTS', 'LOCAL STORAGE ONLY'],
    [
      'No analytics, no ads, no tracking pixels, no OrbitOps server at all.',
      'Everything stored (BYOK key, TLE cache) lives in your browser and is user-clearable.',
      'Outbound requests go only to CelesTrak, Google Fonts, and — with your key — OpenRouter.',
    ]
  )}
    <h1>Privacy &amp; GDPR</h1>
    <p class="legal-updated">LAST UPDATED · 2026-07-03</p>
    <p>Short version: no accounts, no analytics, no tracking pixels, no ads,
       and no OrbitOps server storing anything about you. This site is static
       files running in your browser.</p>
    <h2>What stays in your browser</h2>
    <ul>
      <li><strong>OpenRouter API key (optional, BYOK)</strong> — stored in
          localStorage only if you enable live LLM reasoning; it is sent
          directly to openrouter.ai and never to any OrbitOps server</li>
      <li><strong>TLE cache</strong> — CelesTrak orbital data cached in
          localStorage for about two hours to avoid refetching</li>
      <li><strong>Welcome flag</strong> — a sessionStorage marker so the intro
          toast shows only once per session</li>
    </ul>
    <p>All of it is user-clearable: use your browser's “clear site data” (or
       devtools) and nothing survives. The app sets no cookies.</p>
    <h2>Outbound requests</h2>
    <p>The demo contacts third parties only for:</p>
    <ul>
      <li><strong>celestrak.org</strong> — fetching live TLE data (your IP is
          visible to CelesTrak, as with any web request)</li>
      <li><strong>fonts.googleapis.com / fonts.gstatic.com</strong> — web fonts</li>
      <li><strong>openrouter.ai</strong> — only if you provide your own key</li>
    </ul>
    <p>Each of those services has its own privacy policy; OrbitOps adds no
       identifiers to those requests.</p>
    <h2>GDPR position</h2>
    <ul>
      <li>We collect and process no personal data</li>
      <li>There is no profiling, no marketing, and no data sharing or sale</li>
      <li>There is nothing to access, export, or erase on our side, because no
          server-side records exist</li>
    </ul>
    <p>If you self-host, whatever your hosting provider logs (e.g. access
       logs) is under your control, not ours.</p>`,

  datapolicy: `${policyConsoleHtml(
    ['CELESTRAK TLE', 'SGP4 PROPAGATION', 'TELEMETRY SIMULATED', 'EDUCATIONAL USE'],
    [
      'Orbits are real: CelesTrak TLEs propagated with SGP4, cached ~2 h.',
      'Health telemetry is simulated and labelled — no real spacecraft feed exists here.',
      'Accuracy degrades over days: visualisation and education only, never operations.',
    ]
  )}
    <h1>Data policy</h1>
    <p class="legal-updated">LAST UPDATED · 2026-07-03</p>
    <p>Where the numbers on this site come from, how fresh they are, and what
       they may — and may not — be used for.</p>
    <h2>Sources &amp; attribution</h2>
    <ul>
      <li><strong>CelesTrak</strong> — public TLE catalog, fetched live in the
          browser (CORS-enabled, no key). All orbital elements shown on this
          site originate there.</li>
      <li><strong>NASA</strong> — Earth landmass raster used to draw the globe,
          bundled with the site (no request to NASA at runtime)</li>
      <li><strong>satellite.js</strong> — vendored SGP4 propagation library</li>
    </ul>
    <h2>Freshness</h2>
    <p>TLEs are cached in your browser for about two hours — CelesTrak's own
       refresh cadence. If CelesTrak is unreachable, a bundled snapshot is used
       instead and labelled as such in the UI.</p>
    <h2>Telemetry is simulated</h2>
    <p>Positions and orbits are real (TLE + SGP4). Voltages, temperatures, and
       anomaly events are simulated — no real spacecraft telemetry exists
       anywhere in this demo.</p>
    <h2>Accuracy &amp; intended use</h2>
    <p>TLE + SGP4 accuracy degrades over days, and the mini-tools use a further
       simplified Keplerian model. Everything here is for visualisation and
       education — never for operational decisions.</p>
    <h2>Your data</h2>
    <p>OrbitOps stores nothing about you server-side. Details are in the
       Privacy &amp; GDPR doc in this sidebar.</p>`,
};
