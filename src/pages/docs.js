/**
 * Docs page — documentation portal.
 */

'use strict';

export async function mount(app) {
  app.innerHTML = `
    <main class="docs-page page-bg page-bg--docs">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <span class="eyebrow">DOCUMENTATION</span>
          <h1 class="page-header__title">Engineer docs.</h1>
          <p class="page-header__sub">
            Everything you need to integrate, deploy, and extend OrbitOps.
            MIT-licensed core. Self-host or managed.
          </p>
        </div>
      </header>

      <section class="docs-layout">
        <div class="container">
          <div class="docs-grid">

            <aside class="docs-sidebar">
              <div class="docs-sidebar__group">
                <div class="docs-sidebar__head">Getting started</div>
                <a class="docs-sidebar__link is-active" data-doc="install">Install</a>
                <a class="docs-sidebar__link" data-doc="quickstart">Quick start</a>
                <a class="docs-sidebar__link" data-doc="arch">Architecture</a>
              </div>
              <div class="docs-sidebar__group">
                <div class="docs-sidebar__head">Core modules</div>
                <a class="docs-sidebar__link" data-doc="propagator">Orbit propagator</a>
                <a class="docs-sidebar__link" data-doc="anomaly">Anomaly detector</a>
                <a class="docs-sidebar__link" data-doc="maneuver">Manoeuvre planner</a>
                <a class="docs-sidebar__link" data-doc="audit">Audit log</a>
              </div>
              <div class="docs-sidebar__group">
                <div class="docs-sidebar__head">AI agent</div>
                <a class="docs-sidebar__link" data-doc="scenarios">Pre-built scenarios</a>
                <a class="docs-sidebar__link" data-doc="custom">Custom scenarios</a>
                <a class="docs-sidebar__link" data-doc="llm">LLM integration</a>
              </div>
              <div class="docs-sidebar__group">
                <div class="docs-sidebar__head">Deployment</div>
                <a class="docs-sidebar__link" data-doc="docker">Docker</a>
                <a class="docs-sidebar__link" data-doc="k8s">Kubernetes</a>
                <a class="docs-sidebar__link" data-doc="on-prem">On-premise</a>
              </div>
            </aside>

            <article class="docs-content" id="docsContent">
              <h1>Install</h1>
              <p>The OrbitOps core is MIT-licensed JavaScript with zero required dependencies.</p>

              <h2>npm</h2>
              <pre class="code"><code>npm install orbitops-core</code></pre>

              <h2>Browser (CDN)</h2>
              <pre class="code"><code>&lt;script type="module" src="https://unpkg.com/orbitops-core/dist/orbitops.min.js"&gt;&lt;/script&gt;</code></pre>

              <h2>From source</h2>
              <pre class="code"><code>git clone https://github.com/orbitops/orbitops.git
cd orbitops
npm install
npm test</code></pre>

              <h2>Verify install</h2>
              <pre class="code"><code>import { propagate } from 'orbitops-core';
const pos = propagate(elements, 0);
console.log(pos.alt); // 550.123 km</code></pre>

              <h2>Next</h2>
              <ul>
                <li><a href="#" data-doc="quickstart">Quick start →</a></li>
                <li><a href="#" data-doc="arch">Architecture overview →</a></li>
                <li><a href="#" data-doc="propagator">Orbit propagator reference →</a></li>
              </ul>
            </article>
          </div>
        </div>
      </section>
    </main>
  `;

  app.querySelector('#sideNav').innerHTML = SIDE_NAV('docs');

  // Doc nav
  const docLinks = app.querySelectorAll('.docs-sidebar__link');
  const content = app.querySelector('#docsContent');
  docLinks.forEach((l) => {
    l.addEventListener('click', (e) => {
      e.preventDefault();
      docLinks.forEach((x) => x.classList.toggle('is-active', x === l));
      const id = l.dataset.doc;
      content.innerHTML = DOCS[id] || '<h1>Not found</h1>';
      content.scrollTop = 0;
    });
  });

  return { unmount() {} };
}

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

