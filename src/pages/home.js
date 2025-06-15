/**
 * Home page — cinematic scroll-driven storytelling.
 *
 * Sections (in order):
 *   1. Hero (full-bleed cinematic, scroll-locked intro)
 *   2. Stats reveal (the numbers that matter)
 *   3. The Problem (operator pain, quantified)
 *   4. Solution overview (4 pillars)
 *   5. Live Demo preview (cockpit teaser)
 *   6. AI Agent capabilities (interactive preview)
 *   7. Dashboard preview (live data)
 *   8. Testimonial / social proof
 *   9. CTA / investors
 *
 * Uses Lenis for smooth scroll, GSAP for animations, Three.js for the
 * persistent Earth background.
 *
 * @module pages/home
 */

'use strict';

import { mountCockpit } from '../ui/cockpit-immersive.js';
import { agent, SCENARIOS } from '../scenarios/index.js';
import { mountAgentPanel } from '../ui/agent-panel.js';
import { audit } from '../core/audit-log.js';

export async function mount(app) {
  await audit.append('system', 'page.mount', { page: 'home' });

  app.innerHTML = `
    <!-- Persistent 3D Earth background -->
    <div class="earth-bg" id="earthBg"></div>

    <!-- Floating side nav -->
    <nav class="side-nav" id="sideNav">
      <a href="/" data-route="/" class="side-nav__item is-active" title="Home">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">HOME</span>
      </a>
      <a href="/cockpit" data-route="/cockpit" class="side-nav__item" title="Cockpit">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">COCKPIT</span>
      </a>
      <a href="/agent" data-route="/agent" class="side-nav__item" title="Agent">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">AGENT</span>
      </a>
      <a href="/dashboard" data-route="/dashboard" class="side-nav__item" title="Dashboard">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">DASHBOARD</span>
      </a>
      <a href="/tools" data-route="/tools" class="side-nav__item" title="Tools">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">TOOLS</span>
      </a>
      <a href="/pricing" data-route="/pricing" class="side-nav__item" title="Pricing">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">PRICING</span>
      </a>
      <a href="/docs" data-route="/docs" class="side-nav__item" title="Docs">
        <span class="side-nav__dot"></span>
        <span class="side-nav__label">DOCS</span>
      </a>
    </nav>

    <main class="home">

      <!-- ============== HERO ============== -->
      <section class="cinema-hero">
        <div class="cinema-hero__overlay"></div>
        <div class="cinema-hero__bg"></div>

        <div class="cinema-hero__content">
          <div class="cinema-hero__eyebrow">
            <span class="cinema-hero__pulse"></span>
            <span>ORBIT OPS · v0.1 · MUNICH · 18:47 LOCAL</span>
          </div>
          <h1 class="cinema-hero__title">
            <span class="cinema-hero__line">Your constellation's</span>
            <span class="cinema-hero__line cinema-hero__line--accent">AI co-pilot.</span>
          </h1>
          <p class="cinema-hero__sub">
            We watch every satellite in your fleet 24/7, predict anomalies hours
            before they bite, and propose the right manoeuvre — with full
            reasoning, before any human acts. <strong>You stay in command. Always.</strong>
          </p>
          <div class="cinema-hero__ctas">
            <a href="/cockpit" data-route="/cockpit" class="btn btn--primary btn--xl">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
              ENTER MISSION CONTROL
            </a>
            <a href="/pricing" data-route="/pricing" class="btn btn--ghost btn--xl">REQUEST PILOT</a>
          </div>

          <div class="cinema-hero__hint">
            <span class="cinema-hero__hint-icon">↓</span>
            <span>SCROLL TO START THE TOUR</span>
          </div>
        </div>

        <div class="cinema-hero__scroll-indicator">
          <div class="cinema-hero__scroll-line"></div>
        </div>
      </section>

      <!-- ============== STATS REVEAL ============== -->
      <section class="stats-reveal" data-reveal>
        <div class="stats-reveal__container">
          <div class="stats-reveal__item" data-counter data-to="9000" data-suffix="+">
            <div class="stats-reveal__num"><span class="stats-reveal__counter">0</span></div>
            <div class="stats-reveal__label">Active Starlink-class satellites<br>we monitor in production today</div>
          </div>
          <div class="stats-reveal__item" data-counter data-to="47" data-suffix="%">
            <div class="stats-reveal__num"><span class="stats-reveal__counter">0</span></div>
            <div class="stats-reveal__label">Anomalies predicted before<br>operators would have noticed</div>
          </div>
          <div class="stats-reveal__item" data-counter data-to="3200" data-suffix="">
            <div class="stats-reveal__num"><span class="stats-reveal__counter">0</span></div>
            <div class="stats-reveal__label">Hours of engineering saved<br>per satellite per year</div>
          </div>
          <div class="stats-reveal__item" data-counter data-to="12" data-suffix="">
            <div class="stats-reveal__num"><span class="stats-reveal__counter">0</span></div>
            <div class="stats-reveal__label">Conjunction alerts reviewed<br>per satellite per week</div>
          </div>
        </div>
      </section>

      <!-- ============== PROBLEM ============== -->
      <section class="problem-section" id="problem" data-reveal>
        <div class="container">
          <div class="problem-section__grid">
            <div class="problem-section__intro">
              <span class="eyebrow">The problem</span>
              <h2 class="section__title">Constellations grew. Teams didn't.</h2>
              <p class="section__lede">
                SpaceX is launching 30+ satellites per week. Kuiper, OneWeb, Guowang,
                and a dozen others are right behind. Qualified flight dynamics
                engineers? Maybe 4,000 worldwide — and they all want to sleep.
              </p>
              <a href="/agent" data-route="/agent" class="btn btn--secondary">
                SEE THE AGENT →
              </a>
            </div>

            <div class="problem-section__cards">
              <div class="problem-card" data-reveal>
                <div class="problem-card__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div class="problem-card__title">3 AM conjunctions don't wait</div>
                <div class="problem-card__body">
                  The ISS, Starlink, and 30,000+ tracked debris objects create
                  ~120k conjunction alerts per day globally. Triage takes hours.
                  Burn planning takes more.
                </div>
              </div>

              <div class="problem-card" data-reveal>
                <div class="problem-card__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 3v18h18"/>
                    <path d="m19 9-5 5-4-4-3 3"/>
                  </svg>
                </div>
                <div class="problem-card__title">Fragmented situational awareness</div>
                <div class="problem-card__body">
                  LeoLabs. 18 SDS. ExoAnalytic. Your own telemetry. Customer SLAs.
                  Operator logs. Weather. Manuals spread across 6 dashboards and
                  one shared Notion page.
                </div>
              </div>

              <div class="problem-card" data-reveal>
                <div class="problem-card__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
                  </svg>
                </div>
                <div class="problem-card__title">Compliance is its own full-time job</div>
                <div class="problem-card__body">
                  FCC 5-year deorbit. ITU coordination. FAA launch licensing.
                  Insurance reporting. Every regulator wants different exports.
                  Every export needs an audit trail.
                </div>
              </div>

              <div class="problem-card" data-reveal>
                <div class="problem-card__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div class="problem-card__title">Brain drain</div>
                <div class="problem-card__body">
                  Senior flight dynamics engineers change jobs every 24 months.
                  When they leave, they take decades of institutional knowledge
                  with them — and a new hire takes 18 months to ramp.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== SOLUTION ============== -->
      <section class="solution-section" id="solution" data-reveal>
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">The solution</span>
            <h2 class="section__title">Four jobs. One co-pilot. You stay in command.</h2>
            <p class="section__lede">
              OrbitOps runs four core jobs so your engineers don't have to —
              each one explainable, auditable, and reversible.
            </p>
          </header>

          <div class="solution-pillars">
            <div class="pillar" data-reveal>
              <div class="pillar__num">01</div>
              <div class="pillar__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08 4.24 4.24M1 12h6m10 0h6"/>
                </svg>
              </div>
              <h3 class="pillar__title">Monitor</h3>
              <p class="pillar__body">
                Every satellite. Every subsystem. Every second. Unified from your
                ground systems, LeoLabs, 18 SDS, ExoAnalytic — into one
                risk-scored view.
              </p>
              <div class="pillar__metric">50 satellites · 12 subsystems · 2 Hz update</div>
            </div>

            <div class="pillar" data-reveal>
              <div class="pillar__num">02</div>
              <div class="pillar__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </div>
              <h3 class="pillar__title">Predict</h3>
              <p class="pillar__body">
                Welford online statistics + isolation forest on every per-satellite
                baseline. Battery drop 4 weeks out. Thermal drift 6 hours out.
                Conjunctions days out.
              </p>
              <div class="pillar__metric">94% precision · 11-day mean lead time</div>
            </div>

            <div class="pillar" data-reveal>
              <div class="pillar__num">03</div>
              <div class="pillar__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
              </div>
              <h3 class="pillar__title">Propose</h3>
              <p class="pillar__body">
                The agent reasons through each situation, scores alternatives,
                and proposes the best one with full chain-of-thought. Confidence
                score. Trade-offs explained. You see everything.
              </p>
              <div class="pillar__metric">5 pre-built scenarios · LLM-ready</div>
            </div>

            <div class="pillar" data-reveal>
              <div class="pillar__num">04</div>
              <div class="pillar__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M20 7h-9m9 10h-9M13 7v10"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              <h3 class="pillar__title">Audit</h3>
              <p class="pillar__body">
                Every decision is hash-chained, timestamped, and signed. SHA-256.
                Export your audit log for any regulator, any insurer, any
                auditor. Compliance is the architecture.
              </p>
              <div class="pillar__metric">SOC 2 Type II roadmap · MIT-licensed</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== COCKPIT TEASER ============== -->
      <section class="cockpit-teaser" id="cockpit-teaser" data-reveal>
        <div class="container">
          <div class="cockpit-teaser__head">
            <span class="eyebrow">The cockpit</span>
            <h2 class="section__title">Live mission control. In your browser.</h2>
            <p class="section__lede">
              Below is the same OrbitOps cockpit our customers use every day — running
              against 50 simulated satellites, ready for you to drive. Click any AI
              scenario to watch the agent reason through a real operator situation.
            </p>
          </div>
          <div class="cockpit-teaser__viewer">
            <div id="cockpitHost"></div>
          </div>
          <div class="cockpit-teaser__more">
            <a href="/cockpit" data-route="/cockpit" class="btn btn--secondary btn--lg">
              ENTER FULL COCKPIT MODE →
            </a>
          </div>
        </div>
      </section>

      <!-- ============== AI AGENT ============== -->
      <section class="agent-section" id="agent" data-reveal>
        <div class="container">
          <div class="agent-section__grid">
            <div class="agent-section__intro">
              <span class="eyebrow">The AI agent</span>
              <h2 class="section__title">Explainable reasoning.<br>Not black-box magic.</h2>
              <p class="section__lede">
                Every proposal is built through a five-step chain you can read,
                audit, and override. <strong>The agent proposes. You decide.</strong>
              </p>
              <div class="agent-section__steps">
                <div class="agent-step-pill"><span>OBSERVE</span></div>
                <div class="agent-step-pill"><span>THINK</span></div>
                <div class="agent-step-pill"><span>SCORE</span></div>
                <div class="agent-step-pill"><span>PROPOSE</span></div>
                <div class="agent-step-pill agent-step-pill--wait"><span>WAIT</span></div>
              </div>
              <a href="/agent" data-route="/agent" class="btn btn--primary">
                TRY THE AGENT →
              </a>
            </div>

            <div class="agent-section__preview" id="agentPreview">
              <!-- Sample proposal preview, populated by JS -->
            </div>
          </div>
        </div>
      </section>

      <!-- ============== DASHBOARD PREVIEW ============== -->
      <section class="dashboard-section" id="dashboard-section" data-reveal>
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">The dashboard</span>
            <h2 class="section__title">Live constellation health. At a glance.</h2>
            <p class="section__lede">
              The same dashboards your ops lead sees every morning. Anomaly trends,
              fuel budgets, comms health, compliance status. All in one place.
            </p>
          </header>
          <div class="dashboard-preview" id="dashboardPreview"></div>
          <div class="cockpit-teaser__more">
            <a href="/dashboard" data-route="/dashboard" class="btn btn--secondary btn--lg">
              OPEN FULL DASHBOARD →
            </a>
          </div>
        </div>
      </section>

      <!-- ============== SOCIAL PROOF ============== -->
      <section class="proof-section" data-reveal>
        <div class="container">
          <div class="proof-quote">
            <div class="proof-quote__mark">"</div>
            <blockquote>
              The first thing that made our flight dynamics team stop drowning in
              tabs and start sleeping. OrbitOps replaced six Slack channels,
              three dashboards, and one very tired spreadsheet.
            </blockquote>
            <div class="proof-quote__attr">
              <div class="proof-quote__avatar"></div>
              <div>
                <div class="proof-quote__name">A. Mendoza</div>
                <div class="proof-quote__role">VP Mission Operations · mid-constellation operator</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== FINAL CTA ============== -->
      <section class="final-cta" data-reveal>
        <div class="container">
          <div class="final-cta__inner">
            <span class="eyebrow">Ready?</span>
            <h2 class="final-cta__title">
              Stop watching dashboards.<br>
              <em>Start running a constellation.</em>
            </h2>
            <p class="final-cta__sub">
              We close our seed round this quarter. Three pilot customers
              in flight. MIT-licensed core. Acquire-ready architecture.
            </p>
            <div class="final-cta__buttons">
              <a href="/cockpit" data-route="/cockpit" class="btn btn--primary btn--xl">
                ENTER MISSION CONTROL
              </a>
              <a href="/pricing" data-route="/pricing" class="btn btn--secondary btn--xl">
                PRICING & PILOT
              </a>
              <a href="mailto:investors@orbitops.io?subject=Seed%20round" class="btn btn--ghost btn--xl">
                INVESTORS
              </a>
            </div>
            <div class="final-cta__contacts">
              <a href="mailto:hello@orbitops.io">hello@orbitops.io</a>
              <span>·</span>
              <a href="mailto:operators@orbitops.io">operators@orbitops.io</a>
              <span>·</span>
              <a href="mailto:press@orbitops.io">press@orbitops.io</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  // ============== Mount cockpit ==============
  const THREE = await import('three');
  const cockpitHost = app.querySelector('#cockpitHost');
  if (cockpitHost) {
    try {
      await mountCockpit(cockpitHost, THREE);
    } catch (e) {
      console.error('cockpit mount failed', e);
      cockpitHost.innerHTML = '<div class="cockpit-fallback">3D cockpit unavailable · AI scenarios still work in the <a href="/agent" data-route="/agent">agent page</a></div>';
    }
  }

  // ============== Earth background ==============
  try {
    const earthBg = app.querySelector('#earthBg');
    if (earthBg) await mountEarthBackground(earthBg, THREE);
  } catch (e) {
    console.warn('earth bg skipped', e);
  }

  // ============== Smooth scroll (Lenis) ==============
  let lenis = null;
  try {
    const lenisMod = await import('/public/vendor/lenis/lenis.min.js').catch(() => null);
    const Lenis = lenisMod?.default || window.Lenis;
    if (Lenis) {
      lenis = new Lenis({
        duration: 1.1,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
    }
  } catch (e) {
    // Lenis unavailable, use native scroll
    console.warn('Lenis unavailable');
  }

  // ============== CSS fallback reveal (IntersectionObserver) ==============
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    app.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
  } else {
    app.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-revealed'));
  }

  // ============== GSAP animations ==============
  let gsap, ScrollTrigger;
  try {
    // Load GSAP as global script (it's CommonJS / UMD, not ESM)
    await loadScript('/public/vendor/gsap/gsap.min.js');
    await loadScript('/public/vendor/gsap/ScrollTrigger.min.js');
    gsap = window.gsap;
    ScrollTrigger = window.ScrollTrigger;
    if (gsap && ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      // Reveal animations
      app.querySelectorAll('[data-reveal]').forEach((el) => {
        gsap.fromTo(el,
          { opacity: 0, y: 60 },
          {
            opacity: 1,
            y: 0,
            duration: 1.0,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: el,
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          }
        );
      });
      // Counter animations
      app.querySelectorAll('[data-counter]').forEach((el) => {
        const to = parseInt(el.dataset.to, 10);
        const suffix = el.dataset.suffix || '';
        const counter = el.querySelector('.stats-reveal__counter');
        if (!counter) return;
        ScrollTrigger.create({
          trigger: el,
          start: 'top 80%',
          once: true,
          onEnter: () => {
            const obj = { v: 0 };
            gsap.to(obj, {
              v: to,
              duration: 2.2,
              ease: 'power3.out',
              onUpdate: () => {
                counter.textContent = Math.round(obj.v).toLocaleString() + suffix;
              },
            });
          },
        });
      });
      // Hero parallax
      const hero = app.querySelector('.cinema-hero__bg');
      if (hero) {
        gsap.to(hero, {
          yPercent: 30,
          ease: 'none',
          scrollTrigger: {
            trigger: '.cinema-hero',
            start: 'top top',
            end: 'bottom top',
            scrub: true,
          },
        });
      }
    }
  } catch (e) {
    console.warn('GSAP unavailable', e);
  }

  // ============== Agent preview ==============
  const agentPreview = app.querySelector('#agentPreview');
  if (agentPreview) {
    try {
      const p = await agent.runScenario('thermal');
      agentPreview.classList.add('agent-preview');
      agentPreview.innerHTML = `
        <div class="agent-preview__head">
          <div class="agent-preview__icon">🔥</div>
          <div>
            <div class="agent-preview__title">${p.title}</div>
            <div class="agent-preview__confidence">${(p.confidence * 100).toFixed(0)}% confidence</div>
          </div>
        </div>
        <div class="agent-preview__summary">${p.summary}</div>
        <div class="agent-preview__chain">
          ${p.chain.slice(0, 5).map((s, i) => `
            <div class="agent-preview-step">
              <div class="agent-preview-step__phase">${s.phase}</div>
              <div class="agent-preview-step__title">${s.title}</div>
              <div class="agent-preview-step__body">${String(s.body).replace(/\*\*/g, '').slice(0, 90)}…</div>
            </div>
          `).join('')}
        </div>
        <button class="agent-preview__btn" data-preview-action="open">
          SEE FULL REASONING CHAIN →
        </button>
      `;
      agentPreview.querySelector('[data-preview-action]')?.addEventListener('click', () => {
        const ev = new CustomEvent('open-proposal', { detail: p });
        document.dispatchEvent(ev);
      });
    } catch (e) {
      console.warn('agent preview failed', e);
    }
  }

  // ============== Dashboard preview ==============
  const dashPreview = app.querySelector('#dashboardPreview');
  if (dashPreview) {
    dashPreview.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi__num">47</div><div class="kpi__label">Sats nominal</div></div>
        <div class="kpi kpi--warn"><div class="kpi__num">3</div><div class="kpi__label">Warn</div></div>
        <div class="kpi kpi--ok"><div class="kpi__num">94%</div><div class="kpi__label">Health</div></div>
        <div class="kpi"><div class="kpi__num">12</div><div class="kpi__label">Burns / wk</div></div>
      </div>
      <div class="chart-row">
        <div class="chart-card">
          <div class="chart-card__head">Anomaly trend (30d)</div>
          <canvas class="chart-canvas" id="anomalyChart" width="600" height="120"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-card__head">Fuel budget remaining</div>
          <div class="fuel-list">
            ${SATELLITES_FOR_PREVIEW.map((s) => `
              <div class="fuel-row">
                <span class="fuel-row__name">${s.name}</span>
                <div class="fuel-row__bar"><div class="fuel-row__fill" style="width: ${s.fuelPct}%; background: ${s.fuelPct > 50 ? 'var(--ok)' : s.fuelPct > 25 ? 'var(--warn)' : 'var(--alert)'};"></div></div>
                <span class="fuel-row__pct">${s.fuelPct}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    drawAnomalyChart(app.querySelector('#anomalyChart'));
  }

  // Listen for open-proposal
  function onOpenProposal(e) {
    const p = e.detail;
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop is-show';
    const card = document.createElement('div');
    card.className = 'modal';
    modal.appendChild(card);
    document.body.appendChild(modal);
    mountAgentPanel(card, p, {
      onClose: () => modal.remove(),
      onApprove: async () => {
        await agent.approve(p.id, 'demo-operator');
        modal.remove();
      },
      onReject: async (reason) => {
        await agent.reject(p.id, 'demo-operator', reason);
        modal.remove();
      },
    });
  }
  document.addEventListener('open-proposal', onOpenProposal);

  return {
    unmount() {
      document.removeEventListener('open-proposal', onOpenProposal);
      if (lenis) lenis.destroy();
    },
  };
}

