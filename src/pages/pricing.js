/**
 * Pricing page — enterprise tiers.
 */

'use strict';

export async function mount(app) {
  app.innerHTML = `
    <main class="pricing-page page-bg page-bg--pricing">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <span class="eyebrow">PRICING</span>
          <h1 class="page-header__title">Per satellite. Not per seat.</h1>
          <p class="page-header__sub">
            Predictable pricing that scales with your fleet, not your headcount.
            Every plan includes the agent, the audit log, and the open-source core.
          </p>
        </div>
      </header>

      <section class="pricing-tiers">
        <div class="container">
          <div class="tiers-grid">

            <div class="tier">
              <div class="tier__name">Pilot</div>
              <div class="tier__desc">For evaluating OrbitOps on a single constellation or slice</div>
              <div class="tier__price">
                <div class="tier__price-num">$2,500</div>
                <div class="tier__price-unit">per satellite / month</div>
              </div>
              <ul class="tier__features">
                <li>Up to 5 satellites</li>
                <li>Web cockpit + agent + audit log</li>
                <li>Email support · 24h SLA</li>
                <li>Single-tenant data plane</li>
                <li>Self-host or managed</li>
                <li>Quarterly business review</li>
              </ul>
              <a href="mailto:operators@orbitops.io?subject=Pilot%20plan" class="btn btn--secondary">REQUEST PILOT</a>
            </div>

            <div class="tier tier--featured">
              <div class="tier__badge">MOST POPULAR</div>
              <div class="tier__name">Growth</div>
              <div class="tier__desc">For commercial constellations ready to put the agent on shift</div>
              <div class="tier__price">
                <div class="tier__price-num">$2,000</div>
                <div class="tier__price-unit">per satellite / month</div>
              </div>
              <ul class="tier__features">
                <li>Up to 50 satellites</li>
                <li>Everything in Pilot, plus:</li>
                <li>LeoLabs + 18 SDS integration</li>
                <li>Slack + PagerDuty integration</li>
                <li>Custom scenarios (up to 10)</li>
                <li>Priority support · 4h SLA</li>
                <li>SOC 2 Type I (in progress)</li>
              </ul>
              <a href="mailto:operators@orbitops.io?subject=Growth%20plan" class="btn btn--primary">REQUEST GROWTH</a>
            </div>

            <div class="tier">
              <div class="tier__name">Mega</div>
              <div class="tier__desc">For megaconstellations at scale — Starlink-class operators</div>
              <div class="tier__price">
                <div class="tier__price-num">$1,500</div>
                <div class="tier__price-unit">per satellite / month</div>
              </div>
              <ul class="tier__features">
                <li>500+ satellites</li>
                <li>Everything in Growth, plus:</li>
                <li>On-premise deployment</li>
                <li>Custom LLM fine-tuning</li>
                <li>Unlimited scenarios</li>
                <li>Dedicated CSM · 1h SLA</li>
                <li>SOC 2 Type II</li>
                <li>FAA / FCC compliance exports</li>
              </ul>
              <a href="mailto:operators@orbitops.io?subject=Mega%20plan" class="btn btn--secondary">REQUEST MEGA</a>
            </div>

          </div>
        </div>
      </section>

      <section class="pricing-faq">
        <div class="container">
          <header class="section__head">
            <span class="eyebrow">FAQ</span>
            <h2 class="section__title">Common questions.</h2>
          </header>

          <div class="faq-list">
            <details class="faq-item" open>
              <summary>Why per-satellite instead of per-seat?</summary>
              <div>
                Flight dynamics teams are small by design — usually 3–10 people per
                constellation. Per-seat pricing penalises automation: the better our
                agent does, the less you pay. Per-satellite aligns our incentives
                with yours: the more fleet we monitor, the more we earn.
              </div>
            </details>

            <details class="faq-item">
              <summary>Can we self-host?</summary>
              <div>
                Yes. The core (agent loop, anomaly detector, manoeuvre planner, audit
                log, orbit propagator) is MIT-licensed. Self-host with Docker Compose
                or Kubernetes. The managed service adds the LeoLabs integration,
                multi-tenant observability, and 24/7 support.
              </div>
            </details>

            <details class="faq-item">
              <summary>What does the agent actually do autonomously?</summary>
              <div>
                Nothing. The agent proposes, the human approves. Every action goes
                through the audit log with full reasoning chain. You can read every
                decision, override every recommendation, and export the full audit
                trail for compliance.
              </div>
            </details>

            <details class="faq-item">
              <summary>How accurate is the anomaly detection?</summary>
              <div>
                On our pilot fleet, 94% precision and 11-day mean lead time. Numbers
                vary by mission type — IoT constellations have different baselines
                than EO. We tune per-customer during the first 30 days.
              </div>
            </details>

            <details class="faq-item">
              <summary>What's the migration path from our existing ops stack?</summary>
              <div>
                OrbitOps sits alongside your existing MOC, not instead of it. We
                integrate via WebSocket for telemetry in, and via your preferred
                commanding path for actions out. Most pilots go live in 4 weeks.
              </div>
            </details>
          </div>
        </div>
      </section>

      <section class="pricing-contact">
        <div class="container">
          <div class="contact-card">
            <h2>Talk to the team.</h2>
            <p>Direct line. No SDR. Engineering-led sales.</p>
            <div class="contact-cards">
              <a href="mailto:operators@orbitops.io" class="contact-card__item">
                <div class="contact-card__label">CUSTOMERS</div>
                <div class="contact-card__value">operators@orbitops.io</div>
              </a>
              <a href="mailto:investors@orbitops.io" class="contact-card__item">
                <div class="contact-card__label">INVESTORS</div>
                <div class="contact-card__value">investors@orbitops.io</div>
              </a>
              <a href="mailto:press@orbitops.io" class="contact-card__item">
                <div class="contact-card__label">PRESS</div>
                <div class="contact-card__value">press@orbitops.io</div>
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  app.querySelector('#sideNav').innerHTML = SIDE_NAV('pricing');

  return { unmount() {} };
}

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