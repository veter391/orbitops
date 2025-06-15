/**
 * Dashboard — real mission control overview.
 *
 * Designed for engineers who need to glance at fleet health,
 * not marketing people who want animations.
 */

'use strict';

import { SATELLITES, MISSION_COLORS } from '../data/satellites.js';
import { detectAll, trainAll } from '../core/anomaly-detector.js';
import { generate } from '../core/telemetry.js';
import { audit } from '../core/audit-log.js';

const MISSION_NAMES = {
  comms: 'Comms',
  eo: 'Earth Obs.',
  iot: 'IoT',
  weather: 'Weather',
  pnt: 'PNT',
  broadband: 'Broadband',
};

export async function mount(app) {
  trainAll();
  await audit.append('user:dashboard', 'page.view', {});

  // Generate mock telemetry data — deterministic but rich
  const fleetTelemetry = SATELLITES.map((s) => generate(s, 0));
  const anomalies = detectAll(0);

  app.innerHTML = `
    <main class="dashboard-page page-bg page-bg--dashboard">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <div class="page-header__eyebrow eyebrow">Mission control · live</div>
          <h1 class="page-header__title">Constellation overview</h1>
          <p class="page-header__sub">
            50 satellites under management · 6 mission types · 4 ground stations ·
            last sync 14 seconds ago
          </p>
          <div class="page-header__meta">
            <div class="page-header__meta-item">
              <span class="page-header__meta-dot"></span>
              <span>All systems nominal</span>
            </div>
            <div class="page-header__meta-item">
              <span style="color: var(--text-mute);">UPDATED</span>
              <span id="updatedAt">just now</span>
            </div>
          </div>
        </div>
      </header>

      <section class="dash-kpis">
        <div class="container">
          <div class="dash-kpi-grid">
            <div class="dash-kpi" data-kpi-tooltip="50 satellites under active monitoring · 12 mission types · last TLE update 4 min ago">
              <div class="dash-kpi__label">Tracked</div>
              <div class="dash-kpi__num">50</div>
              <div class="dash-kpi__sub">+2 this week</div>
            </div>
            <div class="dash-kpi" data-kpi-tooltip="Operational and responding to commands · last contact within 90s">
              <div class="dash-kpi__label">Nominal</div>
              <div class="dash-kpi__num dash-kpi__num--ok">47</div>
              <div class="dash-kpi__sub">94.0% of fleet</div>
            </div>
            <div class="dash-kpi" data-kpi-tooltip="3 satellites in warning state: ORBIT-3 1-1 (battery degradation), ORBIT-2 1-1 (thermal drift), ORBIT-1 5-2 (comms degradation)">
              <div class="dash-kpi__label">Warnings</div>
              <div class="dash-kpi__num dash-kpi__num--warn">3</div>
              <div class="dash-kpi__sub">monitoring</div>
            </div>
            <div class="dash-kpi" data-kpi-tooltip="No critical events in last 30 days · last critical: 47 days ago (resolved)">
              <div class="dash-kpi__label">Critical</div>
              <div class="dash-kpi__num dash-kpi__num--alert">0</div>
              <div class="dash-kpi__sub">all clear</div>
            </div>
            <div class="dash-kpi" data-kpi-tooltip="12 burns planned this week · 2 awaiting operator approval · next burn T+4h 12m (ORBIT-1 4-1)">
              <div class="dash-kpi__label">Burns / wk</div>
              <div class="dash-kpi__num">12</div>
              <div class="dash-kpi__sub">2 queued</div>
            </div>
            <div class="dash-kpi" data-kpi-tooltip="FCC 5-year deorbit: 100% · ITU coordination: 100% · FAA launch licensing: 100% · All reports exported and signed">
              <div class="dash-kpi__label">Compliance</div>
              <div class="dash-kpi__num dash-kpi__num--ok">100%</div>
              <div class="dash-kpi__sub">FCC · ITU · FAA</div>
            </div>
          </div>
        </div>
      </section>

      <section class="dash-grid">
        <div class="container">
          <div class="dash-grid__layout">

            <div class="dash-card dash-card--chart">
              <div class="dash-card__head">
                <h3 class="dash-card__title">Anomaly signal strength <span class="dash-card__title-num">last 30 days</span></h3>
                <div class="dash-card__legend">
                  <span><span class="dash-card__legend-dot" style="background: var(--accent);"></span>Subsystem drift</span>
                  <span><span class="dash-card__legend-dot" style="background: var(--mission-iot);"></span>Orbital events</span>
                  <span><span class="dash-card__legend-dot" style="background: var(--warn);"></span>External</span>
                </div>
              </div>
              <div class="dash-card__chart-wrap">
                <canvas id="anomalyCanvas" class="dash-card__chart"></canvas>
              </div>
            </div>

            <div class="dash-card">
              <div class="dash-card__head">
                <h3 class="dash-card__title">Fleet average</h3>
              </div>
              <div id="subsystemHealth"></div>
            </div>

            <div class="dash-card">
              <div class="dash-card__head">
                <h3 class="dash-card__title">Recent events <span class="dash-card__title-num" id="eventCount"></span></h3>
                <button class="btn btn--ghost btn--sm">View all</button>
              </div>
              <div id="anomalyFeed" class="anomaly-feed"></div>
            </div>

            <div class="dash-card dash-card--wide">
              <div class="dash-card__head">
                <h3 class="dash-card__title">Fuel budget <span class="dash-card__title-num">top 10 by consumption</span></h3>
                <button class="btn btn--ghost btn--sm">All satellites</button>
              </div>
              <div id="fuelList" class="fuel-list"></div>
            </div>

            <div class="dash-card">
              <div class="dash-card__head">
                <h3 class="dash-card__title">Coverage map</h3>
                <span class="badge badge--ok"><span class="badge__dot"></span>Live</span>
              </div>
              <div class="mini-map" id="miniMap">
                <div class="mini-map__globe"></div>
              </div>
              <div class="mini-map__legend">
                <span><span class="dot" style="background: var(--mission-comms);"></span>Comms 12</span>
                <span><span class="dot" style="background: var(--mission-eo);"></span>EO 8</span>
                <span><span class="dot" style="background: var(--mission-iot);"></span>IoT 15</span>
                <span><span class="dot" style="background: var(--mission-weather);"></span>Wx 6</span>
                <span><span class="dot" style="background: var(--mission-pnt);"></span>PNT 5</span>
                <span><span class="dot" style="background: var(--mission-broadband);"></span>BB 4</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      <section class="dash-sats-table">
        <div class="container">
          <header class="section__head">
            <div class="eyebrow">Fleet status</div>
            <h2 class="section__title">Satellite status · 50 satellites</h2>
          </header>
          <div class="dash-table-wrap">
            <table class="dash-table" id="satTable"></table>
          </div>
        </div>
      </section>
    </main>
  `;

  // Side nav
  app.querySelector('#sideNav').innerHTML = sideNavHtml('dashboard');

  // ---- Anomaly chart (with axis labels, gridlines, real data shape) ----
  drawAnomalyChart(app.querySelector('#anomalyCanvas'));

  // ---- Subsystem health (fleet average) ----
  const subs = ['power', 'thermal', 'comms', 'propulsion', 'attitude', 'payload'];
  const subsData = subs.map((sub, i) => {
    let total = 0, count = 0;
    fleetTelemetry.forEach((tlm) => {
      const m = tlm[sub];
      if (m) for (const [k, v] of Object.entries(m)) {
        if (v.value !== undefined) { total += v.value; count++; }
      }
    });
    return { name: sub, value: count > 0 ? total / count : 0, idx: i };
  });
  app.querySelector('#subsystemHealth').innerHTML = subsData.map((s) => {
    const pct = Math.min(100, Math.max(0, (s.value / 50) * 100));
    const color = pct > 80 ? 'var(--ok)' : pct > 60 ? 'var(--accent)' : 'var(--warn)';
    return `
      <div class="subs-row">
        <span class="subs-row__label">${s.name}</span>
        <div class="subs-row__bar"><div class="subs-row__fill" style="width: ${pct}%; background: ${color};"></div></div>
        <span class="subs-row__val">${pct.toFixed(1)}%</span>
      </div>
    `;
  }).join('');

  // ---- Anomaly feed ----
  app.querySelector('#eventCount').textContent = `${anomalies.length} events`;
  app.querySelector('#anomalyFeed').innerHTML = anomalies.slice(0, 10).map((x) => `
    <div class="anomaly-row anomaly-row--${x.severity}">
      <div class="anomaly-row__time">T+${(x.simTime || 0).toFixed(0)}s</div>
      <div class="anomaly-row__sev">${x.severity.toUpperCase()}</div>
      <div class="anomaly-row__msg">${x.satName}: ${x.message}</div>
    </div>
  `).join('');

  // ---- Fuel list — realistic per-satellite computation ----
  // Uses satellite index + mission type to derive:
  //   - years in orbit (0.4 - 5.8 yrs, weighted by mission)
  //   - mission-specific baseline fuel mass (kg)
  //   - mission-specific consumption rate (kg/year)
  // Remaining fuel is then % of baseline minus burn history.
  const missionFuel = {
    comms:  { baseline: 410, kgPerYr: 6.2, lifetimeYrs: 5 },   // Hall thruster, conservative
    eo:     { baseline: 285, kgPerYr: 9.4, lifetimeYrs: 4 },   // More manoeuvres for orbit maintenance
    iot:    { baseline: 120, kgPerYr: 3.1, lifetimeYrs: 7 },   // Small sat, very low burn
    weather:{ baseline: 320, kgPerYr: 7.8, lifetimeYrs: 5 },
    pnt:    { baseline: 240, kgPerYr: 5.4, lifetimeYrs: 8 },
    bb:     { baseline: 380, kgPerYr: 6.9, lifetimeYrs: 5 },
  };
  const fuelData = SATELLITES.map((s, i) => {
    const m = missionFuel[s.mission] || missionFuel.comms;
    // Per-satellite hash from name + index — guaranteed unique across planes
    let hash = i * 2654435761;
    for (let c = 0; c < s.name.length; c++) hash = ((hash ^ s.name.charCodeAt(c)) * 16777619) >>> 0;
    const ageMod = (hash % 1000) / 1000;             // 0..1, unique per sat
    const burnMod = (((hash >>> 8) % 1000) / 1000);  // 0..1, unique per sat
    const yearsInOrbit = +(0.4 + ageMod * 6.4).toFixed(1); // 0.4 - 6.8 yrs
    const burnRateMod = 0.78 + burnMod * 0.45;       // 0.78 - 1.23
    const kgPerYr = m.kgPerYr * burnRateMod;
    const usedKg = kgPerYr * yearsInOrbit;
    const remainingKg = Math.max(0, m.baseline - usedKg);
    const remainingPct = Math.round((remainingKg / m.baseline) * 100);
    const estYearsLeft = +(remainingKg / kgPerYr).toFixed(1);
    const status = remainingPct > 60 ? 'nominal' : remainingPct > 30 ? 'watch' : 'critical';
    return {
      name: s.name,
      mission: s.mission,
      remaining: remainingPct,
      remainingKg: remainingKg.toFixed(1),
      baselineKg: m.baseline,
      kgPerYr: kgPerYr.toFixed(2),
      yearsInOrbit,
      estYearsLeft,
      status,
    };
  }).sort((a, b) => a.remaining - b.remaining).slice(0, 10);

  const fuelHtml = fuelData.map((d) => {
    const color = d.status === 'nominal' ? 'var(--ok)' : d.status === 'watch' ? 'var(--warn)' : 'var(--alert)';
    const sevLabel = d.status === 'nominal' ? 'OK' : d.status === 'watch' ? 'WATCH' : 'CRIT';
    const tooltip = `${d.remainingKg} kg of ${d.baselineKg} kg · ${d.kgPerYr} kg/yr · ${d.yearsInOrbit} yr in orbit · ${d.estYearsLeft} yr remaining`;
    return `
      <div class="fuel-row" title="${tooltip}">
        <span class="fuel-row__name">${d.name}<span class="fuel-row__mission">${d.mission.toUpperCase()}</span></span>
        <div class="fuel-row__bar"><div class="fuel-row__fill" style="width: ${d.remaining}%; background: ${color};"></div></div>
        <span class="fuel-row__pct">${d.remaining}%</span>
        <span class="fuel-row__sev fuel-row__sev--${d.status}">${sevLabel}</span>
      </div>
    `;
  }).join('');
  app.querySelector('#fuelList').innerHTML = fuelHtml;

  // ---- Mini map (real-ish world map) ----
  drawMiniMap(app.querySelector('.mini-map__globe'));

  // ---- Satellite table (sortable, real-looking) ----
  app.querySelector('#satTable').innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Customer</th>
        <th>Mission</th>
        <th>Altitude</th>
        <th>Inclination</th>
        <th>Health</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${SATELLITES.map((s) => {
        const health = 70 + ((s.elements.meanMotion * 100) % 30);
        const color = health > 90 ? 'var(--ok)' : health > 75 ? 'var(--accent)' : 'var(--warn)';
        const status = health > 95 ? 'NOMINAL' : health > 80 ? 'MONITOR' : 'WARN';
        const incl = (s.elements.inclination * 180 / Math.PI).toFixed(1);
        return `
          <tr>
            <td><strong style="color: var(--text-primary);">${s.name}</strong></td>
            <td>${s.customer}</td>
            <td><span class="mission-chip mission-chip--${s.mission}">${MISSION_NAMES[s.mission] || s.mission}</span></td>
            <td>${s.altitude} km</td>
            <td>${incl}°</td>
            <td><div class="health-bar"><div class="health-bar__fill" style="width: ${health}%; background: ${color};"></div></div></td>
            <td><span class="status-chip status-chip--${status.toLowerCase()}">${status}</span></td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  // Wire up KPI tooltips on hover
  const tooltip = document.createElement('div');
  tooltip.className = 'kpi-tooltip';
  tooltip.innerHTML = '';
  document.body.appendChild(tooltip);

  document.querySelectorAll('[data-kpi-tooltip]').forEach((el) => {
    el.addEventListener('mouseenter', (e) => {
      const text = el.getAttribute('data-kpi-tooltip');
      tooltip.textContent = text;
      tooltip.classList.add('is-show');
      const rect = el.getBoundingClientRect();
      tooltip.style.top = (rect.bottom + 8) + 'px';
      const left = Math.min(window.innerWidth - 380, rect.left);
      tooltip.style.left = Math.max(12, left) + 'px';
    });
    el.addEventListener('mouseleave', () => {
      tooltip.classList.remove('is-show');
    });
  });

  return {
    unmount() {
      tooltip.remove();
    },
  };
}

function sideNavHtml(active) {
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

function drawAnomalyChart(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 900;
  const h = canvas.clientHeight || 280;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = w, H = h;

  const padding = { l: 40, r: 16, t: 16, b: 28 };
  const cw = W - padding.l - padding.r;
  const ch = H - padding.t - padding.b;

  // Three series — deterministic data
  const series = [
    { color: '#6FA8FF', data: makeSeries(30, 8, 5, 1) },
    { color: '#B58FFF', data: makeSeries(30, 4, 2, 2) },
    { color: '#F0B860', data: makeSeries(30, 3, 1, 3) },
  ];

  // Grid + Y axis labels
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = padding.t + (ch / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.l, y);
    ctx.lineTo(W - padding.r, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#6A7280';
  ctx.font = '10px JetBrains Mono';
  for (let i = 0; i < 5; i++) {
    const y = padding.t + (ch / 4) * i;
    ctx.fillText(`${20 - i * 5}`, 12, y + 3);
  }

  // X axis labels
  for (let i = 0; i < 6; i++) {
    const x = padding.l + (i / 5) * cw;
    ctx.fillText(`${30 - i * 5}d`, x - 10, H - 10);
  }

  // Series
  series.forEach((s) => {
    const grad = ctx.createLinearGradient(0, padding.t, 0, H - padding.b);
    grad.addColorStop(0, s.color + '50');
    grad.addColorStop(1, s.color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = padding.l + (i / (s.data.length - 1)) * cw;
      const y = padding.t + ch - (v / 20) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding.l + cw, padding.t + ch);
    ctx.lineTo(padding.l, padding.t + ch);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = padding.l + (i / (s.data.length - 1)) * cw;
      const y = padding.t + ch - (v / 20) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function makeSeries(n, base, amp, seed) {
  // Simple deterministic PRNG
  let s = seed * 9999;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push(Math.max(0, base + Math.sin(i * 0.5) * amp + (rnd() - 0.5) * amp));
  }
  return data;
}

function drawMiniMap(host) {
  // More detailed world map SVG with continents, grid, and orbital paths
  host.innerHTML = `
    <svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="earth-grad" cx="50%" cy="50%">
          <stop offset="0%" stop-color="#13171F"/>
          <stop offset="100%" stop-color="#0D1117"/>
        </radialGradient>
      </defs>
      <rect width="200" height="100" fill="url(#earth-grad)"/>

      <!-- Lat/long grid -->
      <g stroke="#1F242E" stroke-width="0.15" fill="none">
        <line x1="0" y1="25" x2="200" y2="25"/>
        <line x1="0" y1="50" x2="200" y2="50"/>
        <line x1="0" y1="75" x2="200" y2="75"/>
        <line x1="50" y1="0" x2="50" y2="100"/>
        <line x1="100" y1="0" x2="100" y2="100"/>
        <line x1="150" y1="0" x2="150" y2="100"/>
      </g>

      <!-- Continents (simplified polygons) -->
      <g fill="#1F242E" stroke="#2A313D" stroke-width="0.3">
        <!-- North America -->
        <path d="M22,22 L45,20 L55,28 L60,38 L55,48 L42,52 L30,48 L20,38 Z"/>
        <!-- South America -->
        <path d="M68,52 L78,52 L82,65 L78,80 L70,82 L65,72 Z"/>
        <!-- Europe -->
        <path d="M95,22 L110,22 L115,32 L108,38 L98,35 Z"/>
        <!-- Africa -->
        <path d="M100,42 L115,40 L120,55 L115,72 L105,75 L98,60 Z"/>
        <!-- Asia -->
        <path d="M118,22 L150,20 L160,32 L165,42 L155,52 L138,48 L125,38 Z"/>
        <!-- India -->
        <path d="M125,42 L132,42 L134,52 L128,55 Z"/>
        <!-- Australia -->
        <path d="M150,72 L162,70 L168,80 L155,82 Z"/>
        <!-- Greenland -->
        <path d="M68,15 L78,15 L75,22 L70,22 Z"/>
      </g>

      <!-- Orbital paths -->
      <g stroke="#6FA8FF" stroke-width="0.25" fill="none" opacity="0.3">
        <ellipse cx="100" cy="50" rx="85" ry="18"/>
        <ellipse cx="100" cy="50" rx="85" ry="18" transform="rotate(45 100 50)"/>
        <ellipse cx="100" cy="50" rx="85" ry="18" transform="rotate(-45 100 50)"/>
        <ellipse cx="100" cy="50" rx="70" ry="14"/>
      </g>

      <!-- Coverage zones (light fills) -->
      <g fill="#6FA8FF" opacity="0.06">
        <circle cx="40" cy="32" r="8"/>
        <circle cx="78" cy="65" r="8"/>
        <circle cx="108" cy="35" r="8"/>
        <circle cx="140" cy="42" r="8"/>
        <circle cx="155" cy="75" r="6"/>
      </g>

      <!-- Active ground stations -->
      <g>
        <circle cx="40" cy="32" r="1.5" fill="#6FA8FF"/>
        <circle cx="78" cy="65" r="1.5" fill="#6FA8FF"/>
        <circle cx="108" cy="35" r="1.5" fill="#6FA8FF"/>
        <circle cx="140" cy="42" r="1.5" fill="#6FA8FF"/>
        <circle cx="155" cy="75" r="1.5" fill="#6FA8FF"/>
      </g>
    </svg>
  `;
}