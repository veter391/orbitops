// @ts-check
/**
 * Home — OrbitOps landing, Design Manifesto v3.
 *
 * "Billion-dollar aerospace premium": near-black ground, massive Space
 * Grotesk display type, hairline glass panels, one ice accent.
 *
 * Sections (in order):
 *   1. Hero        — full-viewport; generative starfield + planet limb (three.js)
 *   2. Statements  — three scroll-revealed claims, each with a bespoke
 *                    hairline SVG scene (orbit / human gate / hash chain)
 *   3. Pains       — operator pains → what the demo shows vs what's planned
 *   4. Surfaces    — Cockpit / Agent / Dashboard / Tools panels
 *   5. Stack       — honest system strip: TLE → SGP4 → UI → agent → human gate
 *   6. Numbers     — honest numerals with count-up
 *   7. Honesty     — REAL vs SIMULATED disclosure
 *   8. Final CTA
 *
 * Everything on this page is honest: no fake KPIs, no testimonials, no
 * market-size claims. Numbers are verifiable floors, not projections.
 * Pains/Stack copy sourced from MISSION.md and docs/MARKET-BRIEF.md.
 *
 * Progressive-enhancement ladder:
 *   base                 — static page, all content visible
 *   + IntersectionObserver — fade-up reveals, count-up numerals, scene draw-ins
 *   + ambient.js         — shared starfield + drifting satellite behind content
 *   + three.js           — hero scene, disposed on unmount
 *   + GSAP/Lenis         — desktop, motion-OK only: smooth scroll + scrub parallax
 *   + cursor satellite   — desktop fine-pointer easter egg, rAF spring-lag
 *
 * @module pages/home
 */

'use strict';

import { audit } from '../core/audit-log.js';
import { mountAmbient } from '../ui/ambient.js';

const CSS_ID = 'home-v3';
const CSS_HREF = '/src/styles/home-v3.css';

