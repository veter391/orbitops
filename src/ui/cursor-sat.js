// @ts-check
/**
 * Global cursor-follow satellite (chrome B4).
 *
 * A ~28px hairline satellite trails the cursor with rAF lerp spring lag and
 * rotates toward its direction of travel. After 4 s idle it parks in the
 * bottom-right corner. Same proven mechanics as the home-page easter egg
 * (src/pages/home.js createCursorSatellite) — extracted here so main.js can
 * mount ONE instance across route changes on every non-home route (home
 * keeps its own page-local instance; this module never edits home.js).
 *
 * Double-mount guard: `window.__orbitopsCursorSat` is set while a global
 * instance is alive and checked before mounting. Styles live in
 * chrome-v2.css under `.oo-cursat` (globally loaded — home-v3.css is not).
 *
 * @module ui/cursor-sat
 */

'use strict';

/**
 * Mount the global cursor satellite. Self-gates: desktop viewport,
 * hover-capable fine pointer, and reduced-motion off — otherwise a no-op.
 *
 * @returns {{unmount: () => void}} unmount cancels rAF, removes the listener
 *   and element, and releases the global flag. Safe to call twice.
 */
export function mountCursorSat() {
  const noop = { unmount() {} };
  if (window.__orbitopsCursorSat) return noop;
  const allowed =
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    window.innerWidth > 880;
  if (!allowed) return noop;

  window.__orbitopsCursorSat = true;

  const el = document.createElement('div');
  el.className = 'oo-cursat';
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

  // SVG is 28×15 — half-extents used to centre the body on the pointer tip.
  const HALF_W = 14;
  const HALF_H = 7;
  const park = () => ({ x: window.innerWidth - 52, y: window.innerHeight - 46 });
  let { x, y } = park();
  let tx = x;
  let ty = y;
  let rot = 0;
  let lastMove = -Infinity; // starts parked until the pointer moves
  let rafId = 0;
  let dead = false;
  // "Lock" mode — a page can pull the satellite onto the exact pointer tip
  // (rather than the usual trailing offset) via window events. The cockpit
  // uses it so that hovering an object on the globe snaps this satellite onto
  // the cursor. Off everywhere else; released on unmount.
  let locked = false;

  /** @param {PointerEvent} e */
  const onMove = (e) => {
    if (locked) {
      tx = e.clientX - HALF_W; // centre the body on the tip, no trailing offset
      ty = e.clientY - HALF_H;
    } else {
      tx = e.clientX + 16;
      ty = e.clientY + 16;
    }
    lastMove = performance.now();
  };

  /** @param {number} now */
  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    if (!locked && now - lastMove > 4000) {
      const p = park();
      tx = p.x;
      ty = p.y;
    }
    const k = locked ? 0.28 : 0.085; // snap crisper while locked to the tip
    const dx = tx - x;
    const dy = ty - y;
    x += dx * k;
    y += dy * k;
    if (dx * dx + dy * dy > 9) {
      const target = (Math.atan2(dy, dx) * 180) / Math.PI;
      const d = ((target - rot + 540) % 360) - 180;
      rot += d * 0.12;
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
  };
  rafId = requestAnimationFrame(frame);
  window.addEventListener('pointermove', onMove, { passive: true });

  const onLock = () => { locked = true; lastMove = performance.now(); el.classList.add('is-locked'); };
  const onUnlock = () => { locked = false; lastMove = performance.now(); el.classList.remove('is-locked'); };
  window.addEventListener('orbitops:cursat-lock', onLock);
  window.addEventListener('orbitops:cursat-unlock', onUnlock);

  return {
    unmount() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('orbitops:cursat-lock', onLock);
      window.removeEventListener('orbitops:cursat-unlock', onUnlock);
      el.remove();
      window.__orbitopsCursorSat = false;
    },
  };
}
