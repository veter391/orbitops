/**
 * Landing page — renders all marketing sections.
 *
 * Sections:
 *   1. Hero           (3D Earth + tagline + stats)
 *   2. Problem        (pain quantified)
 *   3. Solution       (4 pillars)
 *   4. Product demo   (embedded cockpit)
 *   5. AI Agent       (reasoning chain demo)
 *   6. HITL           (architecture diagram)
 *   7. Market         (TAM / SAM / SOM bars)
 *   8. Roadmap        (timeline)
 *   9. Investors CTA
 *
 * @module ui/landing
 */

'use strict';

import { formatNumber } from '../utils.js';

export function mountLanding(host) {
  host.innerHTML = `
    <!-- HERO -->
    <section class="hero" id="hero">
      <div class="hero__bg" id="heroBg"></div>
      <div class="hero__inner">
        <span class="eyebrow">OrbitOps · v0.1</span>
        <h1 class="hero__title">
          Your constellation's<br>
          <em>AI co-pilot.</em>
        </h1>
        <p class="hero__subtitle">
          We watch your satellites so your engineers can sleep. OrbitOps monitors every
          satellite in your constellation 24/7, predicts anomalies hours before they bite,
          and proposes actions with full reasoning — but never decides alone.
        </p>
        <div class="hero__ctas">
          <button class="btn btn--primary btn--lg" data-action="play-demo">▶ Live demo</button>
          <a class="btn btn--secondary btn--lg" href="#investors">Investors</a>
          <a class="btn btn--ghost btn--lg" href="https://github.com/orbitops/orbitops" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
        <div class="hero__stats">
          <div>
            <div class="hero__stat-num">50</div>
            <div class="hero__stat-label">Simulated satellites</div>
          </div>
          <div>
            <div class="hero__stat-nun" style="font-family: var(--font-mono); font-size: var(--text-3xl); font-weight: 700; color: var(--signal-cyan);">0</div>
            <div class="hero__stat-label">Build deps</div>
          </div>
          <div>
            <div class="hero__stat-num">5</div>
            <div class="hero__stat-label">Pre-built AI scenarios</div>
          </div>
          <div>
            <div class="hero__stat-num">MIT</div>
            <div class="hero__stat-label">Open source core</div>
          </div>
        </div>
      </div>
    </section>

    <!-- PROBLEM -->
    <section class="section" id="problem">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The problem</span>
          <h2 class="section__title">Manual ops don't scale. 24/7 monitoring burns out teams.</h2>
          <p class="section__lede">
            Constellation count is doubling every 18 months. Qualified flight dynamics
            engineers are not. The result: tired teams, missed conjunctions, and knowledge
            that walks out the door when senior engineers leave.
          </p>
        </header>

        <div class="stat-grid">
          <div class="stat">
            <div class="stat__num stat__num--critical">9,000+</div>
            <div class="stat__label">Active Starlink sats</div>
            <div class="stat__desc">Growing by 30+ per launch. Each one needs continuous ops attention.</div>
          </div>
          <div class="stat">
            <div class="stat__num stat__num--warning">3,200</div>
            <div class="stat__label">Planned Kuiper sats</div>
            <div class="stat__desc">Amazon's megaconstellation enters commercial service 2027.</div>
          </div>
          <div class="stat">
            <div class="stat__num stat__num--warning">40%</div>
            <div class="stat__label">Senior engineer turnover / 2y</div>
            <div class="stat__desc">Institutional knowledge loss when flight dynamics veterans change jobs.</div>
          </div>
          <div class="stat">
            <div class="stat__num">12/wk</div>
            <div class="stat__label">Conjunction alerts per satellite</div>
            <div class="stat__desc">Each one needs manual review, planning, and execution. Per satellite. Per week.</div>
          </div>
        </div>

        <div class="problem__list">
          <div class="problem__item">
            <div class="problem__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <div class="problem__item-title">Reactive, not predictive</div>
              <div class="problem__item-body">
                Today, anomalies are detected when they happen — battery dies, thruster
                fails, comms drop. By then you're in recovery mode. Predictive anomaly
                detection catches failures days to weeks early.
              </div>
            </div>
          </div>
          <div class="problem__item">
            <div class="problem__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <div>
              <div class="problem__item-title">Fragmented situational awareness</div>
              <div class="problem__item-body">
                LeoLabs for one dataset, 18th SDS for another, your own ground system for a
                third. Operators log into four dashboards, manually correlate. By the time
                you've stitched the picture together, the moment has passed.
              </div>
            </div>
          </div>
          <div class="problem__item">
            <div class="problem__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
            </div>
            <div>
              <div class="problem__item-title">Compliance burden grows faster than teams</div>
              <div class="problem__item-body">
                FCC 5-year deorbit rule, ITU spectrum coordination, FAA launch licensing,
                insurance reporting. Every operator is one regulatory change away from
                missing a filing window. Manual processes don't survive.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- SOLUTION -->
    <section class="section" id="solution">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The solution</span>
          <h2 class="section__title">Four pillars. One co-pilot. Always supervised.</h2>
          <p class="section__lede">
            OrbitOps runs four core jobs so your engineers don't have to. Each one is
            explainable, auditable, and reversible.
          </p>
        </header>

        <div class="solution__pillars">
          <div class="pillar">
            <div class="pillar__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08 4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08 4.24-4.24"/></svg>
            </div>
            <div class="pillar__num">01</div>
            <h3 class="pillar__title">Monitor</h3>
            <p class="pillar__body">
              Every satellite, every subsystem, every second. Aggregated from your ground
              systems, LeoLabs, 18 SDS, your own sensors. Unified risk score, not five
              dashboards.
            </p>
          </div>

          <div class="pillar">
            <div class="pillar__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/><path d="M21 3v5h-5"/></svg>
            </div>
            <div class="pillar__num">02</div>
            <h3 class="pillar__title">Predict</h3>
            <p class="pillar__body">
              Statistical + ML anomaly detection trained on each satellite's baseline.
              We catch battery degradation weeks before failure. Thermal drift hours
              before emergency. Conjunctions days before closest approach.
            </p>
          </div>

          <div class="pillar">
            <div class="pillar__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
            </div>
            <div class="pillar__num">03</div>
            <h3 class="pillar__title">Propose</h3>
            <p class="pillar__body">
              The agent thinks through each situation, ranks options, and proposes the
              best one with full reasoning. Confidence score. Alternatives. Trade-offs
              explained. You see exactly what it considered and why.
            </p>
          </div>

          <div class="pillar">
            <div class="pillar__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-9m9 10h-9M13 7v10"/><circle cx="12" cy="12" r="10"/></svg>
            </div>
            <div class="pillar__num">04</div>
            <h3 class="pillar__title">Audit</h3>
            <p class="pillar__body">
              Every decision is hash-chained, timestamped, and signed. Export your audit
              log for any regulator, any insurer, any auditor. Compliance isn't a feature —
              it's the architecture.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- PRODUCT DEMO -->
    <section class="section" id="product">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The product</span>
          <h2 class="section__title">See it working. Right now. In your browser.</h2>
          <p class="section__lede">
            Below is a live OrbitOps cockpit running against 50 simulated satellites. Pick
            an AI scenario from the right panel to see the agent reason through a real
            operator situation in seconds.
          </p>
        </header>
        <div id="cockpitHost"></div>
      </div>
    </section>

    <!-- AI AGENT -->
    <section class="section ai-section" id="agent">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The AI agent</span>
          <h2 class="section__title">Explainable reasoning. Not black-box magic.</h2>
          <p class="section__lede">
            Every proposal goes through a five-step reasoning chain — Observe, Think, Score,
            Propose, Wait for human approval. You see the whole chain. Nothing hidden.
          </p>
        </header>

        <div class="ai-reasoning">
          <div class="ai-card">
            <div class="ai-card__head">
              <div class="ai-card__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
              </div>
              <div>
                <div class="ai-card__title">Sample reasoning chain</div>
                <div style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-mute); letter-spacing: 0.14em;">Conjunction alert · 03:00 UTC</div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">01</div>
              <div>
                <div class="ai-step__title">OBSERVE</div>
                <div class="ai-step__body">
                  LeoLabs flagged close approach between <strong>ORBIT-1 1-1</strong> and
                  <strong>ORBIT-1 2-3</strong>. Miss distance <strong>3.2 km</strong>.
                  Probability of collision <strong>4.7 × 10⁻⁴</strong> — above the
                  1 × 10⁻⁴ action threshold.
                </div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">02</div>
              <div>
                <div class="ai-step__title">OBSERVE (verify)</div>
                <div class="ai-step__body">
                  Cross-referenced with <strong>18th SDS</strong> public catalog. Confirms
                  close approach at <code>T+4h 12m</code>. ExoAnalytic radar pass scheduled
                  for refinement.
                </div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">03</div>
              <div>
                <div class="ai-step__title">THINK</div>
                <div class="ai-step__body">
                  Independent propagation over ±5h window confirms miss distance of
                  <strong>3.18 km</strong> at T+4.2h. Conjunction geometry is radial-relative,
                  so altitude change on <strong>ORBIT-1 1-1</strong> is most fuel-efficient.
                </div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">04</div>
              <div>
                <div class="ai-step__title">SCORE</div>
                <div class="ai-step__body">
                  Four candidates evaluated: Hohmann +5 km, aggressive single-burn,
                  conservative Hohmann +8 km, no-burn monitor. <strong>Hohmann +5 km</strong>
                  wins on safety margin vs fuel efficiency. <strong>No-burn fails</strong>
                  (3.2 km vs 25 km threshold).
                </div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">05</div>
              <div>
                <div class="ai-step__title">PROPOSE</div>
                <div class="ai-step__body">
                  Execute prograde burn of <strong>15.0 m/s</strong> to raise orbit by 5 km.
                  Fuel cost: <strong>1.41 kg</strong> (11.7% of remaining budget).
                  Confidence: <strong>89%</strong>. <em>Awaiting operator approval.</em>
                </div>
              </div>
            </div>

            <div class="ai-step">
              <div class="ai-step__num">06</div>
              <div>
                <div class="ai-step__title">WAIT</div>
                <div class="ai-step__body">
                  Agent is now idle, waiting for human approval. The satellite is in
                  no danger in the next 4 hours. The operator has time to review the
                  reasoning chain and decide.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- HITL -->
    <section class="section" id="hitl">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">Human-in-the-loop</span>
          <h2 class="section__title">The AI proposes. The human decides. Always.</h2>
          <p class="section__lede">
            We do not believe in full autonomy for billion-dollar spacecraft. We believe
            in the best AI teammate you've ever had — one that never gets tired, never
            misses a conjunction, and always asks before it acts.
          </p>
        </header>

        <div class="hitl">
          <div class="hitl__side hitl__side--ai">
            <div class="hitl__side-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
              AI Agent
            </div>
            <div class="hitl__side-body">
              Monitors 24/7 · Detects anomalies · Predicts failures · Generates candidate
              actions · Ranks alternatives · Computes fuel + safety trade-offs · Shows
              every step of reasoning · Waits for approval · Never executes on its own
            </div>
          </div>

          <div class="hitl__center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
            <div>APPROVE /<br>REJECT /<br>MODIFY</div>
          </div>

          <div class="hitl__side hitl__side--human">
            <div class="hitl__side-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66"/></svg>
              Human Operator
            </div>
            <div class="hitl__side-body">
              Reviews reasoning · Modifies parameters if needed · Approves, rejects, or
              escalates · Owns the final decision · Backs the call with experience ·
              Holds the pager
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- MARKET -->
    <section class="section" id="market">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The market</span>
          <h2 class="section__title">A growing wedge of a $500B space economy.</h2>
          <p class="section__lede">
            The global space economy is projected at $1.8 trillion by 2035 (Morgan
            Stanley). Constellation operations is a small but rapidly-growing slice.
          </p>
        </header>

        <div class="market">
          <div class="market__chart">
            <h3>Addressable market (USD billions)</h3>
            <div class="market__bar">
              <div class="market__bar-label">TAM</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 100%;"></div>
              </div>
              <div class="market__bar-value">$60.0B</div>
            </div>
            <div class="market__bar">
              <div class="market__bar-label">SAM</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 33%;"></div>
              </div>
              <div class="market__bar-value">$20.0B</div>
            </div>
            <div class="market__bar">
              <div class="market__bar-label">SOM (yr 5)</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 3%;"></div>
              </div>
              <div class="market__bar-value">$1.8B</div>
            </div>
            <p style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-mute); letter-spacing: 0.1em; margin-top: var(--space-4);">
              Sources: Morgan Stanley, PwC, McKinsey space reports (2025). Assumes
              ~150 commercial constellation operators globally.
            </p>
          </div>

          <div class="market__chart">
            <h3>3-year revenue projection</h3>
            <div class="market__bar">
              <div class="market__bar-label">Yr 1</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 5%;"></div>
              </div>
              <div class="market__bar-value">$3.0M ARR</div>
            </div>
            <div class="market__bar">
              <div class="market__bar-label">Yr 2</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 40%;"></div>
              </div>
              <div class="market__bar-value">$24.0M ARR</div>
            </div>
            <div class="market__bar">
              <div class="market__bar-label">Yr 3</div>
              <div class="market__bar-track">
                <div class="market__bar-fill" style="width: 100%;"></div>
              </div>
              <div class="market__bar-value">$115M ARR</div>
            </div>
            <p style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-mute); letter-spacing: 0.1em; margin-top: var(--space-4);">
              Conservative: 5 → 25 → 80 customers, $50K avg → $80K → $120K ACV.
              Top-of-funnel: 150+ commercial constellation operators globally.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ROADMAP -->
    <section class="section" id="roadmap">
      <div class="container">
        <header class="section__head">
          <span class="eyebrow">The roadmap</span>
          <h2 class="section__title">12 months from today.</h2>
          <p class="section__lede">
            Public roadmap. Updated monthly. Misses are reported the day they happen.
          </p>
        </header>

        <div class="timeline">
          <div class="timeline__item timeline__item--done">
            <div class="timeline__q">Q1 2026 · DONE</div>
            <div class="timeline__title">Mission, philosophy, brand docs</div>
            <div class="timeline__body">Public docs. Open-source repository. First GitHub release.</div>
          </div>
          <div class="timeline__item timeline__item--done">
            <div class="timeline__q">Q2 2026 · IN PROGRESS</div>
            <div class="timeline__title">Backend service, first pilot customer, seed round</div>
            <div class="timeline__body">Node + Postgres + TimescaleDB. WebSocket telemetry. Single-tenant data planes.</div>
          </div>
          <div class="timeline__item">
            <div class="timeline__q">Q3 2026</div>
            <div class="timeline__title">3 pilot customers · LLM-backed reasoning</div>
            <div class="timeline__body">Production deployments. GPT-4 / Claude-backed agent. LeoLabs integration. SOC 2 Type I.</div>
          </div>
          <div class="timeline__item timeline__item--future">
            <div class="timeline__q">Q4 2026</div>
            <div class="timeline__title">First mega-constellation pilot · Series A</div>
            <div class="timeline__body">Targeting Starlink, Kuiper, OneWeb. IAC Milan talk. $15M Series A.</div>
          </div>
          <div class="timeline__item timeline__item--future">
            <div class="timeline__q">Q1 2027</div>
            <div class="timeline__title">10 customers · $5M ARR · SOC 2 Type II</div>
            <div class="timeline__body">EU data residency. Customer advisory board. First non-founder hires.</div>
          </div>
          <div class="timeline__item timeline__item--future">
            <div class="timeline__q">Q2-Q4 2027</div>
            <div class="timeline__title">25 → 80 customers · $15M → $60M ARR</div>
            <div class="timeline__body">Onboard AI. FAA integration. Open-source manoeuvre planner. $50M Series B.</div>
          </div>
        </div>
      </div>
    </section>

    <!-- INVESTORS -->
    <section class="section" id="investors">
      <div class="container">
        <div class="investors">
          <div class="investors__inner">
            <span class="eyebrow">Raising</span>
            <h2>Seed round: $3M</h2>
            <p>
              We're building the operating system for low-Earth orbit. The team has shipped
              satellite software before. The market is real and validated. The
              architecture is open, defensible, and built to last.
            </p>
            <p style="font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-mute); letter-spacing: 0.1em;">
              Investors: <a href="mailto:investors@orbitops.io" style="color: var(--signal-cyan);">investors@orbitops.io</a><br>
              Press: <a href="mailto:press@orbitops.io" style="color: var(--signal-cyan);">press@orbitops.io</a><br>
              Customers: <a href="mailto:operators@orbitops.io" style="color: var(--signal-cyan);">operators@orbitops.io</a>
            </p>
            <div class="investors__ctas">
              <a class="btn btn--primary" href="mailto:investors@orbitops.io?subject=Seed%20round%20interest">Request pitch deck</a>
              <a class="btn btn--secondary" href="#product">Try the demo</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  // wire the demo button to scroll
  host.querySelector('[data-action="play-demo"]').addEventListener('click', () => {
    document.getElementById('product')?.scrollIntoView({ behavior: 'smooth' });
  });
}