/** @param {HTMLElement} app */
export async function mount(app) {
  injectStyles();

  try {
    await audit.append('system', 'page.mount', { page: 'home' });
  } catch (e) {
    console.warn('audit unavailable', e);
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.matchMedia('(max-width: 767px)').matches;

  app.innerHTML = renderTemplate();

  const root = /** @type {HTMLElement} */ (app.querySelector('.hv3'));

  // ---- lifecycle state (everything here is torn down in unmount) ----
  let destroyed = false;
  /** @type {IntersectionObserver|null} */
  let io = null;
  /** @type {IntersectionObserver|null} */
  let sceneIo = null;
  /** @type {any} */
  let ambient = null;
  /** @type {(() => void)|null} */
  let killCursor = null;
  /** @type {any} */
  let lenis = null;
  let lenisRaf = 0;
  /** @type {(() => void)|null} */
  let disposeScene = null;
  /** @type {any[]} */
  const tweens = [];
  /** @type {Array<() => void>} */
  const counterStops = [];

  // ---- atmosphere: film grain (chrome-v2 utility) + shared ambient life ----
  root.classList.add('chrome-grain');
  try {
    ambient = mountAmbient(root, { object: 'satellite', density: 1, zIndex: 0 });
  } catch (e) {
    console.warn('ambient layer skipped', e);
  }

  // ============== Hero scene (three.js, async, monochrome) ==============
  const sceneHost = app.querySelector('#hv3Scene');
  if (sceneHost) {
    createHeroScene(/** @type {HTMLElement} */ (sceneHost), { mobile, reduced })
      .then((dispose) => {
        if (destroyed) dispose();
        else disposeScene = dispose;
      })
      .catch((e) => console.warn('hero scene skipped', e));
  }

  // ============== Reveals + count-ups (IO; works on every device) ==============
  const counters = /** @type {HTMLElement[]} */ (Array.from(app.querySelectorAll('[data-hv3-count]')));

  if (!reduced && 'IntersectionObserver' in window) {
    root.classList.add('hv3-js');
    io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        entry.target.querySelectorAll('[data-hv3-count]').forEach((el) => {
          const stop = animateCount(/** @type {HTMLElement} */ (el));
          if (stop) counterStops.push(stop);
        });
        if (io) io.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    app.querySelectorAll('[data-hv3-reveal]').forEach((el) => { if (io) io.observe(el); });
  } else {
    // No observer or reduced motion: show final values immediately.
    counters.forEach((/** @type {HTMLElement} */ el) => {
      el.textContent = formatCount(el, Number(el.dataset.hv3Count) || 0);
    });
  }

  // ============== Statement scenes (hairline SVG, draw-in on scroll-enter) ==============
  const sceneEls = Array.from(app.querySelectorAll('[data-hv3-scene]'));
  if (!reduced && 'IntersectionObserver' in window) {
    sceneIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-live');
        if (sceneIo) sceneIo.unobserve(entry.target);
      });
    }, { threshold: 0.3 });
    sceneEls.forEach((el) => { if (sceneIo) sceneIo.observe(el); });
  } else {
    // Reduced motion (or no IO): show finished scenes; freeze SMIL loops.
    sceneEls.forEach((el) => {
      el.classList.add('is-live');
      const svg = /** @type {SVGSVGElement|null} */ (el.querySelector('svg'));
      if (reduced && svg && typeof svg.pauseAnimations === 'function') svg.pauseAnimations();
    });
  }

  // ============== Cursor-follow satellite (desktop fine-pointer easter egg) ==============
  if (!reduced && !mobile && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    killCursor = createCursorSatellite();
  }

  // ============== Premium motion layer (desktop + motion-OK only) ==============
  if (!reduced && !mobile) {
    try {
      await loadScript('/public/vendor/gsap/gsap.min.js');
      await loadScript('/public/vendor/gsap/ScrollTrigger.min.js');
      const gsap = /** @type {any} */ (window).gsap;
      const ScrollTrigger = /** @type {any} */ (window).ScrollTrigger;

      if (gsap && ScrollTrigger && !destroyed) {
        gsap.registerPlugin(ScrollTrigger);

        // Smooth scroll (Lenis) — rAF handle kept so unmount can cancel it.
        const lenisMod = await import(/** @type {any} */ ('/public/vendor/lenis/lenis.min.js')).catch(() => null);
        const Lenis = (lenisMod && lenisMod.default) || /** @type {any} */ (window).Lenis;
        if (Lenis && !destroyed) {
          lenis = new Lenis({
            duration: 1.05,
            smoothWheel: true,
            easing: (/** @type {number} */ t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          });
          if (typeof lenis.on === 'function') lenis.on('scroll', ScrollTrigger.update);
          const raf = (/** @type {number} */ time) => {
            lenis.raf(time);
            lenisRaf = requestAnimationFrame(raf);
          };
          lenisRaf = requestAnimationFrame(raf);
        }

        if (!destroyed) {
          // Hero: content drifts up and fades as the limb slides past.
          const hero = app.querySelector('.hv3-hero');
          const heroContent = app.querySelector('.hv3-hero__content');
          const heroScene = app.querySelector('.hv3-hero__scene');
          if (hero && heroContent) {
            tweens.push(gsap.to(heroContent, {
              yPercent: -16,
              opacity: 0.15,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
            }));
          }
          // NOTE: no parallax on the scene layer itself — shifting it against
          // the section opened a visible seam at the hero boundary on scroll
          // (owner-reported "barrier"). The content drift above is enough.

          // Statements: titles scale up through the viewport (scrub "zoom").
          app.querySelectorAll('.hv3-statement').forEach((el) => {
            const title = /** @type {HTMLElement|null} */ (el.querySelector('.hv3-statement__title'));
            if (!title) return;
            const origin = el.classList.contains('hv3-statement--right') ? '100% 100%' : '0% 100%';
            tweens.push(gsap.fromTo(title,
              { scale: 0.94, y: 48, transformOrigin: origin },
              {
                scale: 1,
                y: 0,
                ease: 'none',
                scrollTrigger: { trigger: el, start: 'top 96%', end: 'top 42%', scrub: 0.6 },
              }
            ));
          });
        }
      }
    } catch (e) {
      console.warn('motion layer skipped', e);
    }
  }

  // ============== Cleanup contract ==============
  return {
    unmount() {
      destroyed = true;
      if (io) io.disconnect();
      if (sceneIo) sceneIo.disconnect();
      if (killCursor) killCursor();
      if (ambient) ambient.unmount();
      counterStops.forEach((stop) => stop());
      tweens.forEach((tw) => {
        if (tw.scrollTrigger) tw.scrollTrigger.kill();
        tw.kill();
      });
      tweens.length = 0;
      if (lenisRaf) cancelAnimationFrame(lenisRaf);
      if (lenis) lenis.destroy();
      if (disposeScene) disposeScene();
    },
  };
}

/* ========================================================================== */
/* Template                                                                   */
/* ========================================================================== */

