// @ts-check
/**
 * ambient.js — shared "space life" background layer for OrbitOps pages.
 *
 * Renders a layered, monochrome-hairline ambient scene inside a host element:
 *   1. Sparse 2-depth starfield (canvas) with scroll parallax at two rates.
 *   2. Optional drifting vector object (hairline SVG satellite or station)
 *      traversing the viewport on a gentle diagonal over ~90-140 s.
 *   3. A faint dotted orbit-arc path behind everything.
 *
 * Design constraints (v3): opacity ≤ .5, pointer-events none, DPR capped,
 * paused when the tab is hidden, static under prefers-reduced-motion,
 * every rAF/listener cleaned up on unmount. Zero dependencies.
 *
 * Usage:
 *   import { mountAmbient } from './ambient.js';
 *   const ambient = mountAmbient(pageEl, { object: 'satellite' });
 *   // later: ambient.unmount();
 *
 * @param {HTMLElement} host  Container. Gets position:relative if static.
 * @param {Object}   [opts]
 * @param {'satellite'|'station'|'none'} [opts.object='none']  Drifting object.
 * @param {number}   [opts.density=1]   Star density multiplier (auto-halved < 768 px).
 * @param {number}   [opts.zIndex=0]    z-index of the ambient layer.
 * @returns {{ unmount: () => void }}
 */

'use strict';

import { ambientAllowed } from '../core/console-mode.js';

const DPR_CAP = 1.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* Hairline SVG objects — body + panels, monochrome strokes only. */
const OBJECT_SVGS = {
  satellite: `
    <svg xmlns="${SVG_NS}" width="84" height="44" viewBox="0 0 84 44" fill="none"
      stroke="rgba(255,255,255,0.42)" stroke-width="1">
      <rect x="34" y="15" width="16" height="14" rx="1"/>
      <rect x="4" y="18" width="24" height="8"/>
      <path d="M10 18v8M16 18v8M22 18v8"/>
      <rect x="56" y="18" width="24" height="8"/>
      <path d="M62 18v8M68 18v8M74 18v8"/>
      <path d="M28 22h6M50 22h6"/>
      <path d="M42 15V8"/><circle cx="42" cy="6" r="2"/>
    </svg>`,
  station: `
    <svg xmlns="${SVG_NS}" width="96" height="56" viewBox="0 0 96 56" fill="none"
      stroke="rgba(255,255,255,0.42)" stroke-width="1">
      <path d="M8 28h80"/>
      <rect x="38" y="20" width="20" height="16" rx="1"/>
      <rect x="26" y="23" width="12" height="10"/>
      <rect x="58" y="23" width="12" height="10"/>
      <rect x="8" y="12" width="10" height="32"/><path d="M13 12v32"/>
      <rect x="78" y="12" width="10" height="32"/><path d="M83 12v32"/>
      <path d="M48 20v-8"/><circle cx="48" cy="10" r="2"/>
    </svg>`,
};

/**
 * @param {HTMLElement} host
 * @param {{object?: 'satellite'|'station'|'none', density?: number, zIndex?: number}} [opts]
 * @returns {{unmount: () => void}}
 */
export function mountAmbient(host, opts = {}) {
  const { object = 'none', density = 1, zIndex = 0 } = opts;

  // Atmosphere is decoration. The Settings "Ambient scene" toggle and the
  // operator console mode both turn it off entirely — return an inert handle
  // so callers need no special-casing.
  if (!ambientAllowed()) return { unmount() {} };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const layer = document.createElement('div');
  layer.className = 'ambient-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText =
    `position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:${zIndex};contain:strict;`;
  host.prepend(layer);

  /* -- 1 · dotted orbit-arc path (static, faintest layer) ----------------- */
  const arc = document.createElementNS(SVG_NS, 'svg');
  arc.setAttribute('viewBox', '0 0 1200 800');
  arc.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  arc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:.5;';
  arc.innerHTML =
    `<path d="M -60 620 Q 600 180 1260 470" fill="none"
       stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-dasharray="1 7"/>`;
  layer.appendChild(arc);

  /* -- 2 · two-depth starfield (canvas) ----------------------------------- */
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:.5;';
  layer.appendChild(canvas);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  if (!ctx) return { unmount() {} }; // no 2D context — nothing to render (defensive)

  /** @type {Array<{x: number, y: number, r: number, a: number, rate: number}>} */
  let stars = [];
  let w = 0;
  let h = 0;
  let dpr = 1;

  function seedStars() {
    w = layer.clientWidth;
    h = layer.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mobile = window.innerWidth < 768 ? 0.5 : 1;
    const count = Math.round(((w * h) / 24000) * density * mobile);
    stars = Array.from({ length: count }, (_, i) => {
      const far = i % 5 < 3; // 60 % far layer, 40 % near
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: far ? 0.4 + Math.random() * 0.4 : 0.7 + Math.random() * 0.6,
        a: far ? 0.10 + Math.random() * 0.16 : 0.18 + Math.random() * 0.26,
        rate: far ? 0.05 : 0.14, // parallax: near stars slide faster on scroll
      };
    });
  }

  function drawStars() {
    const scrollY = reduced ? 0 : window.scrollY || 0;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FFFFFF';
    for (const s of stars) {
      const y = ((s.y - scrollY * s.rate) % h + h) % h; // wrap into view
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* -- 3 · drifting hairline object --------------------------------------- */
  /** @type {HTMLDivElement|null} */
  let objectEl = null;
  const drift = {
    duration: (90 + Math.random() * 50) * 1000, // 90-140 s per crossing
    t0: performance.now(),
  };

  if (object !== 'none' && OBJECT_SVGS[object]) {
    objectEl = document.createElement('div');
    objectEl.innerHTML = OBJECT_SVGS[object];
    objectEl.style.cssText = 'position:absolute;top:0;left:0;opacity:.4;will-change:transform;';
    layer.appendChild(objectEl);
  }

  /** @param {number} now */
  function placeObject(now) {
    if (!objectEl) return;
    // Gentle diagonal, upper-left → lower-right, wrapping; subtle slow roll.
    // Vertical band is anchored to viewport height so the crossing stays
    // visible near the top of the page even when the host is very tall.
    const vh = Math.min(h, window.innerHeight || h);
    const t = reduced ? 0.68 : ((now - drift.t0) / drift.duration) % 1;
    const x = -0.12 * w + t * (w * 1.24);
    const y = 0.10 * vh + t * (vh * 0.55);
    const rot = -6 + t * 18;
    objectEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
  }

  /* -- animation & lifecycle ---------------------------------------------- */
  let rafId = 0;
  let dirty = true; // stars only repaint when scroll/resize changed them

  /** @param {number} now */
  function frame(now) {
    if (dirty) { drawStars(); dirty = false; }
    placeObject(now);
    rafId = requestAnimationFrame(frame);
  }

  const onScroll = () => { dirty = true; };
  const onResize = () => { seedStars(); dirty = true; };
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!reduced && !rafId) {
      rafId = requestAnimationFrame(frame);
    }
  };

  seedStars();
  drawStars();
  placeObject(performance.now());

  window.addEventListener('resize', onResize, { passive: true });
  if (!reduced) {
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    rafId = requestAnimationFrame(frame);
  }

  return {
    unmount() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      layer.remove();
    },
  };
}
