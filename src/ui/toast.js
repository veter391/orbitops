/**
 * Toast notifications.
 *
 * Lightweight helper — creates a fixed-position toast stack at the
 * top-right of the viewport. Used for non-blocking operator feedback.
 *
 * @module ui/toast
 */

'use strict';

import { uid } from '../utils.js';

let host = null;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-stack';
  document.body.appendChild(host);
  return host;
}

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
  el.innerHTML = `
    <div class="toast__icon">${icon}</div>
    <div class="toast__body">
      ${title ? `<div class="toast__title">${title}</div>` : ''}
      <div class="toast__msg">${message}</div>
    </div>
    <button class="toast__close" aria-label="Close">×</button>
  `;
  el.querySelector('.toast__close').addEventListener('click', () => dismiss(id));
  h.appendChild(el);
  // animate in
  requestAnimationFrame(() => el.classList.add('is-show'));
  if (durationMs > 0) {
    setTimeout(() => dismiss(id), durationMs);
  }
  return id;
}

export function dismiss(id) {
  const el = host?.querySelector(`[data-toast="${id}"]`);
  if (!el) return;
  el.classList.remove('is-show');
  setTimeout(() => el.remove(), 250);
}

export function success(msg, opts = {}) { return toast(msg, { ...opts, kind: 'success' }); }
export function warn(msg, opts = {}) { return toast(msg, { ...opts, kind: 'warn' }); }
export function error(msg, opts = {}) { return toast(msg, { ...opts, kind: 'error' }); }
export function info(msg, opts = {}) { return toast(msg, { ...opts, kind: 'info' }); }