function renderTemplate() {
  return `
    <div class="hv3">

      <!-- ============== 1 · HERO ============== -->
      <section class="hv3-hero">
        <div class="hv3-hero__scene" id="hv3Scene" aria-hidden="true"></div>
        <div class="hv3-hero__content">
          <p class="hv3-hero__status">
            <span class="hv3-dot" aria-hidden="true"></span>
            <span>11,000+ tracked objects · CelesTrak · SGP4</span>
          </p>
          <h1 class="hv3-hero__title"><span class="hv3-w">Mission</span> <span class="hv3-w">control</span><br><span class="hv3-w">for</span> <span class="hv3-w">the</span> <span class="hv3-w">real</span> <span class="hv3-w">sky.</span></h1>
          <p class="hv3-hero__sub">
            OrbitOps propagates 11,000+ tracked objects from the live CelesTrak
            catalog — real SGP4, an accountable AI agent, and a human in every loop.
          </p>
          <div class="hv3-hero__ctas">
            <a href="/cockpit" data-route="/cockpit" class="hv3-btn hv3-btn--primary">Enter the cockpit</a>
            <a href="/dashboard" data-route="/dashboard" class="hv3-btn hv3-btn--ghost">View live catalog</a>
          </div>
        </div>
        <div class="hv3-hero__hint" aria-hidden="true">
          <span class="hv3-hero__hint-label">Scroll</span>
          <span class="hv3-hero__hint-line"></span>
        </div>
      </section>

      <!-- ============== 2 · WHAT IT IS ============== -->
      <section class="hv3-statements">
        <div class="hv3-container">

          <div class="hv3-statement" data-hv3-reveal>
            <h2 class="hv3-statement__title">Real orbits.<br>Real physics.</h2>
            <p class="hv3-statement__body">
              Every point of light in the cockpit is a real object from the
              CelesTrak catalog, propagated with SGP4 in your browser.
              No pre-rendered animation. No canned data.
            </p>
            <div class="hv3-scene hv3-scene--orbit" data-hv3-scene aria-hidden="true">
              <svg viewBox="0 0 460 300" fill="none">
                <g transform="rotate(-14 230 150)">
                  <path id="hv3OrbitPath" class="hv3-draw" pathLength="1"
                    d="M30 150a200 78 0 1 0 400 0a200 78 0 1 0 -400 0"
                    stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                  <ellipse class="hv3-pop hv3-d6" cx="230" cy="150" rx="128" ry="46"
                    stroke="rgba(143,198,255,0.25)" stroke-width="1" stroke-dasharray="2 7"/>
                  <circle class="hv3-pop hv3-d5" cx="230" cy="150" r="5" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
                  <circle class="hv3-pop hv3-d5" cx="230" cy="150" r="1.5" fill="rgba(255,255,255,0.55)"/>
                  <path class="hv3-pop hv3-d7" d="M22 150h8M430 150h8" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
                  <g class="hv3-pop hv3-d8">
                    <circle r="3" fill="#8FC6FF">
                      <animateMotion dur="16s" repeatCount="indefinite"><mpath href="#hv3OrbitPath"/></animateMotion>
                    </circle>
                    <circle r="1.4" fill="rgba(143,198,255,0.45)">
                      <animateMotion dur="16s" begin="-0.9s" repeatCount="indefinite"><mpath href="#hv3OrbitPath"/></animateMotion>
                    </circle>
                  </g>
                </g>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="336" y="290">SGP4 · LIVE</text>
              </svg>
            </div>
          </div>

          <div class="hv3-statement hv3-statement--right" data-hv3-reveal>
            <h2 class="hv3-statement__title">AI proposes.<br>Humans approve.</h2>
            <p class="hv3-statement__body">
              The agent observes, reasons, and scores its options — then stops.
              Nothing executes until an operator signs off. The gate is
              architecture, not policy.
            </p>
            <div class="hv3-scene hv3-scene--gate" data-hv3-scene aria-hidden="true">
              <svg viewBox="0 0 440 104" fill="none" stroke-width="1">
                <circle class="hv3-draw" pathLength="1" cx="40" cy="52" r="13" stroke="rgba(255,255,255,0.4)"/>
                <path class="hv3-draw hv3-d1" pathLength="1" d="M53 52h58" stroke="rgba(255,255,255,0.25)"/>
                <circle class="hv3-draw hv3-d2" pathLength="1" cx="124" cy="52" r="13" stroke="rgba(255,255,255,0.4)"/>
                <path class="hv3-draw hv3-d3" pathLength="1" d="M137 52h58" stroke="rgba(255,255,255,0.25)"/>
                <circle class="hv3-draw hv3-d4" pathLength="1" cx="208" cy="52" r="13" stroke="rgba(255,255,255,0.4)"/>
                <path class="hv3-draw hv3-d5" pathLength="1" d="M221 52h63" stroke="rgba(255,255,255,0.25)"/>
                <path class="hv3-draw hv3-d6" pathLength="1" d="M300 24v56" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-draw hv3-d6" pathLength="1" d="M340 24v56" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-b-bar" d="M300 52h40" stroke="rgba(143,198,255,0.7)"/>
                <path class="hv3-draw hv3-d7" pathLength="1" d="M340 52h37" stroke="rgba(255,255,255,0.25)"/>
                <circle class="hv3-draw hv3-d7" pathLength="1" cx="392" cy="52" r="15" stroke="rgba(255,255,255,0.45)"/>
                <circle class="hv3-pop hv3-d8" cx="392" cy="47" r="3.5" stroke="rgba(255,255,255,0.5)"/>
                <path class="hv3-pop hv3-d8" d="M384 61c2-5 14-5 16 0" stroke="rgba(255,255,255,0.5)"/>
                <g class="hv3-pop hv3-d9">
                  <circle r="2.4" fill="#8FC6FF">
                    <animateMotion dur="3.6s" repeatCount="indefinite" path="M40,52 L284,52"/>
                  </circle>
                </g>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="40" y="92" text-anchor="middle">Observe</text>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="124" y="92" text-anchor="middle">Reason</text>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="208" y="92" text-anchor="middle">Score</text>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="320" y="92" text-anchor="middle">Gate</text>
                <text class="hv3-scene__label hv3-pop hv3-d9" x="392" y="92" text-anchor="middle">Human</text>
              </svg>
            </div>
          </div>

          <div class="hv3-statement" data-hv3-reveal>
            <h2 class="hv3-statement__title">Every decision,<br>hash-chained.</h2>
            <p class="hv3-statement__body">
              Approvals, rejections, and overrides are appended to a SHA-256
              hash-chained audit log. Alter one entry and the chain breaks —
              visibly.
            </p>
            <div class="hv3-scene hv3-scene--chain" data-hv3-scene aria-hidden="true">
              <svg viewBox="0 0 480 130" fill="none" stroke-width="1">
                <text class="hv3-scene__label hv3-pop hv3-d8" x="16" y="30">SHA-256 · Append-only</text>
                <rect class="hv3-draw" pathLength="1" x="16" y="58" width="64" height="44" rx="2" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-pop hv3-d1" d="M28 70h34M28 80h40M28 90h26" stroke="rgba(255,255,255,0.22)"/>
                <path class="hv3-draw hv3-d1" pathLength="1" d="M80 80h32" stroke="rgba(255,255,255,0.3)"/>
                <rect class="hv3-draw hv3-d2" pathLength="1" x="112" y="58" width="64" height="44" rx="2" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-pop hv3-d3" d="M124 70h34M124 80h40M124 90h26" stroke="rgba(255,255,255,0.22)"/>
                <path class="hv3-draw hv3-d3" pathLength="1" d="M176 80h32" stroke="rgba(255,255,255,0.3)"/>
                <rect class="hv3-draw hv3-d4" pathLength="1" x="208" y="58" width="64" height="44" rx="2" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-pop hv3-d5" d="M220 70h34M220 80h40M220 90h26" stroke="rgba(255,255,255,0.22)"/>
                <path class="hv3-draw hv3-d5 hv3-c-break" pathLength="1" d="M272 80h32" stroke="rgba(255,255,255,0.3)"/>
                <rect class="hv3-draw hv3-d6 hv3-c-tamper" pathLength="1" x="304" y="58" width="64" height="44" rx="2" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-pop hv3-d7 hv3-c-tamper" d="M316 70h34M316 80h40M316 90h26" stroke="rgba(255,255,255,0.22)"/>
                <path class="hv3-draw hv3-d7" pathLength="1" d="M368 80h32" stroke="rgba(255,255,255,0.3)"/>
                <rect class="hv3-draw hv3-d8" pathLength="1" x="400" y="58" width="64" height="44" rx="2" stroke="rgba(255,255,255,0.45)"/>
                <path class="hv3-pop hv3-d9" d="M412 70h34M412 80h40M412 90h26" stroke="rgba(255,255,255,0.22)"/>
              </svg>
            </div>
          </div>

        </div>
      </section>

      <!-- ============== 2b · OPERATOR PAINS → WHAT ORBITOPS DOES ============== -->
      <section class="hv3-pains">
        <div class="hv3-container">
          <header class="hv3-sectionhead" data-hv3-reveal>
            <p class="hv3-eyebrow">Operator pains → what OrbitOps does</p>
            <h2 class="hv3-sectionhead__title">Built against<br>real 03:00s.</h2>
            <p class="hv3-sectionhead__lede">
              Three scenes we kept watching at constellation operators — and
              the honest state of our answer: what this demo already shows,
              and what is still planned.
            </p>
          </header>
          <div class="hv3-pains__rows">

            <article class="hv3-pain" data-hv3-reveal>
              <div class="hv3-pain__left">
                <p class="hv3-pain__num">Pain · 01</p>
                <h3 class="hv3-pain__title">The 03:00 conjunction alert</h3>
                <p class="hv3-pain__body">
                  A flight dynamics engineer wakes to a fresh conjunction
                  warning, spends 40 minutes stitching four dashboards,
                  eyeballs a transfer, burns fuel, goes back to sleep.
                  Starlink alone logged ~50,000 avoidance maneuvers in six
                  months, per FCC filing.
                </p>
              </div>
              <div class="hv3-pain__right">
                <p class="hv3-pain__now">In the demo today</p>
                <p class="hv3-pain__ans">
                  The whole catalog propagated live in your browser, and an
                  agent that drafts its reasoning in the open — then waits
                  for a human.
                </p>
                <p class="hv3-pain__plan">
                  <span class="hv3-chip hv3-chip--plan">Planned</span>
                  <span class="hv3-pain__plan-text">Conjunction triage queue · agent-drafted responses</span>
                </p>
              </div>
            </article>

            <article class="hv3-pain hv3-pain--flip" data-hv3-reveal>
              <div class="hv3-pain__left">
                <p class="hv3-pain__num">Pain · 02</p>
                <h3 class="hv3-pain__title">Fleets double. Teams don't.</h3>
                <p class="hv3-pain__body">
                  The satellite population doubles roughly every 18 months;
                  the pool of qualified flight dynamics engineers does not.
                  Operators across the industry are hiring for the same
                  senior roles.
                </p>
              </div>
              <div class="hv3-pain__right">
                <p class="hv3-pain__now">In the demo today</p>
                <p class="hv3-pain__ans">
                  A zero-install cockpit any engineer can open, and agent
                  reasoning written to be read — a force-multiplier, not a
                  replacement.
                </p>
                <p class="hv3-pain__plan">
                  <span class="hv3-chip hv3-chip--plan">Planned</span>
                  <span class="hv3-pain__plan-text">Escalation & on-call policies for the agent</span>
                </p>
              </div>
            </article>

            <article class="hv3-pain" data-hv3-reveal>
              <div class="hv3-pain__left">
                <p class="hv3-pain__num">Pain · 03</p>
                <h3 class="hv3-pain__title">Knowledge walks out the door</h3>
                <p class="hv3-pain__body">
                  Why a maneuver was approved often lives in one senior
                  engineer's head. When they leave, the reasoning leaves
                  with them.
                </p>
              </div>
              <div class="hv3-pain__right">
                <p class="hv3-pain__now">In the demo today</p>
                <p class="hv3-pain__ans">
                  Every approval, rejection, and override appended to a
                  SHA-256 hash-chained audit log. Nothing rewritten,
                  nothing lost.
                </p>
                <p class="hv3-pain__plan">
                  <span class="hv3-chip hv3-chip--plan">Planned</span>
                  <span class="hv3-pain__plan-text">One-click audit export packs for insurers &amp; regulators</span>
                </p>
              </div>
            </article>

          </div>
        </div>
      </section>

      <!-- ============== 3 · PRODUCT SURFACES ============== -->
      <section class="hv3-surfaces">
        <div class="hv3-container">
          <header class="hv3-sectionhead" data-hv3-reveal>
            <p class="hv3-eyebrow">Product surfaces</p>
            <h2 class="hv3-sectionhead__title">Four ways in.</h2>
          </header>
        </div>
        <div class="hv3-surfaces__list">

          <a class="hv3-panel" href="/cockpit" data-route="/cockpit" data-hv3-reveal>
            <div class="hv3-panel__grid hv3-container">
              <div class="hv3-panel__meta">
                <p class="hv3-eyebrow">01 · Cockpit</p>
                <h3 class="hv3-panel__title">The whole sky, live</h3>
              </div>
              <div class="hv3-panel__desc">
                <p>The full catalog around a live 3D Earth — 11,000+ objects, propagated in real time with SGP4.</p>
                <span class="hv3-panel__open">Open <span aria-hidden="true">→</span></span>
              </div>
              <div class="hv3-panel__glyph" aria-hidden="true">
                <svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="1">
                  <circle cx="70" cy="70" r="12"/>
                  <ellipse cx="70" cy="70" rx="58" ry="22" transform="rotate(-18 70 70)"/>
                  <circle cx="128" cy="70" r="2.5" fill="currentColor" stroke="none" transform="rotate(-18 70 70)"/>
                </svg>
              </div>
            </div>
          </a>

          <a class="hv3-panel" href="/agent" data-route="/agent" data-hv3-reveal>
            <div class="hv3-panel__grid hv3-container">
              <div class="hv3-panel__meta">
                <p class="hv3-eyebrow">02 · Agent</p>
                <h3 class="hv3-panel__title">Reasoning you can read</h3>
              </div>
              <div class="hv3-panel__desc">
                <p>A human-in-the-loop reasoning demo: the agent observes, thinks, scores, and proposes — then waits for you.</p>
                <span class="hv3-panel__open">Open <span aria-hidden="true">→</span></span>
              </div>
              <div class="hv3-panel__glyph" aria-hidden="true">
                <svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="1">
                  <circle cx="24" cy="52" r="8"/>
                  <circle cx="70" cy="52" r="8"/>
                  <circle cx="116" cy="52" r="8"/>
                  <path d="M32 52h30M78 52h30"/>
                  <path d="M116 60v14"/>
                  <rect x="100" y="74" width="32" height="22" rx="2"/>
                  <path d="M109 85l5 5 9-10"/>
                </svg>
              </div>
            </div>
          </a>

          <a class="hv3-panel" href="/dashboard" data-route="/dashboard" data-hv3-reveal>
            <div class="hv3-panel__grid hv3-container">
              <div class="hv3-panel__meta">
                <p class="hv3-eyebrow">03 · Dashboard</p>
                <h3 class="hv3-panel__title">The catalog, quantified</h3>
              </div>
              <div class="hv3-panel__desc">
                <p>Catalog analytics and fleet health views, computed from the same live data as the cockpit.</p>
                <span class="hv3-panel__open">Open <span aria-hidden="true">→</span></span>
              </div>
              <div class="hv3-panel__glyph" aria-hidden="true">
                <svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="1">
                  <path d="M26 100a48 48 0 1 1 88 0"/>
                  <line x1="70" y1="84" x2="98" y2="52"/>
                  <circle cx="70" cy="84" r="3"/>
                </svg>
              </div>
            </div>
          </a>

          <a class="hv3-panel" href="/tools" data-route="/tools" data-hv3-reveal>
            <div class="hv3-panel__grid hv3-container">
              <div class="hv3-panel__meta">
                <p class="hv3-eyebrow">04 · Tools</p>
                <h3 class="hv3-panel__title">Orbital math, exposed</h3>
              </div>
              <div class="hv3-panel__desc">
                <p>Kepler orbit math, transfer planning, and propagation utilities — check every number by hand.</p>
                <span class="hv3-panel__open">Open <span aria-hidden="true">→</span></span>
              </div>
              <div class="hv3-panel__glyph" aria-hidden="true">
                <svg viewBox="0 0 140 140" fill="none" stroke="currentColor" stroke-width="1">
                  <circle cx="70" cy="70" r="22"/>
                  <circle cx="70" cy="70" r="52"/>
                  <path d="M92 70a37 30 0 0 1 -74 0"/>
                  <circle cx="92" cy="70" r="2.5" fill="currentColor" stroke="none"/>
                  <circle cx="18" cy="70" r="2.5" fill="currentColor" stroke="none"/>
                </svg>
              </div>
            </div>
          </a>

        </div>
      </section>

      <!-- ============== 3b · THE STACK, HONEST ============== -->
      <section class="hv3-stack">
        <div class="hv3-container">
          <header class="hv3-sectionhead" data-hv3-reveal>
            <p class="hv3-eyebrow">The stack, honest</p>
            <h2 class="hv3-sectionhead__title">No black boxes.</h2>
            <p class="hv3-sectionhead__lede">
              Five stages between a public TLE and an approved action —
              every one of them inspectable.
            </p>
          </header>
          <div class="hv3-stack__strip" data-hv3-reveal>
            <div class="hv3-stack__node" tabindex="0">
              <span class="hv3-stack__label">CelesTrak TLE</span>
              <p class="hv3-stack__copy">The live public catalog — the same element sets the rest of the industry reads.</p>
            </div>
            <div class="hv3-stack__link" aria-hidden="true"></div>
            <div class="hv3-stack__node" tabindex="0">
              <span class="hv3-stack__label">SGP4 · Browser</span>
              <p class="hv3-stack__copy">Industry-standard propagation running in your tab. No server round-trips.</p>
            </div>
            <div class="hv3-stack__link" aria-hidden="true"></div>
            <div class="hv3-stack__node" tabindex="0">
              <span class="hv3-stack__label">Cockpit / Analytics</span>
              <p class="hv3-stack__copy">One dataset, two views: the sky in 3D and the numbers behind it.</p>
            </div>
            <div class="hv3-stack__link" aria-hidden="true"></div>
            <div class="hv3-stack__node" tabindex="0">
              <span class="hv3-stack__label">AI Agent · BYOK</span>
              <p class="hv3-stack__copy">Bring your own key. Every prompt, score, and proposal is inspectable.</p>
            </div>
            <div class="hv3-stack__link" aria-hidden="true"></div>
            <div class="hv3-stack__node hv3-stack__node--gate" tabindex="0">
              <span class="hv3-stack__label">Human Gate</span>
              <p class="hv3-stack__copy">Nothing executes without human approval. Architecture, not policy.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== 4 · NUMBERS ============== -->
      <section class="hv3-numbers" data-hv3-reveal>
        <div class="hv3-container">
          <p class="hv3-eyebrow">By the numbers — real ones</p>
          <div class="hv3-numbers__grid">
            <div class="hv3-number">
              <div class="hv3-number__value" data-hv3-count="11000" data-hv3-suffix="+">11,000+</div>
              <div class="hv3-number__label">Objects propagated</div>
            </div>
            <div class="hv3-number">
              <div class="hv3-number__value" data-hv3-count="180">180</div>
              <div class="hv3-number__label">Countries outlined</div>
            </div>
            <div class="hv3-number">
              <div class="hv3-number__value" data-hv3-count="0">0</div>
              <div class="hv3-number__label">Runtime dependencies</div>
            </div>
            <div class="hv3-number">
              <div class="hv3-number__value" data-hv3-count="100" data-hv3-suffix="%">100%</div>
              <div class="hv3-number__label">Open source · MIT</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== 5 · HONESTY ============== -->
      <section class="hv3-honesty">
        <div class="hv3-container">
          <header class="hv3-sectionhead" data-hv3-reveal>
            <p class="hv3-eyebrow">Full disclosure</p>
            <h2 class="hv3-sectionhead__title">What's real.<br>What's simulated.</h2>
            <p class="hv3-sectionhead__lede">
              Most demos blur the line between data and decoration.
              We draw it — in the product and on this page.
            </p>
          </header>
          <div class="hv3-honesty__grid">
            <div class="hv3-honesty__col" data-hv3-reveal>
              <span class="hv3-chip hv3-chip--real">Real</span>
              <ul>
                <li>11,000+ tracked objects, pulled from the public CelesTrak catalog</li>
                <li>SGP4 orbital propagation — the same standard the industry runs on</li>
                <li>SHA-256 hash-chained audit log: every action appended, nothing rewritten</li>
                <li>Kepler orbital-mechanics tools you can verify by hand</li>
              </ul>
            </div>
            <div class="hv3-honesty__col" data-hv3-reveal>
              <span class="hv3-chip hv3-chip--sim">Simulated</span>
              <ul>
                <li>Per-satellite telemetry — fuel, power, thermal — is generated for the demo</li>
                <li>AI agent scenarios are scripted demonstrations, labelled in-product</li>
                <li>Approvals here command software, not hardware</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- ============== 6 · FINAL CTA ============== -->
      <section class="hv3-final">
        <div class="hv3-container" data-hv3-reveal>
          <p class="hv3-eyebrow">Open source · MIT · No signup</p>
          <h2 class="hv3-final__title">The sky is already live.</h2>
          <a href="/cockpit" data-route="/cockpit" class="hv3-btn hv3-btn--primary hv3-btn--xl">Enter the cockpit</a>
        </div>
      </section>

    </div>
  `;
}

