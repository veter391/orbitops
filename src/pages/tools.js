// @ts-check
/**
 * TOOLS — flight-instrument mini-tools (v3 rebuild).
 *
 * Three live tools driven by the real demo engine — the math is called
 * unmodified from core/:
 *   - Orbit calculator    → propagate / propagateECI   (core/orbit-propagator)
 *   - Conjunction checker → closestApproach            (core/orbit-propagator)
 *   - Burn planner        → avoidanceBurn              (core/maneuver-planner)
 *
 * This page only prepares inputs (element sets from altitude/inclination,
 * exactly like data/satellites.js does) and formats outputs. The burn
 * planner's engine is a first-order demo model and is labelled as such.
 *
 * 3D: ONE shared renderer/scene for the whole page — the canvas is
 * re-parented into the active tool's host on tab switch. Scene language
 * matches the cockpit globe: dark matte sphere, sparse hairline graticule,
 * thin white country borders from /public/data/world-borders.json, no photo
 * texture. Orbits are white/ice hairline ellipses (inertial frame), the
 * satellite is a reticle sprite, the conjunction pair gets an alert-colored
 * closest-approach segment with an HTML mono distance label.
 *
 * Perf: pixelRatio capped at 1.5, rAF paused when the canvas is offscreen
 * (IntersectionObserver) or the tab is hidden, reduced-motion renders on
 * demand only, full dispose on unmount.
 */

'use strict';

import { propagate, propagateECI, closestApproach, CONSTANTS } from '../core/orbit-propagator.js';
import { avoidanceBurn } from '../core/maneuver-planner.js';
import { SATELLITES } from '../data/satellites.js';
import { mountAmbient } from '../ui/ambient.js';
import { esc } from '../utils.js';

const EARTH_R = CONSTANTS.EARTH_RADIUS_KM;
const MU = CONSTANTS.MU;
const SCENE_R = 2; // Earth radius in scene units
const KM2U = SCENE_R / EARTH_R;
const ALT_MIN = 160;
const ALT_MAX = 36000;
const INC_MIN = 0;
const INC_MAX = 120;
const SAFE_MISS_KM = 25;
const CONJ_STEP_SEC = 30;

const PRESET_ORBITS = {
  leo: { name: 'LEO 550', altKm: 550, incDeg: 53.0 },
  iss: { name: 'ISS 420', altKm: 420, incDeg: 51.6 },
  sso: { name: 'SSO 700', altKm: 700, incDeg: 98.2 },
  geo: { name: 'GEO 35786', altKm: 35786, incDeg: 0.0 },
};

/* ============================================================
   MOUNT
   ============================================================ */

/** @param {HTMLElement} app */
export async function mount(app) {
  injectMiscV3();
  app.innerHTML = shellHTML();
  const sideNav = app.querySelector('#sideNav');
  if (sideNav) sideNav.innerHTML = SIDE_NAV('tools');

  // Ambient starfield only — the page already has its own drifting rocket
  // (CSS) and a live 3D stage, so no second drifting object.
  const ambient = mountAmbient(/** @type {HTMLElement} */ (app.querySelector('.tools-page')), { object: 'none' });

  // "Going deeper" world: sections scale/blur in on first enter (once each,
  // including on first tab activation), the grid layer glides at 0.3x scroll
  // and the active 3D stage frame floats at ~0.9x scroll speed.
  const depthIo = setupDepthReveals(app);
  const unmountScrollDepth = mountScrollDepth(app);

  const THREE = await import('three');
  const viz = createViz(THREE);
  viz.setConjLabelEl(app.querySelector('#conjLabel'));
  viz.attach(app.querySelector('#orbitCanvas'));

  // Tabs — same data-tool / panel-id scheme as before (router-safe)
  /** @type {Record<string, string>} */
  const hosts = { orbit: '#orbitCanvas', conjunction: '#conjCanvas', burn: '#burnCanvas' };
  /** @type {Record<string, string>} */
  const modeOf = { orbit: 'orbit', conjunction: 'conj', burn: 'burn' };
  const tabs = app.querySelectorAll('.tools-tab');
  const panels = app.querySelectorAll('.tools-panel');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('is-active', x === t));
      const id = /** @type {HTMLElement} */ (t).dataset.tool;
      if (!id) return;
      panels.forEach((p) => p.classList.toggle('is-active', p.id === `tool${id.charAt(0).toUpperCase()}${id.slice(1)}`));
      viz.setMode(modeOf[id]);
      viz.attach(app.querySelector(hosts[id]));
    });
  });

  wireOrbitTool(app, viz, THREE);
  wireConjunctionTool(app, viz, THREE);
  wireBurnTool(app, viz, THREE);
  wirePassTool(app); // W4-C · D3 — no 3D stage; TLE catalog lazy-loads on tab open
  viz.setMode('orbit');

  return {
    unmount() {
      if (depthIo) depthIo.disconnect();
      unmountScrollDepth();
      ambient.unmount();
      viz.dispose();
    },
  };
}

/* ============================================================
   DEPTH WORLD — presentation only (no tool math touched)
   ============================================================ */

/**
 * Sections scale in from 0.965 + blur(2px) → sharp on first viewport enter.
 * Hidden panels reveal when their tab is first activated (IO re-evaluates
 * on display change). Once-only: unobserved after reveal.
 * @param {HTMLElement} app
 * @returns {IntersectionObserver|null}
 */
