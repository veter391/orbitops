// @ts-check
/**
 * Toast notifications.
 *
 * Lightweight helper — creates a fixed-position toast stack at the
 * top-right of the viewport. Used for non-blocking operator feedback.
 *
 * @module ui/toast
 */

'use strict';

import { uid, esc } from '../utils.js';

/**
 * @typedef {object} ToastOpts
 * @property {'info'|'success'|'warn'|'error'} [kind]
 * @property {number} [durationMs]
 * @property {string} [title]
 */

/** @type {HTMLElement|null} */
let host = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-stack';
  document.body.appendChild(host);
  return host;
}

/**
 * Show a toast. Returns its id (for `dismiss`).
 * @param {string} message
 * @param {ToastOpts} [opts]
 * @returns {string}
 */
export function toast(message, { kind = 'info', durationMs = 4000, title } = {}) {
  const h = ensureHost();
  const id = uid();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.dataset.toast = id;
  const icon =
    kind === 'success' ? '✓' :
    kind === 'warn' ? '!' :
    kind === 'error' ? '✗' : 'i';
  // esc() message/title here so the shared helper is safe BY CONSTRUCTION — a
  // future caller passing a dynamic string (e.g. an error .message) can never
  // reintroduce XSS. icon is a fixed internal enum.
  el.innerHTML = `
    <div class="toast__icon">${icon}</div>
    <div class="toast__body">
      ${title ? `<div class="toast__title">${esc(title)}</div>` : ''}
      <div class="toast__msg">${esc(message)}</div>
    </div>
    <button class="toast__close" aria-label="Close">×</button>
  `;
  el.querySelector('.toast__close')?.addEventListener('click', () => dismiss(id));
  h.appendChild(el);
  // animate in
  requestAnimationFrame(() => el.classList.add('is-show'));
  if (durationMs > 0) {
    setTimeout(() => dismiss(id), durationMs);
  }
  return id;
}

/** @param {string} id */
export function dismiss(id) {
  const el = host?.querySelector(`[data-toast="${id}"]`);
  if (!el) return;
  el.classList.remove('is-show');
  setTimeout(() => el.remove(), 250);
}

/** @param {string} msg @param {ToastOpts} [opts] */
export function success(msg, opts = {}) { return toast(msg, { ...opts, kind: 'success' }); }
/** @param {string} msg @param {ToastOpts} [opts] */
export function warn(msg, opts = {}) { return toast(msg, { ...opts, kind: 'warn' }); }
/** @param {string} msg @param {ToastOpts} [opts] */
export function error(msg, opts = {}) { return toast(msg, { ...opts, kind: 'error' }); }
/** @param {string} msg @param {ToastOpts} [opts] */
export function info(msg, opts = {}) { return toast(msg, { ...opts, kind: 'info' }); }