/* ========================================================================== */
/* Styles injection (idempotent)                                              */
/* ========================================================================== */

function injectStyles() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID;
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  document.head.appendChild(link);
}

/* ========================================================================== */
/* Count-up numerals (vanilla rAF — no GSAP dependency)                       */
/* ========================================================================== */

/**
 * @param {HTMLElement} el
 * @param {number} value
 */
function formatCount(el, value) {
  return Math.round(value).toLocaleString('en-US') + (el.dataset.hv3Suffix || '');
}

/**
 * Ease-out count-up. Returns a cancel function, or null if nothing animates.
 * @param {HTMLElement} el
 */
function animateCount(el) {
  const to = Number(el.dataset.hv3Count) || 0;
  if (to === 0) {
    el.textContent = formatCount(el, 0);
    return null;
  }
  const duration = 1600;
  const start = performance.now();
  let rafId = 0;
  const step = (/** @type {number} */ now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = formatCount(el, to * eased);
    if (p < 1) rafId = requestAnimationFrame(step);
  };
  el.textContent = formatCount(el, 0);
  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}

/* ========================================================================== */
/* Hero scene — monochrome starfield + planet limb rising from the bottom     */
/* ========================================================================== */

/**
 * Builds the generative hero background. Monochrome, hairline-weight,
 * 60 fps, fully disposed by the returned function.
 *
 * @param {HTMLElement} host
 * @param {{ mobile: boolean, reduced: boolean }} opts
 * @returns {Promise<() => void>} dispose()
 */
