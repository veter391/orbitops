/**
 * OrbitOps — main entry.
 *
 * Routes:
 *   /          — cinematic home
 *   /cockpit   — full-screen mission control
 *   /agent     — AI agent deep-dive
 *   /dashboard — live constellation health
 *   /tools     — interactive mini-tools
 *   /pricing   — enterprise pricing
 *   /docs      — engineering documentation
 */

'use strict';

import { router } from './router.js';
import { info } from './ui/toast.js';

const boot = document.getElementById('boot');
const bootMsg = document.getElementById('bootMsg');
const bootSub = document.getElementById('bootSub');
const app = document.getElementById('app');
const topNav = document.getElementById('topNav');
if (topNav) topNav.classList.add('top-nav');

const t0 = performance.now();
const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(2)}s`;

function setBoot(msg) {
  if (bootMsg) bootMsg.textContent = msg;
  if (bootSub) bootSub.textContent = elapsed();
}

function hideBoot() {
  if (!boot) return;
  boot.classList.add('is-hidden');
  setTimeout(() => boot.remove(), 600);
}

function fatalBoot(title, detail, error) {
  console.error('[OrbitOps] boot failed:', error);
  if (!boot) return;
  boot.innerHTML = `
    <div class="boot__inner">
      <svg class="boot__mark" style="color: var(--alert); animation: none;" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2"/>
        <path d="M22 22 L42 42 M42 22 L22 42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div class="boot__title" style="color: var(--alert);">${title}</div>
      <div class="boot__msg">${detail}</div>
      ${error ? `<pre class="boot__error">${String(error.stack || error.message || error).replace(/</g, '&lt;')}</pre>` : ''}
      <button class="boot__btn" id="bootContinue">Continue without demo →</button>
    </div>
  `;
  document.getElementById('bootContinue')?.addEventListener('click', () => {
    boot.classList.add('is-hidden');
    setTimeout(() => boot.remove(), 400);
  });
}

async function main() {
  try {
    setBoot('Initializing orbital mechanics…');
    await sleep(60);
    setBoot('Loading satellite catalogue…');
    await sleep(60);
    setBoot('Training anomaly baselines…');
    await sleep(60);
    setBoot('Establishing audit chain…');
    await sleep(60);
    setBoot('Ready.');

    // Top nav — flat 3-column layout: [brand][links][cta]
    if (topNav) {
      topNav.innerHTML = `
        <div class="top-nav__left">
          <a href="/" data-route="/" class="top-nav__brand">
            <svg class="top-nav__brand-logo" viewBox="0 0 32 32" fill="none">
              <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>
              <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55" transform="rotate(60 16 16)"/>
              <ellipse cx="16" cy="16" rx="14" ry="5" stroke="currentColor" stroke-width="1.4" opacity="0.55" transform="rotate(-60 16 16)"/>
              <circle cx="16" cy="16" r="3.5" fill="currentColor"/>
            </svg>
            <span class="top-nav__brand-text">ORBIT OPS</span>
          </a>
          <nav class="top-nav__links">
            <a href="/cockpit" data-route="/cockpit">Cockpit</a>
            <a href="/agent" data-route="/agent">Agent</a>
            <a href="/dashboard" data-route="/dashboard">Dashboard</a>
            <a href="/tools" data-route="/tools">Tools</a>
            <a href="/pricing" data-route="/pricing">Pricing</a>
            <a href="/docs" data-route="/docs">Docs</a>
          </nav>
        </div>
        <div class="top-nav__right">
          <a class="top-nav__icon" href="https://github.com/orbitops/orbitops" target="_blank" rel="noreferrer" title="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.3-.1-.3-.6-1.6.1-3.3 0 0 1-.3 3.3 1.3a11.5 11.5 0 0 1 6 0c2.3-1.6 3.3-1.3 3.3-1.3.7 1.7.2 3 .1 3.3.8.9 1.3 2 1.3 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
          </a>
          <a class="btn btn--primary btn--sm top-nav__cta-btn" href="/pricing" data-route="/pricing">Request pilot</a>
          <button class="top-nav__burger" id="topNavBurger" aria-label="Open menu" aria-expanded="false" type="button">
            <span></span><span></span><span></span>
          </button>
        </div>
      `;

      // Wire burger
      const burger = topNav.querySelector('#topNavBurger');
      if (burger) {
        burger.addEventListener('click', () => {
          const open = !topNav.classList.contains('is-mobile-open');
          topNav.classList.toggle('is-mobile-open', open);
          burger.setAttribute('aria-expanded', String(open));
        });
      }

      // Close mobile menu on route change
      window.addEventListener('hashchange', () => {
        if (topNav) topNav.classList.remove('is-mobile-open');
        if (burger) burger.setAttribute('aria-expanded', 'false');
      });
    }

    // Register routes
    const { mount: mountHome } = await import('./pages/home.js');
    const { mount: mountCockpit } = await import('./pages/cockpit.js');
    const { mount: mountAgent } = await import('./pages/agent.js');
    const { mount: mountDashboard } = await import('./pages/dashboard.js');
    const { mount: mountTools } = await import('./pages/tools.js');
    const { mount: mountPricing } = await import('./pages/pricing.js');
    const { mount: mountDocs } = await import('./pages/docs.js');

    router.register('/', mountHome);
    router.register('/cockpit', mountCockpit);
    router.register('/agent', mountAgent);
    router.register('/dashboard', mountDashboard);
    router.register('/tools', mountTools);
    router.register('/pricing', mountPricing);
    router.register('/docs', mountDocs);

    router.init(app);

    // Hide boot
    hideBoot();

    // Year in footer
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // Welcome toast — shown only once per session
    if (!sessionStorage.getItem('orbitops-welcomed')) {
      sessionStorage.setItem('orbitops-welcomed', '1');
      setTimeout(() => {
        info('Use ↑↓ keys or scroll to navigate · drag in cockpit to orbit', {
          title: 'OrbitOps',
          durationMs: 5000,
        });
      }, 1500);
    }

    // Global error handlers
    window.addEventListener('error', (e) => console.error('[OrbitOps] error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => console.error('[OrbitOps] unhandled', e.reason));
  } catch (err) {
    fatalBoot('Boot failed', elapsed() + ' · ' + (err.message || 'unknown error'), err);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main, { once: true });
} else {
  main();
}