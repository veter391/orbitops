// @ts-check
/**
 * hint.js — a styled, accessible tooltip that never clips.
 *
 * The popover is rendered in a PORTAL: a single `position: fixed` element on
 * <body>, positioned per-hover with getBoundingClientRect and clamped to the
 * viewport. That escapes every `overflow: hidden` / stacking context, so a
 * tooltip can't be swallowed by the panel or section it lives in — the bug a
 * CSS-only (absolutely-positioned) popover has.
 *
 * `hint()` emits only the trigger markup (data-attributes carry the content);
 * `initHints()` wires one global controller. The "Learn how →" link carries
 * `data-route`, so the SPA router's own click handler navigates it.
 *
 * @module ui/hint
 */

'use strict';

import { esc } from '../utils.js';

/**
 * Wrap a label in a hover/focus tooltip trigger.
 *
 * @param {string} labelHtml  the visible label markup (e.g. an amber chip span).
 * @param {string} text       one/two-sentence explanation shown in the tooltip.
 * @param {object} [opts]
 * @param {string} [opts.docRoute]   SPA route the "Learn how →" link goes to.
 * @param {string} [opts.linkText='Learn how →']  the link label.
 * @param {'up'|'down'} [opts.place='up']  preferred side (auto-flips near edges).
 * @returns {string} HTML string.
 */
export function hint(labelHtml, text, opts = {}) {
  const { docRoute = '', linkText = 'Learn how →', place = 'up' } = opts;
  const doc = docRoute ? ` data-hint-doc="${esc(docRoute)}" data-hint-link="${esc(linkText)}"` : '';
  return (
    `<span class="hint" tabindex="0" role="button" aria-label="${esc(text)}"` +
    ` data-hint="${esc(text)}"${doc} data-hint-place="${esc(place)}">` +
    labelHtml +
    `</span>`
  );
}

/** @type {HTMLElement|null} */
let pop = null;
/** @type {HTMLElement|null} */
let active = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let hideTimer = null;

/** Lazily create the single portal popover. */
function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'hint-pop';
  pop.setAttribute('role', 'tooltip');
  // Keep it open while the pointer is inside it (so the link is clickable).
  pop.addEventListener('pointerenter', () => {
    if (hideTimer) clearTimeout(hideTimer);
  });
  pop.addEventListener('pointerleave', scheduleHide);
  document.body.appendChild(pop);
  return pop;
}

/** @param {HTMLElement} trigger */
function show(trigger) {
  const text = trigger.getAttribute('data-hint') || '';
  const doc = trigger.getAttribute('data-hint-doc') || '';
  const linkText = trigger.getAttribute('data-hint-link') || 'Learn how →';
  const place = trigger.getAttribute('data-hint-place') || 'up';
  const el = ensurePop();
  el.innerHTML =
    `<span class="hint-pop__text">${esc(text)}</span>` +
    (doc ? `<a class="hint-pop__link" href="${esc(doc)}" data-route="${esc(doc)}">${esc(linkText)}</a>` : '');

  // Make it measurable, then position (fixed = viewport coords).
  el.classList.add('is-shown');
  const r = trigger.getBoundingClientRect();
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  const M = 8;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(M, Math.min(left, window.innerWidth - pw - M));
  let top = place === 'down' ? r.bottom + 9 : r.top - ph - 9;
  // Flip if it would leave the viewport.
  if (top < M) top = r.bottom + 9;
  if (top + ph > window.innerHeight - M) top = r.top - ph - 9;
  top = Math.max(M, Math.min(top, window.innerHeight - ph - M));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  active = trigger;
  if (hideTimer) clearTimeout(hideTimer);
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (pop) pop.classList.remove('is-shown');
    active = null;
  }, 140);
}

function hideNow() {
  if (hideTimer) clearTimeout(hideTimer);
  if (pop) pop.classList.remove('is-shown');
  active = null;
}

/**
 * Install the global hint controller once. Idempotent. Call after boot.
 * @returns {void}
 */
export function initHints() {
  if (/** @type {any} */ (window).__orbitopsHints) return;
  /** @type {any} */ (window).__orbitopsHints = true;

  document.addEventListener('pointerover', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const trigger = t && t.closest ? /** @type {HTMLElement|null} */ (t.closest('.hint')) : null;
    if (trigger && trigger !== active) show(trigger);
  });
  document.addEventListener('pointerout', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const trigger = t && t.closest ? t.closest('.hint') : null;
    if (trigger) scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const trigger = t && t.closest ? /** @type {HTMLElement|null} */ (t.closest('.hint')) : null;
    if (trigger) show(trigger);
  });
  document.addEventListener('focusout', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const trigger = t && t.closest ? t.closest('.hint') : null;
    if (trigger) scheduleHide();
  });
  // Dismiss on navigation (link clicked) or Escape, and on scroll (position goes stale).
  document.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    if (t && t.closest && t.closest('[data-route]')) hideNow();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideNow();
  });
  window.addEventListener('scroll', hideNow, { passive: true, capture: true });
}