const DOCS = {
  quickstart: `<h1>Quick start</h1>
    <p>From zero to running agent in under 5 minutes.</p>
    <h2>1. Install</h2>
    <pre class="code"><code>npm install orbitops-core</code></pre>
    <h2>2. Define your satellites</h2>
    <pre class="code"><code>const sats = [{
  id: 'SAT-1',
  name: 'My Satellite',
  elements: { inclination: 0.9, raan: 0, eccentricity: 0.001, argPerigee: 0, meanAnomaly: 0, meanMotion: 0.001 }
}];</code></pre>
    <h2>3. Train anomaly baseline</h2>
    <pre class="code"><code>import { trainAll, detectAll } from 'orbitops-core';
trainAll(sats);
const anomalies = detectAll(sats, currentTime);</code></pre>
    <h2>4. Run the agent</h2>
    <pre class="code"><code>import { agent } from 'orbitops-core';
const proposal = await agent.runScenario('conjunction', { satelliteId: 'SAT-1' });
console.log(proposal.chain); // 6 reasoning steps</code></pre>
    <h2>Next</h2>
    <ul>
      <li><a href="#" data-doc="arch">Architecture overview →</a></li>
    </ul>`,

  arch: `<h1>Architecture</h1>
    <p>OrbitOps has three layers: core, service, and surface.</p>
    <h2>Core (MIT-licensed)</h2>
    <ul>
      <li><code>orbit-propagator</code> — Kepler mechanics</li>
      <li><code>anomaly-detector</code> — Welford online statistics + isolation forest</li>
      <li><code>maneuver-planner</code> — Hohmann transfer + Tsiolkovsky</li>
      <li><code>audit-log</code> — SHA-256 hash-chained log</li>
      <li><code>ai-agent</code> — 5-step reasoning engine</li>
    </ul>
    <h2>Service (commercial)</h2>
    <ul>
      <li>Node.js + Fastify REST API</li>
      <li>Postgres + TimescaleDB telemetry store</li>
      <li>WebSocket telemetry pipeline</li>
      <li>Single-tenant data plane</li>
    </ul>
    <h2>Surface (commercial)</h2>
    <ul>
      <li>Web cockpit (3D Three.js)</li>
      <li>Mobile companion app</li>
      <li>Slack + PagerDuty integrations</li>
    </ul>`,

  propagator: `<h1>Orbit propagator</h1>
    <p>Simplified Keplerian model. Suitable for visualisation and OOM-accurate planning.</p>
    <h2>API</h2>
    <pre class="code"><code>propagate(elements: Elements, t: number) => Position
propagateECI(elements: Elements, t: number) => {x,y,z}
closestApproach(elA, elB, tStart, tEnd, stepSec) => {tClosest, distanceKm}</code></pre>
    <h2>Accuracy</h2>
    <p>~5 km position accuracy over 24h propagation. For SGP4-grade accuracy, swap in the
       <code>@orbitops/sgp4</code> package (commercial).</p>`,

  anomaly: `<h1>Anomaly detector</h1>
    <p>Welford online statistics + isolation forest on per-satellite baselines.</p>
    <h2>Usage</h2>
    <pre class="code"><code>import { train, trainAll, detect, detectAll } from 'orbitops-core';
train(satellite, durationSec, sampleStepSec);  // ~30 min training
const anomalies = detect(satellite, t, telemetry);</code></pre>
    <h2>Anomaly types</h2>
    <ul>
      <li><strong>Point</strong> — single sample beyond 3σ</li>
      <li><strong>Contextual</strong> — within range but wrong context (e.g. low voltage during sun)</li>
      <li><strong>Collective</strong> — sequence of points trending toward failure</li>
    </ul>`,

  maneuver: `<h1>Manoeuvre planner</h1>
    <p>Hohmann transfer with Tsiolkovsky fuel calculation.</p>
    <h2>API</h2>
    <pre class="code"><code>import { avoidanceBurn, planAvoidance, findBurnWindows } from 'orbitops-core';
const burn = avoidanceBurn(elements, deltaAltKm);
// → { dvMs, fuelKg, durationSec, direction }</code></pre>`,

  audit: `<h1>Audit log</h1>
    <p>SHA-256 hash-chained, append-only.</p>
    <h2>API</h2>
    <pre class="code"><code>import { audit } from 'orbitops-core';
await audit.append('operator-1', 'maneuver.approved', { satId, burn });
const valid = await audit.verify();</code></pre>
    <h2>Export</h2>
    <pre class="code"><code>const json = audit.export(); // ISO 8601 timestamps, hash chain</code></pre>`,

  scenarios: `<h1>Pre-built scenarios</h1>
    <p>5 scenarios ship with the core. Each is a complete reasoning chain with real physics.</p>
    <h2>Included</h2>
    <ol>
      <li><strong>Conjunction</strong> — close approach avoidance burn</li>
      <li><strong>Battery degradation</strong> — 6-week prediction + intervention</li>
      <li><strong>Thermal anomaly</strong> — emergency mitigation</li>
      <li><strong>Commanded manoeuvre</strong> — operator-requested orbit change</li>
      <li><strong>Ground station handoff</strong> — comms degradation buffer</li>
    </ol>`,

  custom: `<h1>Custom scenarios</h1>
    <p>Build your own reasoning chains.</p>
    <pre class="code"><code>agent.register('payload-degraded', async (ctx) => {
  const chain = [];
  chain.push({ phase: 'OBSERVE', title: '...', body: '...' });
  // ... add your reasoning
  return {
    id: uid(),
    scenarioId: 'payload-degraded',
    satelliteId: ctx.satelliteId,
    title: '...',
    confidence: 0.85,
    chain,
    action: 'payload.reconfigure',
    actionData: {},
    status: 'pending',
  };
});</code></pre>`,

  llm: `<h1>LLM integration</h1>
    <p>Replace the pre-built scenarios with GPT-4 / Claude-backed reasoning.</p>
    <pre class="code"><code>import { agent } from 'orbitops-core';
import OpenAI from 'openai';
const openai = new OpenAI();
agent.setReasoner(async (systemPrompt, userPrompt) => {
  const r = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return JSON.parse(r.choices[0].message.content);
});</code></pre>`,

  docker: `<h1>Docker</h1>
    <pre class="code"><code>version: '3.9'
services:
  orbitops:
    image: orbitops/orbitops:latest
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://...
      AUDIT_KEY: $YOUR_KEY
    volumes:
      - ./data:/var/lib/orbitops</code></pre>`,

  k8s: `<h1>Kubernetes</h1>
    <pre class="code"><code>helm repo add orbitops https://charts.orbitops.io
helm install orbitops/orbitops \\
  --set database.url=$DATABASE_URL \\
  --set ingress.host=orbitops.example.com</code></pre>`,

  'on-prem': `<h1>On-premise</h1>
    <p>Air-gapped deployment with offline LLM (Llama-3.1-70B or similar).</p>
    <p>Contact <a href="mailto:sales@orbitops.io">sales@orbitops.io</a> for the on-prem bundle.</p>`,
};