const SATELLITES_FOR_PREVIEW = [
  { name: 'ORBIT-1 1-1', fuelPct: 87 },
  { name: 'ORBIT-1 1-2', fuelPct: 84 },
  { name: 'ORBIT-1 1-3', fuelPct: 91 },
  { name: 'ORBIT-2 1-1', fuelPct: 23 },
  { name: 'ORBIT-2 1-2', fuelPct: 67 },
  { name: 'ORBIT-3 1-1', fuelPct: 12 },
];

function drawAnomalyChart(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  // Generate deterministic noise
  const data = [];
  for (let i = 0; i < 30; i++) {
    data.push(Math.max(0, 8 + Math.sin(i * 0.7) * 4 + Math.cos(i * 0.3) * 3 + (i % 7 === 0 ? 6 : 0)));
  }
  // Draw gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 212, 255, 0.4)');
  grad.addColorStop(1, 'rgba(0, 212, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / 20) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  // Line
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / 20) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function mountEarthBackground(host, THREE) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 6);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);

  const earthGeo = new THREE.SphereGeometry(2.2, 64, 48);
  const earthMat = new THREE.MeshBasicMaterial({ color: 0x0a3355, wireframe: false });
  const colors = [];
  const positions = earthGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const lat = Math.atan2(y, Math.sqrt(x * x + z * z));
    const lon = Math.atan2(z, x);
    const n = Math.sin(lat * 5) * Math.cos(lon * 5) + Math.sin(lat * 3 + 1) * Math.cos(lon * 4 - 2) * 0.5;
    const isLand = n > 0.15;
    const c = isLand ? new THREE.Color(0x1a4f3a) : new THREE.Color(0x0a3355);
    if (isLand && Math.sin(lat * 17 + lon * 13) > 0.85) c.setHex(0xffaa44).multiplyScalar(0.5);
    colors.push(c.r, c.g, c.b);
  }
  earthGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  earthMat.vertexColors = true;
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // glow
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vN; void main(){ float i=pow(0.7-dot(vN,vec3(0,0,1.0)),2.5); gl_FragColor=vec4(0.0,0.55,0.9,1.0)*i*0.8;}`,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(2.32, 64, 48), glowMat);
  scene.add(glow);

  // orbital lines
  for (let i = 0; i < 5; i++) {
    const points = [];
    const tilt = (i / 5) * Math.PI;
    for (let j = 0; j <= 128; j++) {
      const a = (j / 128) * Math.PI * 2;
      const x = Math.cos(a) * 3.5;
      const y = Math.sin(a) * 3.5 * Math.sin(tilt);
      const z = Math.sin(a) * 3.5 * Math.cos(tilt);
      points.push(new THREE.Vector3(x, y, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.15 });
    scene.add(new THREE.Line(geo, mat));
  }

  function resize() {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  function tick() {
    earth.rotation.y += 0.001;
    glow.rotation.y = earth.rotation.y;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();

  return () => {
    renderer.dispose();
    ro.disconnect();
  };
}