async function createHeroScene(host, { mobile, reduced }) {
  const THREE = await import('three');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  camera.position.set(0, 0, 10);

  const renderer = new THREE.WebGLRenderer({
    antialias: !mobile,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(mobile ? 1.5 : 2, window.devicePixelRatio || 1));
  host.appendChild(renderer.domElement);

  // ---- Starfield: two depth layers, white, no color tint ----
  /** @type {any[]} */
  const starLayers = [];
  /**
   * @param {number} count
   * @param {number} size
   * @param {number} opacity
   * @param {number} rMin
   * @param {number} rMax
   */
  function makeStars(count, size, opacity, rMin, rMax) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const r = rMin + Math.random() * (rMax - rMin);
      pos[i * 3] = s * Math.cos(phi) * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = s * Math.sin(phi) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size,
      transparent: true,
      opacity,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    starLayers.push(points);
  }
  makeStars(mobile ? 320 : 1000, 0.12, 0.5, 40, 120);
  makeStars(mobile ? 120 : 380, 0.22, 0.85, 30, 80);

  // ---- Planet limb: a clean hairline WIREFRAME globe (parallels + meridians)
  // rising from the bottom edge. Lines only — no dot-matrix. Meridian vertices
  // fade to black toward the bottom (via vertex colours) so the sphere
  // dissolves into the dark and never shows the hard clipped edge that used to
  // read as a "band".
  const planet = new THREE.Group();
  const R = 9;
  const D2R = Math.PI / 180;
  const llVec = (/** @type {number} */ latDeg, /** @type {number} */ lonDeg, /** @type {number} */ r) => {
    const la = latDeg * D2R, lo = lonDeg * D2R;
    return [Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.sin(lo) * r];
  };
  const latFade = (/** @type {number} */ latDeg) => Math.min(1, Math.max(0, (latDeg + 16) / 40)); // 0 below −16°, 1 above 24°
  const LINE = 0xdbe6f2;

  // parallels — latitude circles, all above the equator so always clean
  for (const lat of [18, 34, 50, 66, 82]) {
    const ring = [];
    for (let a = 0; a <= 160; a++) {
      const [x, y, z] = llVec(lat, (a / 160) * 360, R);
      ring.push(new THREE.Vector3(x, y, z));
    }
    planet.add(new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.13, depthWrite: false })
    ));
  }

  // meridians — longitude arcs, faded toward the bottom via per-vertex colour
  {
    const pos = [], col = [];
    const segs = 90;
    const mer = mobile ? 8 : 12;
    for (let m = 0; m < mer; m++) {
      const lon = (m / mer) * 360;
      for (let s = 0; s < segs; s++) {
        const la0 = 90 - (s / segs) * 132; //  90° → −42°
        const la1 = 90 - ((s + 1) / segs) * 132;
        const [x0, y0, z0] = llVec(la0, lon, R);
        const [x1, y1, z1] = llVec(la1, lon, R);
        const f0 = latFade(la0), f1 = latFade(la1);
        pos.push(x0, y0, z0, x1, y1, z1);
        col.push(f0, f0, f0, f1, f1, f1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    planet.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false,
    })));
  }

  planet.position.set(0, -12.4, -2);
  planet.rotation.z = -0.1;
  scene.add(planet);

  // ---- Sizing ----
  function resize() {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (reduced) renderer.render(scene, camera);
  }
  resize();
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host);
  else window.addEventListener('resize', resize);

  // ---- Render loop (skipped entirely under reduced motion) ----
  let rafId = 0;
  if (!reduced) {
    const frame = () => {
      rafId = requestAnimationFrame(frame);
      // Don't burn GPU when the tab is hidden or the hero is scrolled away.
      if (document.hidden) return;
      if (window.scrollY > window.innerHeight * 1.5) return;
      planet.rotation.y += 0.00045;
      starLayers[0].rotation.y += 0.00005;
      starLayers[1].rotation.y += 0.00009;
      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(frame);
  } else {
    renderer.render(scene, camera);
  }

  return function dispose() {
    cancelAnimationFrame(rafId);
    if (ro) ro.disconnect();
    else window.removeEventListener('resize', resize);
    scene.traverse((/** @type {any} */ obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((/** @type {any} */ m) => m.dispose());
      }
    });
    renderer.dispose();
    if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
    if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.remove();
  };
}