function setupDepthReveals(app) {
  const targets = app.querySelectorAll('[data-depth]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('is-deep'));
    return null;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-deep');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  targets.forEach((t) => io.observe(t));
  return io;
}

/**
 * Scroll-linked depth: the fixed hairline grid glides at 0.3x scroll, and
 * the visible tool's 3D frame (.tool-viz) floats at ~0.9x page speed
 * (offset = 10% of its distance from viewport centre, clamped to ±28 px).
 * The anchor rect is read from the untransformed parent (.tool-stage), so
 * there is no feedback loop. rAF-throttled; off under reduced motion.
 * @param {HTMLElement} app
 * @returns {() => void} cleanup for unmount.
 */
function mountScrollDepth(app) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const grid = /** @type {HTMLElement|null} */ (app.querySelector('.tools-depth-grid'));
  if (reduced) return () => {};
  let raf = 0;
  const sync = () => {
    raf = 0;
    const y = window.scrollY || 0;
    if (grid) grid.style.backgroundPosition = `0 ${(-y * 0.3).toFixed(1)}px`;
    const viz = /** @type {HTMLElement|null} */ (app.querySelector('.tools-panel.is-active .tool-viz'));
    const stage = viz ? viz.closest('.tool-stage') : null;
    if (viz && stage) {
      const r = stage.getBoundingClientRect();
      const mid = r.top + r.height / 2 - (window.innerHeight || 1) / 2;
      const off = Math.max(-28, Math.min(28, mid * 0.1));
      viz.style.transform = `translateY(${off.toFixed(1)}px)`;
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  sync();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (raf) cancelAnimationFrame(raf);
  };
}

/* ============================================================
   SHELL
   ============================================================ */

function shellHTML() {
  /**
   * @param {Satellite[]} list
   * @param {number} [selectedIdx=-1]
   */
  const satOptions = (list, selectedIdx = -1) =>
    list.map((s, i) => `<option value="${s.id}" ${i === selectedIdx ? 'selected' : ''}>${s.name} — ${s.altitude} km</option>`).join('');

  return `
    <main class="tools-page chrome-grain">
      <!-- depth layer 2: faint hairline grid gliding at 0.3x scroll (layer 1 = ambient stars) -->
      <div class="tools-depth-grid" aria-hidden="true"></div>

      <svg class="tools-drift" viewBox="0 0 48 96" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M24 4 C31 16 33 30 33 44 L33 64 L15 64 L15 44 C15 30 17 16 24 4 Z"/>
          <path d="M15 50 L6 68 L15 64"/>
          <path d="M33 50 L42 68 L33 64"/>
          <circle cx="24" cy="34" r="5"/>
          <path d="M19 64 L24 76 L29 64"/>
        </g>
      </svg>

      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header" data-depth>
        <div class="container">
          <span class="eyebrow">MINI-TOOLS · LIVE MATH</span>
          <h1 class="page-header__title">Flight instruments.</h1>
          <p class="page-header__sub">
            Three interactive tools running the same Kepler engine that powers
            this demo. Every readout updates live as you move the controls —
            no mock-ups, real calculations, honestly labelled limits.
          </p>
        </div>
      </header>

      <section class="tools-tabs">
        <div class="container">
          <div class="tools-tab-row">
            <button class="tools-tab is-active" data-tool="orbit" type="button">ORBIT CALCULATOR</button>
            <button class="tools-tab" data-tool="conjunction" type="button">CONJUNCTION CHECKER</button>
            <button class="tools-tab" data-tool="burn" type="button">BURN PLANNER</button>
            <button class="tools-tab" data-tool="passes" type="button">PASS PREDICTOR</button>
          </div>
        </div>
      </section>

      <!-- ================= ORBIT ================= -->
      <section class="tools-panel is-active" id="toolOrbit">
        <div class="container">
          <div class="tool-grid" data-depth>
            <div class="tool-controls">
              <h2>Orbit calculator</h2>
              <p class="section__lede">
                Pick a target, scrub time, read the state vector. Two-body
                Kepler propagation — the orbit is drawn in the inertial frame,
                the ground track is Earth-fixed.
              </p>

              <div class="tool-form hover-lift">
                <label class="t-field">
                  <span class="t-field__label">Target</span>
                  <span class="t-field__box">
                    <select id="orbitTarget">
                      <optgroup label="Reference orbits">
                        <option value="preset:leo" selected>LEO — 550 km / 53.0°</option>
                        <option value="preset:iss">ISS — 420 km / 51.6°</option>
                        <option value="preset:sso">SSO — 700 km / 98.2°</option>
                        <option value="preset:geo">GEO — 35 786 km / 0.0°</option>
                      </optgroup>
                      <optgroup label="Demo constellation">
                        ${SATELLITES.slice(0, 16).map((s) => `<option value="sat:${s.id}">${s.name} — ${s.altitude} km</option>`).join('')}
                      </optgroup>
                      <optgroup label="Custom">
                        <option value="custom">Custom orbit…</option>
                      </optgroup>
                    </select>
                  </span>
                </label>

                <div class="t-field-duo is-hidden" id="orbitCustomRow">
                  <label class="t-field">
                    <span class="t-field__label">Altitude</span>
                    <span class="t-field__box">
                      <input id="orbitCustomAlt" type="number" inputmode="decimal" min="${ALT_MIN}" max="${ALT_MAX}" step="10" value="550">
                      <span class="t-field__unit">KM</span>
                    </span>
                  </label>
                  <label class="t-field">
                    <span class="t-field__label">Inclination</span>
                    <span class="t-field__box">
                      <input id="orbitCustomInc" type="number" inputmode="decimal" min="${INC_MIN}" max="${INC_MAX}" step="0.1" value="53">
                      <span class="t-field__unit">DEG</span>
                    </span>
                  </label>
                </div>

                <label class="t-field">
                  <span class="t-field__label">Time since epoch <output id="orbitTimeOut">T+0 MIN</output></span>
                  <input type="range" id="orbitTime" min="0" max="1440" step="1" value="0">
                </label>

                <label class="t-check">
                  <input type="checkbox" id="orbitTrack" checked>
                  <span>Ground track</span>
                </label>

                <div class="tool-hint" id="orbitHint"></div>
                <button class="t-chip" id="orbitCopy" type="button">COPY RESULTS</button>
              </div>

              <p class="tool-caveat">
                Real math, demo catalog: classical elements + Kepler's equation.
                No drag, no J2, not SGP4 — accuracy is demonstration-grade.
              </p>
            </div>

            <div class="tool-stage">
              <div class="tool-stage__head"><span class="stage-label">STATE VECTOR — LIVE</span></div>
              <div class="tool-readout tool-readout--3">
                <div class="tool-readout__item"><div class="tool-readout__label">Altitude · km</div><div class="tool-readout__value" id="roAlt">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Speed · km/s</div><div class="tool-readout__value" id="roSpeed">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Period · min</div><div class="tool-readout__value" id="roPeriod">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Latitude · deg</div><div class="tool-readout__value" id="roLat">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Longitude · deg</div><div class="tool-readout__value" id="roLon">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Rate · rev/day</div><div class="tool-readout__value" id="roRev">—</div></div>
              </div>
              <div class="tool-viz"><div class="tool-canvas-host" id="orbitCanvas"></div></div>
            </div>
          </div>
        </div>
      </section>

      <!-- ================= CONJUNCTION ================= -->
      <section class="tools-panel" id="toolConjunction">
        <div class="container">
          <div class="tool-grid" data-depth>
            <div class="tool-controls">
              <h2>Conjunction checker</h2>
              <p class="section__lede">
                Pick two satellites — the closest approach over the search
                window recomputes as you change anything. Brute-force Kepler
                sampling every ${CONJ_STEP_SEC} s.
              </p>

              <div class="tool-form hover-lift">
                <div class="t-field-duo">
                  <label class="t-field">
                    <span class="t-field__label">Satellite A</span>
                    <span class="t-field__box">
                      <select id="conjA">${satOptions(SATELLITES.slice(0, 16), 0)}</select>
                    </span>
                  </label>
                  <label class="t-field">
                    <span class="t-field__label">Satellite B</span>
                    <span class="t-field__box">
                      <select id="conjB">${satOptions(SATELLITES.slice(0, 16), 9)}</select>
                    </span>
                  </label>
                </div>

                <label class="t-field">
                  <span class="t-field__label">Search window <output id="conjWindowOut">24 H</output></span>
                  <input type="range" id="conjWindow" min="1" max="48" step="1" value="24">
                </label>

                <div class="tool-hint" id="conjHint"></div>
                <button class="t-chip" id="conjCopy" type="button">COPY RESULTS</button>
              </div>

              <div class="tool-notes" id="conjNotes"></div>
            </div>

            <div class="tool-stage">
              <div class="tool-stage__head"><span class="stage-label">CLOSEST APPROACH — LIVE</span></div>
              <div class="tool-readout">
                <div class="tool-readout__item"><div class="tool-readout__label">Miss distance · km</div><div class="tool-readout__value" id="rcDist">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Time to TCA · h</div><div class="tool-readout__value" id="rcTca">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Rel speed · km/s</div><div class="tool-readout__value" id="rcRel">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Status</div><div class="tool-readout__value" id="rcStatus">—</div></div>
              </div>
              <div class="tool-viz">
                <div class="tool-canvas-host" id="conjCanvas">
                  <div class="conj-overlay" id="conjLabel"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ================= BURN ================= -->
      <section class="tools-panel" id="toolBurn">
        <div class="container">
          <div class="tool-grid" data-depth>
            <div class="tool-controls">
              <h2>Burn planner</h2>
              <p class="section__lede">
                Size an altitude-change burn: delta-v, fuel and the target
                orbit, live. Results are a first-order estimate from the demo
                engine — labelled honestly below.
              </p>

              <div class="tool-form hover-lift">
                <label class="t-field">
                  <span class="t-field__label">Satellite</span>
                  <span class="t-field__box">
                    <select id="burnSat">${satOptions(SATELLITES.slice(0, 16), 0)}</select>
                  </span>
                </label>

                <label class="t-field">
                  <span class="t-field__label">Δ Altitude <output id="burnDeltaOut">+5.0 KM</output></span>
                  <input type="range" id="burnDelta" min="-50" max="50" step="0.5" value="5">
                </label>

                <div class="tool-hint" id="burnHint">Propellant model fixed in the demo engine (hydrazine-class). No Isp input — it would not change the result.</div>
                <button class="t-chip" id="burnCopy" type="button">COPY RESULTS</button>
              </div>

              <div class="tool-notes" id="burnDetails"></div>
            </div>

            <div class="tool-stage">
              <div class="tool-stage__head">
                <span class="stage-label">BURN SOLUTION</span>
                <span class="demo-chip">FIRST-ORDER ESTIMATE · DEMO</span>
              </div>
              <div class="tool-readout">
                <div class="tool-readout__item"><div class="tool-readout__label">Delta-v · m/s</div><div class="tool-readout__value" id="rbDv">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Fuel est · kg</div><div class="tool-readout__value" id="rbFuel">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Direction</div><div class="tool-readout__value" id="rbDir">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">New alt · km</div><div class="tool-readout__value" id="rbAlt">—</div></div>
              </div>
              <div class="tool-viz"><div class="tool-canvas-host" id="burnCanvas"></div></div>
            </div>
          </div>
        </div>
      </section>

      <!-- ================= PASSES (W4-C · D3 — real, client-side) ================= -->
      <section class="tools-panel" id="toolPasses">
        <div class="container">
          <div class="tool-grid" data-depth>
            <div class="tool-controls">
              <h2>Pass predictor</h2>
              <p class="section__lede">
                When does a real satellite rise over your horizon? Pick a
                ground site and a catalogued object — the next 24 hours of
                passes are computed in your browser from the live CelesTrak
                element set: SGP4 states every 30 s, converted to local
                look angles.
              </p>

              <div class="tool-form hover-lift">
                <label class="t-field">
                  <span class="t-field__label">Ground site</span>
                  <span class="t-field__box">
                    <select id="passPreset">
                      <option value="40.42,-3.70" selected>Madrid — 40.42, −3.70</option>
                      <option value="51.51,-0.13">London — 51.51, −0.13</option>
                      <option value="40.71,-74.01">New York — 40.71, −74.01</option>
                      <option value="-33.87,151.21">Sydney — −33.87, 151.21</option>
                      <option value="custom">Custom coordinates…</option>
                    </select>
                  </span>
                </label>

                <div class="t-field-duo">
                  <label class="t-field">
                    <span class="t-field__label">Latitude</span>
                    <span class="t-field__box">
                      <input id="passLat" type="number" inputmode="decimal" min="-90" max="90" step="0.01" value="40.42">
                      <span class="t-field__unit">DEG</span>
                    </span>
                  </label>
                  <label class="t-field">
                    <span class="t-field__label">Longitude</span>
                    <span class="t-field__box">
                      <input id="passLon" type="number" inputmode="decimal" min="-180" max="180" step="0.01" value="-3.70">
                      <span class="t-field__unit">DEG</span>
                    </span>
                  </label>
                </div>

                <label class="t-field">
                  <span class="t-field__label">Satellite <output id="passSatSrc"></output></span>
                  <span class="t-field__box">
                    <select id="passSat" disabled><option>Open this tab to load the catalog…</option></select>
                  </span>
                </label>

                <label class="t-field">
                  <span class="t-field__label">Horizon elevation mask</span>
                  <span class="t-field__box">
                    <input id="passMinEl" type="number" inputmode="decimal" min="0" max="85" step="1" value="10">
                    <span class="t-field__unit">DEG</span>
                  </span>
                </label>

                <div class="tool-hint" id="passHint"></div>
                <button class="t-chip" id="passCopy" type="button">COPY RESULTS</button>
              </div>

              <p class="tool-caveat">
                Real math, real catalog: SGP4 on the current TLE, sampled every
                30 s over 24 h. TLE accuracy degrades over days — verify against
                a fresh element set before pointing anything expensive.
              </p>
            </div>

            <div class="tool-stage">
              <div class="tool-stage__head">
                <span class="stage-label">NEXT PASSES — 24 H</span>
                <span class="pass-real-chip">REAL · SGP4 + LIVE TLE</span>
              </div>
              <div class="tool-readout">
                <div class="tool-readout__item"><div class="tool-readout__label">Next AOS · UTC</div><div class="tool-readout__value" id="rpAos">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Max elevation · deg</div><div class="tool-readout__value" id="rpMaxEl">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Duration · min</div><div class="tool-readout__value" id="rpDur">—</div></div>
                <div class="tool-readout__item"><div class="tool-readout__label">Passes · 24 h</div><div class="tool-readout__value" id="rpCount">—</div></div>
              </div>
              <div class="pass-board">
                <div class="pass-board__cols" aria-hidden="true">
                  <span>#</span><span>AOS UTC</span><span>LOS UTC</span><span>DUR</span><span>MAX EL</span>
                </div>
                <div class="pass-list" id="passList" aria-live="polite">
                  <div class="pass-empty">Switch to this tab — the real catalog loads on demand.</div>
                </div>
                <div class="pass-board__foot" id="passFoot"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
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

/* ============================================================
   SHARED 3D SCENE — one renderer for the whole page
   ============================================================ */

/** @param {any} THREE */
function createViz(THREE) {
  const mediaRM = window.matchMedia('(prefers-reduced-motion: reduce)');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 160);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x050708, 1);

  // White light only — matte cockpit look, no colored rims
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(6, 3, 4);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Globe: dark matte sphere + sparse graticule + country borders
  const world = new THREE.Group();
  scene.add(world);
  world.add(new THREE.Mesh(
    new THREE.SphereGeometry(SCENE_R, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.95, metalness: 0 })
  ));
  world.add(buildGraticule(THREE));

  let disposed = false;
  fetch('/public/data/world-borders.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((geojson) => {
      if (!geojson || disposed) return;
      world.add(buildBorders(THREE, geojson));
      refresh();
    })
    .catch(() => { /* borders are decorative — sphere + graticule remain */ });

  // Per-tool overlay groups
  const groups = { orbit: new THREE.Group(), conj: new THREE.Group(), burn: new THREE.Group() };
  Object.values(groups).forEach((g) => { g.visible = false; scene.add(g); });

  const reticleTex = makeReticleTexture(THREE);
  /** @type {any[]} */
  const sprites = [];

  const cam = { yaw: 0.55, pitch: 0.42, radius: 6.6, target: 6.6 };
  /** @type {Record<string, number>} */
  const modeCam = { orbit: 6.6, conj: 6.6, burn: 6.6 };
  let mode = 'orbit';
  /** @type {HTMLElement|null} */
  let conjLabelEl = null;
  /** @type {any} */
  let conjWorld = null;

  /** @type {HTMLElement|null} */
  let host = null;
  let inView = true;
  let tabVisible = !document.hidden;
  let raf = 0;

  function loopNeeded() { return inView && tabVisible && !mediaRM.matches && !disposed; }

  /** @param {boolean} ease */
  function applyCamera(ease) {
    cam.radius = ease ? cam.radius + (cam.target - cam.radius) * 0.08 : cam.target;
    const cp = Math.cos(cam.pitch);
    camera.position.set(
      cam.radius * Math.sin(cam.yaw) * cp,
      cam.radius * Math.sin(cam.pitch),
      cam.radius * Math.cos(cam.yaw) * cp
    );
    camera.lookAt(0, 0, 0);
    const s = cam.radius * 0.024;
    sprites.forEach((sp) => sp.scale.set(s, s, 1));
  }

  /**
   * True if the segment camera→p passes through the sphere before reaching p.
   * @param {any} p
   */
  function occluded(p) {
    const c = camera.position;
    const d = p.clone().sub(c);
    const len = d.length();
    d.divideScalar(len);
    const b = c.dot(d);
    const cc = c.lengthSq() - SCENE_R * SCENE_R;
    const disc = b * b - cc;
    if (disc <= 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len - 1e-3;
  }

  function overlay() {
    if (!conjLabelEl) return;
    if (mode !== 'conj' || !conjWorld) { conjLabelEl.style.display = 'none'; return; }
    const v = conjWorld.clone().project(camera);
    if (v.z > 1 || occluded(conjWorld)) { conjLabelEl.style.display = 'none'; return; }
    conjLabelEl.style.display = 'block';
    conjLabelEl.style.left = `${(v.x * 0.5 + 0.5) * renderer.domElement.clientWidth}px`;
    conjLabelEl.style.top = `${(-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight}px`;
  }

  function render() { renderer.render(scene, camera); overlay(); }

  function frame() {
    if (!loopNeeded()) { raf = 0; return; }
    cam.yaw += 0.00045; // slow drift instead of spinning the globe (positions stay honest)
    applyCamera(true);
    render();
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (disposed) return;
    if (loopNeeded()) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (inView && tabVisible) { applyCamera(false); render(); }
    }
  }

  /** Re-render after a scene data change (no-op if the rAF loop is running). */
  function refresh() {
    if (disposed) return;
    if (!raf) { applyCamera(false); render(); }
  }

  const io = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    kick();
  }, { threshold: 0.05 });
  io.observe(renderer.domElement);

  const onVis = () => { tabVisible = !document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onRM = () => kick();
  mediaRM.addEventListener('change', onRM);

  /** @type {ResizeObserver|null} */
  let ro = null;
  function resize() {
    if (!host || disposed) return;
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    refresh();
  }

  return {
    /** @param {HTMLElement|null} nextHost */
    attach(nextHost) {
      if (!nextHost || disposed) return;
      host = nextHost;
      host.appendChild(renderer.domElement);
      if (ro) ro.disconnect();
      ro = new ResizeObserver(resize);
      ro.observe(host);
      resize();
      kick();
    },

    /** @param {string} next */
    setMode(next) {
      mode = next;
      groups.orbit.visible = next === 'orbit';
      groups.conj.visible = next === 'conj';
      groups.burn.visible = next === 'burn';
      cam.target = modeCam[next] || 6.6;
      refresh();
    },

    /**
     * @param {string} m
     * @param {number} r
     */
    setModeCam(m, r) {
      modeCam[m] = r;
      if (m === mode) cam.target = r;
    },

    /** @param {HTMLElement|null} el */
    setConjLabelEl(el) { conjLabelEl = el; },

    /**
     * @param {any} v
     * @param {string} [text]
     */
    setConjWorld(v, text) {
      conjWorld = v || null;
      if (conjLabelEl && text != null) conjLabelEl.textContent = text;
    },

    /**
     * @param {'orbit'|'conj'|'burn'} groupName
     * @param {number} color
     * @param {number} opacity
     * @param {{dashed?: boolean}} [opts={}]
     */
    makeLine(groupName, color, opacity, opts = {}) {
      const geo = new THREE.BufferGeometry();
      const mat = opts.dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.14, gapSize: 0.09 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const line = new THREE.Line(geo, mat);
      groups[groupName].add(line);
      return {
        obj: line,
        /** @param {any[]} points */
        set(points) {
          geo.setFromPoints(points);
          if (opts.dashed) line.computeLineDistances();
          geo.computeBoundingSphere();
        },
      };
    },

    /**
     * @param {'orbit'|'conj'|'burn'} groupName
     * @param {number} color
     */
    makeReticle(groupName, color) {
      const mat = new THREE.SpriteMaterial({ map: reticleTex, color, transparent: true, depthTest: true });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(0.16, 0.16, 1);
      groups[groupName].add(sp);
      sprites.push(sp);
      return { obj: sp, setPos(/** @type {any} */ v) { sp.position.copy(v); } };
    },

    refresh,

    dispose() {
      disposed = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      io.disconnect();
      if (ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      mediaRM.removeEventListener('change', onRM);
      scene.traverse((/** @type {any} */ o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((/** @type {any} */ m) => { if (m.map) m.map.dispose(); m.dispose(); });
        }
      });
      reticleTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * Sparse hairline graticule — 30° spacing, latitudes ±60 only.
 * @param {any} THREE
 */
function buildGraticule(THREE) {
  /** @type {number[]} */
  const verts = [];
  const R = SCENE_R * 1.004;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 4) {
      pushLatLon(verts, lat, lon, R);
      pushLatLon(verts, lat, lon + 4, R);
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 4) {
      pushLatLon(verts, lat, lon, R);
      pushLatLon(verts, lat + 4, lon, R);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })
  );
}

/**
 * Thin white country borders from GeoJSON (Polygon / MultiPolygon rings).
 * @param {any} THREE
 * @param {any} geojson
 */
function buildBorders(THREE, geojson) {
  /** @type {number[]} */
  const verts = [];
  const R = SCENE_R * 1.007;
  /** @param {number[][]} ring */
  const addRing = (ring) => {
    for (let i = 0; i < ring.length - 1; i++) {
      pushLatLon(verts, ring[i][1], ring[i][0], R);
      pushLatLon(verts, ring[i + 1][1], ring[i + 1][0], R);
    }
  };
  for (const f of geojson.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') g.coordinates.forEach(addRing);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((/** @type {number[][][]} */ poly) => poly.forEach(addRing));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
  );
}

/**
 * Spec mapping: x = −R·cos(lat)·cos(lon), y = R·sin(lat), z = R·cos(lat)·sin(lon).
 * @param {number[]} arr
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} R
 */
function pushLatLon(arr, latDeg, lonDeg, R) {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  arr.push(-R * Math.cos(la) * Math.cos(lo), R * Math.sin(la), R * Math.cos(la) * Math.sin(lo));
}

/**
 * ECI/ECEF km → scene units, consistent with pushLatLon (X→−x, Z→y, Y→z).
 * @param {any} THREE
 * @param {{x: number, y: number, z: number}} p
 */
function eciToScene(THREE, p) {
  return new THREE.Vector3(-p.x * KM2U, p.z * KM2U, p.y * KM2U);
}

/**
 * Closed inertial-frame ellipse sampled over one period via propagateECI.
 * @param {any} THREE
 * @param {OrbitalElements} el
 * @param {number} [samples=181]
 */
function eciOrbitPoints(THREE, el, samples = 181) {
  const period = (2 * Math.PI) / el.meanMotion;
  /** @type {any[]} */
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    pts.push(eciToScene(THREE, propagateECI(el, (i / samples) * period)));
  }
  return pts;
}

/**
 * Earth-fixed ground track over one period (lat/lon from propagate).
 * @param {any} THREE
 * @param {OrbitalElements} el
 * @param {number} [samples=241]
 */
function groundTrackPoints(THREE, el, samples = 241) {
  const period = (2 * Math.PI) / el.meanMotion;
  const R = SCENE_R * 1.012;
  /** @type {any[]} */
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const p = propagate(el, (i / samples) * period);
    const la = (p.lat * Math.PI) / 180;
    const lo = (p.lon * Math.PI) / 180;
    pts.push(new THREE.Vector3(-R * Math.cos(la) * Math.cos(lo), R * Math.sin(la), R * Math.cos(la) * Math.sin(lo)));
  }
  return pts;
}

/** @param {any} THREE */
function makeReticleTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(64, 64, 6, 0, Math.PI * 2); g.fill();
  const ticks = [[64, 8, 64, 26], [64, 102, 64, 120], [8, 64, 26, 64], [102, 64, 120, 64]];
  for (const [x1, y1, x2, y2] of ticks) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/* ============================================================
   ELEMENT PREP (input side only — same recipe as data/satellites.js)
   ============================================================ */

/**
 * @param {number} altKm
 * @param {number} incDeg
 * @returns {OrbitalElements}
 */
function elementsForAlt(altKm, incDeg) {
  const a = EARTH_R + altKm;
  return {
    inclination: (incDeg * Math.PI) / 180,
    raan: 0.6,
    eccentricity: 0.0001,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: Math.sqrt(MU / (a * a * a)),
  };
}

/** @param {OrbitalElements} el */
function rMaxScene(el) {
  const a = Math.cbrt(MU / (el.meanMotion * el.meanMotion));
  return a * (1 + (el.eccentricity || 0)) * KM2U;
}

/** @param {...OrbitalElements} els */
function camRadiusFor(...els) {
  return Math.max(6.6, ...els.map((el) => rMaxScene(el) * 2.5));
}

/* ============================================================
   TOOL 1 — ORBIT CALCULATOR
   ============================================================ */

/**
 * @param {HTMLElement} app
 * @param {ReturnType<typeof createViz>} viz
 * @param {any} THREE
 */
function wireOrbitTool(app, viz, THREE) {
  /** @param {string} s */
  const $ = (s) => app.querySelector(s);
  const target = /** @type {HTMLSelectElement} */ ($('#orbitTarget'));
  const customRow = /** @type {HTMLElement} */ ($('#orbitCustomRow'));
  const altIn = /** @type {HTMLInputElement} */ ($('#orbitCustomAlt'));
  const incIn = /** @type {HTMLInputElement} */ ($('#orbitCustomInc'));
  const time = /** @type {HTMLInputElement} */ ($('#orbitTime'));
  const timeOut = /** @type {HTMLElement} */ ($('#orbitTimeOut'));
  const track = /** @type {HTMLInputElement} */ ($('#orbitTrack'));
  const hint = /** @type {HTMLElement} */ ($('#orbitHint'));

  const orbitLine = viz.makeLine('orbit', 0xf4f6f8, 0.55);
  const trackLine = viz.makeLine('orbit', 0x8fc6ff, 0.3);
  const marker = viz.makeReticle('orbit', 0xf4f6f8);

  /** @type {{label: string, tMin: number, alt: number, lat: number, lon: number, speed: number, periodMin: number} | null} */
  let last = null;

  /** @returns {{el: OrbitalElements, label: string}} */
  function currentElements() {
    const v = target.value;
    hint.textContent = '';
    hint.classList.remove('is-warn');
    if (v.startsWith('sat:')) {
      const s = /** @type {Satellite} */ (SATELLITES.find((x) => `sat:${x.id}` === v));
      return { el: s.elements, label: s.name };
    }
    if (v.startsWith('preset:')) {
      const p = PRESET_ORBITS[/** @type {keyof typeof PRESET_ORBITS} */ (v.slice(7))];
      return { el: elementsForAlt(p.altKm, p.incDeg), label: p.name };
    }
    // Custom — clamp to honest ranges, never NaN
    const alt = clampNum(altIn.value, ALT_MIN, ALT_MAX, 550);
    const inc = clampNum(incIn.value, INC_MIN, INC_MAX, 53);
    if (alt.clamped || inc.clamped) {
      hint.textContent = `Clamped to honest ranges: altitude ${ALT_MIN}–${ALT_MAX} km, inclination ${INC_MIN}–${INC_MAX}°.`;
      hint.classList.add('is-warn');
    }
    return { el: elementsForAlt(alt.v, inc.v), label: `CUSTOM ${alt.v} km / ${inc.v}°` };
  }

  function update() {
    const { el, label } = currentElements();
    const tMin = clampNum(time.value, 0, 1440, 0).v;
    timeOut.textContent = `T+${tMin} MIN`;
    const tSec = tMin * 60;

    orbitLine.set(eciOrbitPoints(THREE, el));
    marker.setPos(eciToScene(THREE, propagateECI(el, tSec)));
    trackLine.obj.visible = track.checked;
    if (track.checked) trackLine.set(groundTrackPoints(THREE, el));

    const p = propagate(el, tSec);
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const periodMin = (2 * Math.PI) / el.meanMotion / 60;
    const revDay = (el.meanMotion * 86400) / (2 * Math.PI);
    setText(app, '#roAlt', fmt(p.alt, 1));
    setText(app, '#roSpeed', fmt(speed, 2));
    setText(app, '#roPeriod', fmt(periodMin, 1));
    setText(app, '#roLat', fmt(p.lat, 2));
    setText(app, '#roLon', fmt(p.lon, 2));
    setText(app, '#roRev', fmt(revDay, 2));

    viz.setModeCam('orbit', camRadiusFor(el));
    last = { label, tMin, alt: p.alt, lat: p.lat, lon: p.lon, speed, periodMin };
    viz.refresh();
  }

  const deb = debounce(update, 40);
  target.addEventListener('change', () => {
    customRow.classList.toggle('is-hidden', target.value !== 'custom');
    update();
  });
  altIn.addEventListener('input', deb);
  incIn.addEventListener('input', deb);
  time.addEventListener('input', deb);
  track.addEventListener('change', update);

  wireCopy(/** @type {HTMLElement|null} */ ($('#orbitCopy')), () => {
    if (!last) return '';
    return [
      'ORBITOPS — ORBIT CALCULATOR',
      `TARGET  ${last.label}`,
      `EPOCH   T+${last.tMin} min`,
      `ALT     ${fmt(last.alt, 1)} km`,
      `LAT     ${fmt(last.lat, 2)} deg`,
      `LON     ${fmt(last.lon, 2)} deg`,
      `SPEED   ${fmt(last.speed, 2)} km/s`,
      `PERIOD  ${fmt(last.periodMin, 1)} min`,
      'Kepler two-body propagation (demo engine — no drag/J2/SGP4).',
    ].join('\n');
  });

  update();
}

/* ============================================================
   TOOL 2 — CONJUNCTION CHECKER
   ============================================================ */

/**
 * @param {HTMLElement} app
 * @param {ReturnType<typeof createViz>} viz
 * @param {any} THREE
 */
function wireConjunctionTool(app, viz, THREE) {
  /** @param {string} s */
  const $ = (s) => app.querySelector(s);
  const selA = /** @type {HTMLSelectElement} */ ($('#conjA'));
  const selB = /** @type {HTMLSelectElement} */ ($('#conjB'));
  const win = /** @type {HTMLInputElement} */ ($('#conjWindow'));
  const winOut = /** @type {HTMLElement} */ ($('#conjWindowOut'));
  const hint = /** @type {HTMLElement} */ ($('#conjHint'));
  const notes = /** @type {HTMLElement} */ ($('#conjNotes'));
  const status = /** @type {HTMLElement} */ ($('#rcStatus'));

  const lineA = viz.makeLine('conj', 0xf4f6f8, 0.5);
  const lineB = viz.makeLine('conj', 0x8fc6ff, 0.6);
  const seg = viz.makeLine('conj', 0xe0606e, 0.9);
  const markA = viz.makeReticle('conj', 0xf4f6f8);
  const markB = viz.makeReticle('conj', 0x8fc6ff);

  /** @type {{a: Satellite, b: Satellite, hours: number, ca: {tClosest: number, distanceKm: number}, relSpeed: number, safe: boolean} | null} */
  let last = null;

  /** @param {boolean} on */
  function setPairVisible(on) {
    [lineA, lineB, seg].forEach((l) => { l.obj.visible = on; });
    [markA, markB].forEach((m) => { m.obj.visible = on; });
  }

  function run() {
    const a = SATELLITES.find((s) => s.id === selA.value);
    const b = SATELLITES.find((s) => s.id === selB.value);
    const hours = clampNum(win.value, 1, 48, 24).v;
    winOut.textContent = `${hours} H`;
    if (!a || !b) return;

    if (a.id === b.id) {
      hint.textContent = 'Select two different satellites.';
      hint.classList.add('is-warn');
      ['#rcDist', '#rcTca', '#rcRel'].forEach((id) => setText(app, id, '—'));
      status.textContent = '—';
      status.className = 'tool-readout__value';
      setPairVisible(false);
      viz.setConjWorld(null);
      notes.innerHTML = '<span class="k">Waiting for a valid pair…</span>';
      last = null;
      viz.refresh();
      return;
    }
    hint.textContent = '';
    hint.classList.remove('is-warn');

    // REAL math — unchanged core call
    const ca = closestApproach(a.elements, b.elements, 0, hours * 3600, CONJ_STEP_SEC);

    const pA = propagateECI(a.elements, ca.tClosest);
    const pB = propagateECI(b.elements, ca.tClosest);
    const sA = eciToScene(THREE, pA);
    const sB = eciToScene(THREE, pB);
    lineA.set(eciOrbitPoints(THREE, a.elements));
    lineB.set(eciOrbitPoints(THREE, b.elements));
    seg.set([sA, sB]);
    markA.setPos(sA);
    markB.setPos(sB);
    setPairVisible(true);
    viz.setConjWorld(sA.clone().add(sB).multiplyScalar(0.5), `Δ ${ca.distanceKm.toFixed(2)} KM`);

    const vA = propagate(a.elements, ca.tClosest);
    const vB = propagate(b.elements, ca.tClosest);
    const relSpeed = Math.hypot(vA.vx - vB.vx, vA.vy - vB.vy, vA.vz - vB.vz);
    const safe = ca.distanceKm > SAFE_MISS_KM;

    setText(app, '#rcDist', fmt(ca.distanceKm, 2));
    setText(app, '#rcTca', fmt(ca.tClosest / 3600, 2));
    setText(app, '#rcRel', fmt(relSpeed, 2));
    status.textContent = safe ? 'CLEAR' : 'CONJUNCTION';
    status.className = `tool-readout__value ${safe ? 'val-ok' : 'val-alert'}`;

    const steps = Math.floor((hours * 3600) / CONJ_STEP_SEC) + 1;
    notes.innerHTML = `
      <div><span class="k">SAT A</span> <strong>${a.name}</strong> · ${a.altitude} km · ${a.mission}</div>
      <div><span class="k">SAT B</span> <strong>${b.name}</strong> · ${b.altitude} km · ${b.mission}</div>
      <hr>
      <div><span class="k">THRESHOLD</span> ${SAFE_MISS_KM} km · <span class="k">SAMPLES</span> ${steps} × ${CONJ_STEP_SEC} s</div>
      <div><span class="k">VERDICT</span> <strong>${safe ? 'clear — no action' : 'manoeuvre review required'}</strong></div>
      <hr>
      <div class="tool-caveat">Screening only: brute-force Kepler sampling, no covariance, no collision probability. Operational CA uses CDMs + SGP4.</div>
    `;

    viz.setModeCam('conj', camRadiusFor(a.elements, b.elements));
    last = { a, b, hours, ca, relSpeed, safe };
    viz.refresh();
  }

  const deb = debounce(run, 200);
  selA.addEventListener('change', deb);
  selB.addEventListener('change', deb);
  win.addEventListener('input', deb);

  wireCopy(/** @type {HTMLElement|null} */ ($('#conjCopy')), () => {
    if (!last) return '';
    return [
      'ORBITOPS — CONJUNCTION CHECK',
      `SAT A   ${last.a.name}`,
      `SAT B   ${last.b.name}`,
      `WINDOW  ${last.hours} h · step ${CONJ_STEP_SEC} s`,
      `MISS    ${last.ca.distanceKm.toFixed(2)} km`,
      `TCA     T+${(last.ca.tClosest / 3600).toFixed(2)} h`,
      `REL V   ${last.relSpeed.toFixed(2)} km/s`,
      `STATUS  ${last.safe ? 'CLEAR' : 'CONJUNCTION'} (threshold ${SAFE_MISS_KM} km)`,
      'Brute-force Kepler screening — not operational conjunction assessment.',
    ].join('\n');
  });

  run();
}

/* ============================================================
   TOOL 3 — BURN PLANNER (first-order estimate, demo engine)
   ============================================================ */

/**
 * @param {HTMLElement} app
 * @param {ReturnType<typeof createViz>} viz
 * @param {any} THREE
 */
function wireBurnTool(app, viz, THREE) {
  /** @param {string} s */
  const $ = (s) => app.querySelector(s);
  const satSel = /** @type {HTMLSelectElement} */ ($('#burnSat'));
  const delta = /** @type {HTMLInputElement} */ ($('#burnDelta'));
  const deltaOut = /** @type {HTMLElement} */ ($('#burnDeltaOut'));
  const details = /** @type {HTMLElement} */ ($('#burnDetails'));

  const curLine = viz.makeLine('burn', 0xf4f6f8, 0.5);
  const tgtLine = viz.makeLine('burn', 0x8fc6ff, 0.65, { dashed: true });
  const marker = viz.makeReticle('burn', 0xf4f6f8);

  /** @type {{sat: Satellite, dAlt: number, burn: import('../core/maneuver-planner.js').AvoidanceBurn, newAlt: number, dir: string} | null} */
  let last = null;

  function update() {
    const sat = SATELLITES.find((s) => s.id === satSel.value);
    if (!sat) return;
    const dAlt = clampNum(delta.value, -50, 50, 5).v;
    deltaOut.textContent = `${dAlt >= 0 ? '+' : ''}${dAlt.toFixed(1)} KM`;

    // REAL math — unchanged core call (first-order demo model)
    const burn = avoidanceBurn(sat.elements, dAlt);
    const newAlt = sat.altitude + dAlt;
    const dir = dAlt === 0 ? 'none' : burn.direction;

    setText(app, '#rbDv', fmt(burn.dvMs, 2));
    setText(app, '#rbFuel', fmt(burn.fuelKg, 3));
    setText(app, '#rbDir', dir.toUpperCase());
    setText(app, '#rbAlt', fmt(newAlt, 1));

    // Target orbit: same plane, semi-major axis shifted by dAlt (input prep only)
    const aCur = Math.cbrt(MU / (sat.elements.meanMotion * sat.elements.meanMotion));
    const aNew = aCur + dAlt;
    const elTarget = { ...sat.elements, meanMotion: Math.sqrt(MU / (aNew * aNew * aNew)) };
    curLine.set(eciOrbitPoints(THREE, sat.elements));
    tgtLine.set(eciOrbitPoints(THREE, elTarget));
    marker.setPos(eciToScene(THREE, propagateECI(sat.elements, 0)));

    details.innerHTML = `
      <div><span class="k">ENGINE</span> maneuver-planner · avoidanceBurn()</div>
      <div><span class="k">SAT</span> <strong>${sat.name}</strong> · ${sat.altitude.toFixed(1)} → ${newAlt.toFixed(1)} km · inc ${(sat.elements.inclination * 180 / Math.PI).toFixed(2)}°</div>
      <hr>
      <div>Δv = |Δh| × 3.0 → <strong>${burn.dvMs.toFixed(2)} m/s</strong> <span class="k">(linear demo constant, not vis-viva)</span></div>
      <div>fuel = m_dry·(e^(Δv/vₑ) − 1) → <strong>${burn.fuelKg.toFixed(3)} kg</strong></div>
      <div class="k">vₑ is fixed at 220 m/s inside the demo engine — real hydrazine vₑ ≈ 2.2 km/s, so fuel figures are illustrative only.</div>
      <div><span class="k">ALT PLAN</span> single-burn: ${burn.alternative.dvMs.toFixed(2)} m/s / ${burn.alternative.fuelKg.toFixed(3)} kg <span class="k">— faster, more fuel</span></div>
      <hr>
      <div class="tool-caveat">First-order estimate (demo). This simplified calculator gives order-of-magnitude numbers for visualisation only. Operational manoeuvre planning requires SGP4 + numerical integration — do not use these numbers to fly a satellite.</div>
    `;

    viz.setModeCam('burn', camRadiusFor(sat.elements, elTarget));
    last = { sat, dAlt, burn, newAlt, dir };
    viz.refresh();
  }

  const deb = debounce(update, 40);
  satSel.addEventListener('change', update);
  delta.addEventListener('input', deb);

  wireCopy(/** @type {HTMLElement|null} */ ($('#burnCopy')), () => {
    if (!last) return '';
    return [
      'ORBITOPS — BURN PLAN · FIRST-ORDER ESTIMATE (DEMO)',
      `SAT     ${last.sat.name}`,
      `DELTA-H ${last.dAlt >= 0 ? '+' : ''}${last.dAlt.toFixed(1)} km (${last.dir})`,
      `DELTA-V ${last.burn.dvMs.toFixed(2)} m/s`,
      `FUEL    ${last.burn.fuelKg.toFixed(3)} kg`,
      `NEW ALT ${last.newAlt.toFixed(1)} km`,
      'Demo engine output — do not use to fly a satellite.',
    ].join('\n');
  });

  update();
}

/* ============================================================
   TOOL 4 — PASS PREDICTOR (W4-C · D3 — REAL, client-side)

   Unlike tools 1–3 (demo Kepler catalog), honest ground passes need real
   element sets: the demo constellation's synthetic elements would predict
   fictional passes over a real city. So this tool pulls the same CelesTrak
   TLE source the cockpit/dashboard use (stations + a sampled slice of
   Starlink/OneWeb) and runs core/passes.js — SGP4 → gstime → eciToEcf →
   ecfToLookAngles, 30 s steps over 24 h. Catalog + math load lazily on
   first tab activation so the initial page stays light.
   ============================================================ */

const PASS_SITES_STEP_SEC = 30;
const PASS_WINDOW_H = 24;
const PASS_MAX_SHOWN = 5;

/** @param {HTMLElement} app */
function wirePassTool(app) {
  /** @param {string} s */
  const $ = (s) => app.querySelector(s);
  const preset = /** @type {HTMLSelectElement} */ ($('#passPreset'));
  const latIn = /** @type {HTMLInputElement} */ ($('#passLat'));
  const lonIn = /** @type {HTMLInputElement} */ ($('#passLon'));
  const satSel = /** @type {HTMLSelectElement} */ ($('#passSat'));
  const srcOut = /** @type {HTMLElement} */ ($('#passSatSrc'));
  const minElIn = /** @type {HTMLInputElement} */ ($('#passMinEl'));
  const hint = /** @type {HTMLElement} */ ($('#passHint'));
  const list = /** @type {HTMLElement} */ ($('#passList'));
  const foot = /** @type {HTMLElement} */ ($('#passFoot'));

  /** @type {SatObject[]} */
  let cat = [];          // [{name, noradId, satrec, group}] — real TLE objects
  /** @type {typeof import('../core/passes.js').predictPasses | null} */
  let predictPasses = null;
  let loadState = 'idle'; // idle | loading | ready | failed
  /** @type {{sat: SatObject, lat: number, lon: number, minEl: number, passes: any[], start: Date, age: number} | null} */
  let last = null;

  /** @param {Date} d */
  const hhmmss = (d) => d.toISOString().slice(11, 19);
  /** @param {Date} d @param {Date} ref */
  const daySuffix = (d, ref) => (d.toISOString().slice(0, 10) !== ref.toISOString().slice(0, 10) ? ' +1D' : '');
  /** @param {number} sec */
  const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

  /**
   * TLE epoch age in days — real, from the satrec's Julian epoch.
   * @param {any} satrec
   */
  function tleAgeDays(satrec) {
    const nowJd = Date.now() / 86400000 + 2440587.5;
    return Number.isFinite(satrec.jdsatepoch) ? nowJd - satrec.jdsatepoch : NaN;
  }

  async function initCatalog() {
    if (loadState === 'loading' || loadState === 'ready') return;
    loadState = 'loading';
    satSel.innerHTML = '<option>Loading real catalog…</option>';
    list.innerHTML = '<div class="pass-empty">Fetching element sets from CelesTrak (or local cache)…</div>';
    try {
      const [{ loadConstellation }, passes] = await Promise.all([
        import('../core/live-constellation.js'),
        import('../core/passes.js'),
      ]);
      predictPasses = passes.predictPasses;
      // Stations fully (ISS lives here), plus an even sample of the big shells.
      const st = await loadConstellation(['stations'], { max: 30 });
      const leo = await loadConstellation(['starlink', 'oneweb'], { max: 30 });
      cat = [...st.sats, ...leo.sats];
      if (!cat.length) throw new Error('empty catalog');

      /** @type {Record<string, number>} */
      const worst = { live: 0, cache: 1, snapshot: 2 };
      const srcName = worst[st.source] >= worst[leo.source] ? st.source : leo.source;
      /** @type {Record<string, string>} */
      const srcLabels = { live: 'LIVE', cache: 'CACHED', snapshot: 'SNAPSHOT' };
      srcOut.textContent = srcLabels[srcName] || '';

      /** @param {SatObject} s */
      const opt = (s) => `<option value="${s.noradId}">${esc(s.name)} · ${s.noradId}</option>`;
      satSel.innerHTML =
        `<optgroup label="Stations (full group)">${st.sats.map(opt).join('')}</optgroup>` +
        `<optgroup label="Starlink / OneWeb (sampled)">${leo.sats.map(opt).join('')}</optgroup>`;
      const iss = st.sats.find((s) => s.name.toUpperCase().includes('ISS'));
      if (iss) satSel.value = String(iss.noradId);
      satSel.disabled = false;
      loadState = 'ready';
      run();
    } catch (err) {
      console.error('pass predictor: catalog load failed', err);
      loadState = 'failed';
      satSel.innerHTML = '<option>Catalog unavailable</option>';
      list.innerHTML = '<div class="pass-empty">Could not load a real element set — no passes will be invented. Retry when back online.</div>';
    }
  }

  function run() {
    if (loadState !== 'ready' || !predictPasses) return;
    const sat = cat.find((s) => String(s.noradId) === satSel.value);
    if (!sat) return;

    const lat = clampNum(latIn.value, -90, 90, 40.42);
    const lon = clampNum(lonIn.value, -180, 180, -3.70);
    const minEl = clampNum(minElIn.value, 0, 85, 10);
    hint.textContent = '';
    hint.classList.remove('is-warn');
    if (lat.clamped || lon.clamped || minEl.clamped) {
      hint.textContent = 'Clamped to honest ranges: lat ±90°, lon ±180°, mask 0–85°.';
      hint.classList.add('is-warn');
    }

    const start = new Date();
    const passes = predictPasses(sat.satrec, { latDeg: lat.v, lonDeg: lon.v }, {
      hours: PASS_WINDOW_H,
      stepSec: PASS_SITES_STEP_SEC,
      minElevationDeg: minEl.v,
      maxPasses: PASS_MAX_SHOWN,
      start,
    });

    const next = passes[0] || null;
    setText(app, '#rpAos', next ? hhmmss(next.aos) : '—');
    setText(app, '#rpMaxEl', next ? next.maxElDeg.toFixed(1) : '—');
    setText(app, '#rpDur', next ? (/** @type {number} */ (next.durSec) / 60).toFixed(1) : '—');
    // capped at PASS_MAX_SHOWN — "+" keeps the count honest when more exist
    setText(app, '#rpCount', passes.length >= PASS_MAX_SHOWN ? `${PASS_MAX_SHOWN}+` : String(passes.length));

    if (!passes.length) {
      list.innerHTML = `<div class="pass-empty">No passes above ${minEl.v}° from this site in the next 24 h — real answer, not an error.</div>`;
    } else {
      list.innerHTML = passes.map((p, i) => `
        <div class="pass-row" ${i === 0 ? 'data-next="1"' : ''}>
          <span class="pass-row__idx">${String(i + 1).padStart(2, '0')}</span>
          <span class="pass-row__cell">${hhmmss(p.aos)}${daySuffix(p.aos, start)}${p.partialStart ? '<i class="pass-row__flag">IN PROGRESS</i>' : ''}</span>
          <span class="pass-row__cell">${hhmmss(p.los)}${daySuffix(p.los, start)}${p.partialEnd ? '<i class="pass-row__flag">WINDOW END</i>' : ''}</span>
          <span class="pass-row__cell">${mmss(/** @type {number} */ (p.durSec))}</span>
          <span class="pass-row__cell pass-row__cell--el">${p.maxElDeg.toFixed(1)}°</span>
        </div>`).join('');
    }

    const age = tleAgeDays(sat.satrec);
    foot.textContent = Number.isFinite(age)
      ? `${sat.name} · TLE EPOCH AGE ${age.toFixed(1)} D · ${PASS_SITES_STEP_SEC} S SAMPLING`
      : `${sat.name} · ${PASS_SITES_STEP_SEC} S SAMPLING`;

    last = { sat, lat: lat.v, lon: lon.v, minEl: minEl.v, passes, start, age };
  }

  const deb = debounce(run, 200);

  // Lazy init on first activation of this tab (own listener; the shared tab
  // handler in mount() is untouched).
  const passTab = app.querySelector('.tools-tab[data-tool="passes"]');
  if (passTab) passTab.addEventListener('click', initCatalog);

  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const [la, lo] = preset.value.split(',').map(Number);
    latIn.value = String(la);
    lonIn.value = String(lo);
    run();
  });
  const onCoordInput = () => { preset.value = 'custom'; deb(); };
  latIn.addEventListener('input', onCoordInput);
  lonIn.addEventListener('input', onCoordInput);
  minElIn.addEventListener('input', deb);
  satSel.addEventListener('change', run);

  wireCopy(/** @type {HTMLElement|null} */ ($('#passCopy')), () => {
    if (!last) return '';
    const rows = last.passes.map((p, i) =>
      `#${i + 1}  AOS ${hhmmss(p.aos)}  LOS ${hhmmss(p.los)}  DUR ${mmss(/** @type {number} */ (p.durSec))}  MAX EL ${p.maxElDeg.toFixed(1)} deg`);
    return [
      'ORBITOPS — PASS PREDICTOR (REAL · SGP4 + TLE)',
      `SAT     ${last.sat.name} (NORAD ${last.sat.noradId})`,
      `SITE    ${last.lat.toFixed(2)}, ${last.lon.toFixed(2)} · mask ${last.minEl} deg`,
      `WINDOW  24 h from ${last.start.toISOString().slice(0, 16)}Z · step ${PASS_SITES_STEP_SEC} s`,
      `TLE AGE ${Number.isFinite(last.age) ? last.age.toFixed(1) + ' d' : 'unknown'}`,
      ...(rows.length ? rows : ['NO PASSES ABOVE MASK IN WINDOW']),
      'TLE accuracy degrades over days — verify before pointing anything expensive.',
    ].join('\n');
  });
}

