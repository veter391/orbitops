// @ts-check
/**
 * Operator console mode — a presentation MODE, not a second design.
 *
 * The cinematic look stays the default for the public site. Console mode is the
 * operator-grade alternative the community asked for (CERN-VISTAR archetype):
 * higher contrast, denser layout, near-zero motion, no decorative atmosphere.
 * It is implemented as ONE root attribute (`<html data-console>`) plus one
 * stylesheet whose every rule is scoped under that attribute — with the mode
 * off, the shipped design is untouched by construction.
 *
 * Defaults: OFF on the public site; ON in self-host/app mode (`APP_MODE` —
 * operators boot straight to the dashboard, so they get the operator skin).
 * Either default is overridable from Settings, persisted per browser.
 *
 * Toggling reloads the page: the mode changes mount-time decisions (ambient
 * scenes, cursor satellite, dock magnification), and a reload guarantees a
 * fully-applied state instead of a half-switched one.
 *
 * @module core/console-mode
 */

'use strict';

import { isAppMode } from './app-config.js';

const CONSOLE_KEY = 'orbitops:settings:consoleMode';
const FX_AMBIENT_KEY = 'orbitops:settings:fxAmbient';

/** @param {string} k @returns {string} */
function ls(k) {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
}

/** @returns {boolean} true when operator console mode is active. */
export function isConsoleMode() {
  const stored = ls(CONSOLE_KEY);
  if (stored === '1') return true;
  if (stored === '0') return false;
  // No explicit choice: operators (self-host app mode) default to console.
  return isAppMode();
}

/**
 * Persist the mode and reload so every mount-time decision re-runs under the
 * new mode. @param {boolean} on
 */
export function setConsoleMode(on) {
  try {
    localStorage.setItem(CONSOLE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable — the attribute below still applies this session */
  }
  window.location.reload();
}

/**
 * Apply the mode to the document root. Called once, first thing in boot,
 * before any page mounts — everything downstream (CSS and JS) keys off it.
 */
export function applyConsoleMode() {
  document.documentElement.toggleAttribute('data-console', isConsoleMode());
}

/**
 * Whether ambient atmosphere layers (starfield, drifting vector objects) may
 * mount. Honors BOTH the Settings "Ambient scene" toggle (stored for every
 * page, checked here so it actually governs every page) and console mode.
 * @returns {boolean}
 */
export function ambientAllowed() {
  if (isConsoleMode()) return false;
  return ls(FX_AMBIENT_KEY) !== '0';
}