/* ========================================================================== */
/* Cursor-follow satellite — desktop fine-pointer easter egg                  */
/* ========================================================================== */

/**
 * A ~28px hairline satellite trails the cursor with rAF lerp spring lag and
 * rotates toward its direction of travel. After 4 s idle it parks in the
 * bottom-right corner. Caller guards touch/mobile/reduced-motion.
 *
 * @returns {() => void} cleanup — cancels rAF, removes listener + element.
 */
function createCursorSatellite() {
  const el = document.createElement('div');
  el.className = 'hv3-cursat';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <svg width="28" height="15" viewBox="0 0 84 44" fill="none"
      stroke="rgba(255,255,255,0.55)" stroke-width="2.5">
      <rect x="34" y="15" width="16" height="14" rx="1"/>
      <rect x="4" y="18" width="24" height="8"/>
      <rect x="56" y="18" width="24" height="8"/>
      <path d="M28 22h6M50 22h6"/>
      <path d="M42 15V8"/><circle cx="42" cy="6" r="2.5"/>
      <circle cx="42" cy="34" r="2" fill="#8FC6FF" stroke="none"/>
    </svg>`;
  document.body.appendChild(el);

  const park = () => ({ x: window.innerWidth - 52, y: window.innerHeight - 46 });
  let { x, y } = park();
  let tx = x;
  let ty = y;
  let rot = 0;
  let lastMove = -Infinity; // starts parked until the pointer moves
  let rafId = 0;

  const onMove = (/** @type {PointerEvent} */ e) => {
    tx = e.clientX + 16;
    ty = e.clientY + 16;
    lastMove = performance.now();
  };

  const frame = (/** @type {number} */ now) => {
    rafId = requestAnimationFrame(frame);
    if (now - lastMove > 4000) {
      const p = park();
      tx = p.x;
      ty = p.y;
    }
    const dx = tx - x;
    const dy = ty - y;
    x += dx * 0.085;
    y += dy * 0.085;
    if (dx * dx + dy * dy > 9) {
      const target = (Math.atan2(dy, dx) * 180) / Math.PI;
      const d = ((target - rot + 540) % 360) - 180;
      rot += d * 0.12;
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
  };
  rafId = requestAnimationFrame(frame);
  window.addEventListener('pointermove', onMove, { passive: true });

  return function cleanup() {
    cancelAnimationFrame(rafId);
    window.removeEventListener('pointermove', onMove);
    el.remove();
  };
}

/* ========================================================================== */
/* Script loader (UMD GSAP builds register on window)                         */
/* ========================================================================== */

/** @param {string} src */
function loadScript(src) {
  return new Promise(/** @type {(resolve: (value?: any) => void, reject: (reason?: any) => void) => void} */ ((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  }));
}