/* ============================================================
   UTILS
   ============================================================ */

/**
 * @param {HTMLElement} app
 * @param {string} sel
 * @param {string} txt
 */
function setText(app, sel, txt) {
  const el = app.querySelector(sel);
  if (el) el.textContent = txt;
}

/**
 * @param {number} n
 * @param {number} [digits=2]
 */
function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

/**
 * @param {(...args: any[]) => void} fn
 * @param {number} ms
 */
function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t;
  /** @param {...any} args */
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Parse + clamp a numeric input. Never returns NaN.
 * @param {unknown} raw
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {{v: number, clamped: boolean}}
 */
function clampNum(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { v: fallback, clamped: true };
  if (n < min) return { v: min, clamped: true };
  if (n > max) return { v: max, clamped: true };
  return { v: n, clamped: false };
}

/**
 * @param {HTMLElement|null} btn
 * @param {() => string} buildText
 */
function wireCopy(btn, buildText) {
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const txt = buildText();
    if (!txt) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(txt);
      ok = true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (_) { ok = false; }
    }
    btn.textContent = ok ? 'COPIED' : 'COPY FAILED';
    btn.classList.toggle('is-done', ok);
    setTimeout(() => {
      btn.textContent = 'COPY RESULTS';
      btn.classList.remove('is-done');
    }, 1300);
  });
}
