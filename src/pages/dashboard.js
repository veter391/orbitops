// @ts-check
/**
 * Dashboard — real constellation analytics, rendered as a fleet-analytics
 * console (v3 aerospace-premium skin; stylesheet remains dash-v2.css).
 *
 * Every number here is derived from the real CelesTrak catalog via SGP4, not
 * hardcoded. The only simulated element (clearly labelled) is per-satellite
 * health telemetry, for which no public feed exists.
 *
 * Launch years come from the TLE international designator (line 1, cols
 * 10–17): "19074B" → launched 2019. The vendored satellite.js satrec does not
 * retain the designator, so we re-read the same TLE text the loader cached
 * (or the bundled snapshot) and map NORAD id → launch year. If no TLE text is
 * recoverable, the section removes itself rather than showing fake data.
 */

'use strict';

import { audit } from '../core/audit-log.js';
import { loadConstellation } from '../core/live-constellation.js';
import { meanElements, propagateEci, geodetic, parseTle } from '../core/sgp4.js';
import { sunEciDirection } from '../core/sun.js';
import { mountAmbient } from '../ui/ambient.js';

/**
 * @typedef {Object} EnrichedSat
 * @property {string} name
 * @property {number} noradId
 * @property {string} group
 * @property {number} altKm
 * @property {number} periodMin
 * @property {number} inclDeg
 * @property {number} ecc
 * @property {{ latDeg: number, lonDeg: number, altKm: number } | null} geo
 * @property {boolean} lit
 * @property {*} satrec
 */

/**
 * @typedef {Object} Shell
 * @property {string} label
 * @property {string} short
 * @property {string} hex
 * @property {number} mid
 * @property {number} count
 */

// v3 palette — white primary stroke, grey secondary, one ice accent. No neon.
const INK = '#F4F6F8'; // primary stroke / key numerals
const ICE = '#8FC6FF'; // THE single accent — live data, Starlink series
const GREY = 'rgba(255, 255, 255, 0.60)'; // secondary series (OneWeb)
const DIM = 'rgba(255, 255, 255, 0.35)'; // tertiary strokes
const GRID = 'rgba(255, 255, 255, 0.06)';
const AXIS = '#5A6169';

/** @type {Record<string, { label: string, hex: string, cls?: string }>} */
const GROUP_META = {
  starlink: { label: 'Starlink', hex: ICE, cls: 'starlink' },
  oneweb: { label: 'OneWeb', hex: GREY, cls: 'oneweb' },
};
const RE = 6371;

// Shared histogram geometry — the draw code and the hover hit-test must agree.
const HIST = { padL: 46, padR: 14, padT: 26, padB: 30, lo: 300, hi: 1400, band: 50 };

/** @param {*} s */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** @param {number} t */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** dash-v2.css is expected after all other css; inject it if the shell has not. */
function ensureStyles() {
  if (document.getElementById('dv2-styles')) return;
  const link = document.createElement('link');
  link.id = 'dv2-styles';
  link.rel = 'stylesheet';
  link.href = '/src/styles/dash-v2.css';
  document.head.appendChild(link);
}

/** @param {HTMLElement} app */
export async function mount(app) {
  ensureStyles();
  await audit.append('user:dashboard', 'page.view', {});
  /** @type {Array<() => void>} */
  const cleanups = [];

  app.innerHTML = `
    <main class="dashboard-page dv2 chrome-grain">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="dv2-head">
        <div class="dv2-wrap">
          <div class="dv2-eyebrow">Constellation analytics · live catalog</div>
          <h1 class="dv2-title">Constellation overview</h1>
          <p class="dv2-sub" id="dashSub">Loading real catalog from CelesTrak…</p>
          <div class="dv2-meta">
            <span class="dv2-meta__item"><i class="dv2-meta__dot"></i><span id="dashSource">connecting…</span></span>
            <span class="dv2-meta__item"><span class="dv2-meta__k">EPOCH</span><span id="dashClock">—</span></span>
          </div>
        </div>
      </header>

      <section class="dv2-band">
        <div class="dv2-wrap"><div class="dv2-gauges" id="kpiGrid"></div></div>
      </section>

      <section class="dv2-band">
        <div class="dv2-wrap">
          <div class="dv2-main">
            <div class="dv2-panel dv2-panel--hist hover-lift">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Altitude distribution</h3>
                <span class="dv2-panel__tag" id="altShown">real · km</span>
              </div>
              <div class="dv2-chart-wrap dv2-chart-wrap--hist">
                <canvas id="altCanvas" class="dv2-chart" role="img" aria-label="Histogram of satellite altitudes in 50 kilometre bands"></canvas>
                <div class="dv2-tip" id="altTip" hidden></div>
              </div>
            </div>

            <div class="dv2-panel dv2-panel--shells hover-lift">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Orbital shells</h3>
                <span class="dv2-panel__tag">cross-section</span>
              </div>
              <div class="dv2-chart-wrap dv2-chart-wrap--shells">
                <canvas id="shellCanvas" class="dv2-chart" role="img" aria-label="Cross-section of orbital shells above Earth"></canvas>
              </div>
              <div class="dv2-shell-legend" id="shellLegend"></div>
            </div>

            <div class="dv2-panel dv2-panel--years hover-lift" id="yearsPanel">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Launch decades</h3>
                <span class="dv2-panel__tag" id="yearsTag">by launch year · analysed set</span>
              </div>
              <div id="launchYears" class="dv2-years"></div>
            </div>

            <div class="dv2-panel dv2-panel--extremes hover-lift" id="extremesPanel">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Extremes</h3>
                <span class="dv2-panel__tag">analysed set · mean elements</span>
              </div>
              <div id="extremes" class="dv2-extremes"></div>
            </div>

            <div class="dv2-panel hover-lift">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Composition</h3>
                <span class="dv2-panel__tag">share of catalog</span>
              </div>
              <div id="composition" class="dv2-bars"></div>
            </div>

            <div class="dv2-panel hover-lift">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Inclination families</h3>
                <span class="dv2-panel__tag">analysed set</span>
              </div>
              <div id="inclFamilies" class="dv2-bars"></div>
            </div>

            <div class="dv2-panel hover-lift">
              <div class="dv2-panel__head">
                <h3 class="dv2-panel__title">Data &amp; honesty</h3>
                <span class="dv2-panel__tag">provenance</span>
              </div>
              <div class="dv2-note">
                <p><span class="dv2-note__k dv2-note__k--real">Real</span>orbital elements, positions, altitude, inclination, period and launch years — from the CelesTrak catalog, propagated with SGP4.</p>
                <p><span class="dv2-note__k dv2-note__k--sim">Simulated</span>per-satellite health telemetry and fuel — no public feed exists, so these are modelled and labelled as such wherever shown.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

<!-- ==================================================================
     W4-C · D1 + D2 — OPS READINESS band (additive; nothing above changed)
     D1 CONJUNCTION WATCH: full triage-queue design, honest empty state,
        zero fake values — a shimmer row skeleton is layout preview only.
     D2 DEORBIT / FCC-5YR: two REAL computed stats + a PLANNED per-license
        compliance tracker row. Real vs planned labelled explicitly.
     ================================================================== -->
      <section class="dv2-band dv2-band--ops">
        <div class="dv2-wrap">
          <div class="dv2-panel dv2-panel--cw hover-lift">
            <div class="dv2-panel__head">
              <h3 class="dv2-panel__title">Conjunction watch · awaiting SSA feed</h3>
              <span class="dv2-hchip dv2-hchip--planned">PLANNED</span>
            </div>

            <div class="dv2-cw-scroll">
              <div class="dv2-cw-cols" aria-hidden="true">
                <span>PAIR</span><span>TCA</span><span>MISS KM</span><span>PC</span><span>SEVERITY</span><span>ACTION</span>
              </div>

              <div class="dv2-cw-skel" aria-hidden="true">
                <div class="dv2-cw-skel__banner"><span>ROW LAYOUT PREVIEW — NOT DATA</span></div>
                <div class="dv2-cw-row">
                  <span class="dv2-cw-ph dv2-cw-ph--w80"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w56"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w48"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w48"></span>
                  <span class="dv2-cw-rail"><i></i><i></i><i></i></span>
                  <button type="button" class="dv2-cw-act" disabled>REVIEW</button>
                </div>
                <div class="dv2-cw-row">
                  <span class="dv2-cw-ph dv2-cw-ph--w64"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w48"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w56"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w40"></span>
                  <span class="dv2-cw-rail"><i></i><i></i><i></i></span>
                  <button type="button" class="dv2-cw-act" disabled>REVIEW</button>
                </div>
              </div>
            </div>

            <div class="dv2-cw-empty">
              <svg class="dv2-cw-radar" viewBox="0 0 96 96" aria-hidden="true">
                <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/>
                <circle cx="48" cy="48" r="29" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>
                <circle cx="48" cy="48" r="14" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>
                <line x1="4" y1="48" x2="92" y2="48" stroke="currentColor" stroke-opacity="0.10" stroke-width="1"/>
                <line x1="48" y1="4" x2="48" y2="92" stroke="currentColor" stroke-opacity="0.10" stroke-width="1"/>
                <g class="dv2-cw-radar__sweep">
                  <line x1="48" y1="48" x2="48" y2="5" stroke="#8FC6FF" stroke-opacity="0.85" stroke-width="1"/>
                </g>
                <circle cx="48" cy="48" r="1.6" fill="#8FC6FF"/>
              </svg>
              <div class="dv2-cw-empty__txt">
                <div class="dv2-cw-empty__title">No CDM feed connected</div>
                <p>
                  Live SSA / CDM ingestion (Space-Track) is planned. Once
                  connected, screened conjunctions rank into this queue by collision
                  probability — noise auto-dismissed, severity railed, every
                  approve/dismiss written to the hash-chained audit log.
                </p>
                <div class="dv2-cw-empty__meta">
                  <span class="dv2-hchip dv2-hchip--preview">DESIGN PREVIEW</span>
                  <span class="dv2-cw-empty__ready">designed &amp; ready · zero synthetic values on this panel</span>
                </div>
              </div>
            </div>
          </div>

          <div class="dv2-panel dv2-panel--deo hover-lift">
            <div class="dv2-panel__head">
              <h3 class="dv2-panel__title">Deorbit posture · FCC 5-yr rule</h3>
              <span class="dv2-panel__tag">analysed set · mean altitude</span>
            </div>

            <div class="dv2-deo-stats">
              <div class="dv2-deo-stat">
                <div class="dv2-deo-stat__k"><span>BELOW 400 KM</span><span class="dv2-hchip dv2-hchip--real">REAL</span></div>
                <div class="dv2-deo-stat__v" id="deoLow">—</div>
                <div class="dv2-deo-stat__sub">natural-decay band — indicative only; counting mean altitude, not modelling drag</div>
              </div>
              <div class="dv2-deo-stat">
                <div class="dv2-deo-stat__k"><span>ABOVE 1200 KM</span><span class="dv2-hchip dv2-hchip--real">REAL</span></div>
                <div class="dv2-deo-stat__v" id="deoHigh">—</div>
                <div class="dv2-deo-stat__sub">long-lived — no natural decay on any licensing timescale</div>
              </div>
            </div>

            <div class="dv2-deo-tracker">
              <div class="dv2-deo-tracker__head">
                <span>PER-LICENSE COMPLIANCE TRACKER</span>
                <span class="dv2-hchip dv2-hchip--planned">PLANNED</span>
              </div>
              <div class="dv2-cw-scroll">
                <div class="dv2-deo-tracker__cols" aria-hidden="true">
                  <span>LICENSE</span><span>EOM DEADLINE</span><span>DECAY EST</span><span>MARGIN</span><span>EVIDENCE</span>
                </div>
                <div class="dv2-deo-tracker__row" aria-hidden="true">
                  <span class="dv2-cw-ph dv2-cw-ph--w80"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w64"></span>
                  <span class="dv2-cw-ph dv2-cw-ph--w56"></span>
                  <span class="dv2-deo-margin"><i></i></span>
                  <button type="button" class="dv2-cw-act" disabled>EXPORT PACK</button>
                </div>
              </div>
              <p class="dv2-deo-tracker__note">
                Post-2024 FCC licenses must deorbit within 5 years of end of
                mission. Decay-vs-deadline tracking and the hash-chained
                evidence export ship with the backend — the row above is the
                final layout, holding no numbers until they are real.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="dv2-band dv2-band--roster">
        <div class="dv2-wrap">
          <div class="dv2-panel dv2-panel--roster">
            <div class="dv2-panel__head">
              <h3 class="dv2-panel__title" id="tableTitle">Satellite status</h3>
              <span class="dv2-panel__tag">fleet roster</span>
            </div>
            <div class="dv2-table-wrap"><table class="dv2-table" id="satTable"></table></div>
          </div>
        </div>
      </section>
    </main>
  `;

  (/** @type {HTMLElement} */ (app.querySelector('#sideNav'))).innerHTML = sideNavHtml('dashboard');

  // Ambient space layer — stars only (the charts are the object here), so the
  // panels float in a live sky instead of dead black. Grain via chrome-grain.
  const ambient = mountAmbient(/** @type {HTMLElement} */ (app.querySelector('.dashboard-page')), { object: 'none' });
  cleanups.push(() => ambient.unmount());

  // Orchestrated load reveal: header → gauges → charts → roster, 80 ms apart,
  // once per visit. Reduced motion: CSS shows everything instantly.
  revealBands(app, cleanups);

  let data;
  try {
    data = await loadConstellation(['starlink', 'oneweb'], { max: 3000 });
  } catch (err) {
    console.error('dashboard: catalog load failed', err);
    (/** @type {HTMLElement} */ (app.querySelector('#dashSource'))).textContent = 'catalog unavailable';
    return { unmount() { cleanups.forEach((fn) => fn()); } };
  }

  const now = new Date();
  const sun = sunEciDirection(now);

  // Enrich each shown satellite with real orbital params + current geodetic + sunlight.
  /** @type {EnrichedSat[]} */
  const enriched = data.sats.map((/** @type {*} */ s) => {
    const me = meanElements(s.satrec);
    const pv = propagateEci(s.satrec, now);
    let geo = null, lit = true;
    if (pv) {
      geo = geodetic(pv.position, now);
      const p = pv.position;
      const along = p.x * sun.x + p.y * sun.y + p.z * sun.z;
      const perp2 = p.x * p.x + p.y * p.y + p.z * p.z - along * along;
      lit = along > 0 || perp2 > RE * RE;
    }
    return { ...s, ...me, geo, lit };
  });

  const src = (/** @type {Record<string, string>} */ ({ live: 'Live · CelesTrak', cache: 'Cached · CelesTrak', snapshot: 'Snapshot · CelesTrak' }))[data.source];
  (/** @type {HTMLElement} */ (app.querySelector('#dashSource'))).textContent = src;
  (/** @type {HTMLElement} */ (app.querySelector('#dashClock'))).textContent = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  (/** @type {HTMLElement} */ (app.querySelector('#dashSub'))).textContent =
    `${data.total.toLocaleString()} tracked objects · ${Object.keys(data.byGroup).length} constellations · ` +
    `${enriched.length.toLocaleString()} analysed in detail`;

  // ---- KPIs (all real) ----
  const alts = enriched.map((e) => e.altKm).filter((a) => a > 0 && a < 60000);
  const incls = enriched.map((e) => e.inclDeg).sort((a, b) => a - b);
  const meanAlt = alts.reduce((s, a) => s + a, 0) / (alts.length || 1);
  const medIncl = incls[Math.floor(incls.length / 2)] || 0;
  const litPct = Math.round((enriched.filter((e) => e.lit).length / (enriched.length || 1)) * 100);
  const periods = enriched.map((e) => e.periodMin).filter(Boolean);
  const meanPeriod = periods.reduce((s, p) => s + p, 0) / (periods.length || 1);

  const nStar = data.byGroup.starlink || 0;
  const nOne = data.byGroup.oneweb || 0;
  const total = Math.max(1, data.total);
  // Real distributions reused as tile sparklines (same bins as the main chart).
  const altBins = binify(alts, 300, 1400, 50);
  const inclBins = binify(incls, 0, 120, 10);

  // Instrument tiles: value counts up, viz is a ring (real share), a sparkline
  // (real distribution) or the radial sunlight gauge. No synthetic visuals.
  /** @type {Array<{ label: string, value: number, fmt: (v: number) => string, sub: string, viz: any }>} */
  const kpiDefs = [
    { label: 'Tracked', value: data.total, fmt: (v) => Math.round(v).toLocaleString(), sub: 'catalogued objects',
      viz: { type: 'ring', frac: enriched.length / total, color: INK, title: `${enriched.length.toLocaleString()} of ${data.total.toLocaleString()} analysed in detail` } },
    { label: 'Starlink', value: nStar, fmt: (v) => Math.round(v).toLocaleString(), sub: 'objects',
      viz: { type: 'ring', frac: nStar / total, color: ICE, title: `${Math.round((nStar / total) * 100)}% of tracked catalog` } },
    { label: 'OneWeb', value: nOne, fmt: (v) => Math.round(v).toLocaleString(), sub: 'objects',
      viz: { type: 'ring', frac: nOne / total, color: GREY, title: `${Math.round((nOne / total) * 100)}% of tracked catalog` } },
    { label: 'Mean altitude', value: meanAlt, fmt: (v) => `${Math.round(v)} km`, sub: `period ~${meanPeriod.toFixed(0)} min`,
      viz: { type: 'spark', series: altBins, color: INK, title: 'altitude distribution, 300–1400 km' } },
    { label: 'Median inclination', value: medIncl, fmt: (v) => `${v.toFixed(1)}°`, sub: 'of analysed set',
      viz: { type: 'spark', series: inclBins, color: GREY, title: 'inclination distribution, 0–120°' } },
    { label: 'In sunlight', value: litPct, fmt: (v) => `${Math.round(v)}%`, sub: 'right now',
      viz: { type: 'gauge', frac: litPct / 100, color: ICE, title: `${litPct}% of analysed set is sunlit right now` } },
  ];

  const kpiGrid = /** @type {HTMLElement} */ (app.querySelector('#kpiGrid'));
  kpiGrid.innerHTML = kpiDefs.map((k) => {
    if (k.viz.type === 'gauge') {
      return `
        <div class="dv2-panel dv2-tile dv2-tile--gauge hover-lift" tabindex="0" aria-label="${esc(k.label)}: ${esc(k.viz.title)}">
          <div class="dv2-tile__label">${k.label}</div>
          <div class="dv2-gauge">
            <canvas class="dv2-gauge__canvas" title="${esc(k.viz.title)}"></canvas>
            <div class="dv2-tile__num dv2-gauge__num">0%</div>
          </div>
          <div class="dv2-tile__sub">${k.sub}</div>
        </div>`;
    }
    return `
      <div class="dv2-panel dv2-tile hover-lift" tabindex="0" aria-label="${esc(k.label)}: ${esc(k.viz.title)}">
        <div class="dv2-tile__label">${k.label}</div>
        <div class="dv2-tile__body">
          <div class="dv2-tile__num">0</div>
          <canvas class="dv2-tile__viz dv2-tile__viz--${k.viz.type}" title="${esc(k.viz.title)}"></canvas>
        </div>
        <div class="dv2-tile__sub">${k.sub}</div>
      </div>`;
  }).join('');

  /** @type {Array<() => void>} */
  const vizRedraws = [];
  kpiDefs.forEach((k, i) => {
    const tile = kpiGrid.children[i];
    const num = /** @type {HTMLElement} */ (tile.querySelector('.dv2-tile__num'));
    const cv = /** @type {HTMLCanvasElement} */ (tile.querySelector('canvas'));
    const frame = (/** @type {number} */ t) => {
      num.textContent = k.fmt(k.value * t);
      if (k.viz.type === 'gauge') drawGauge(cv, k.viz.frac, k.viz.color, t);
      else if (k.viz.type === 'ring') drawRing(cv, k.viz.frac, k.viz.color, t);
      else drawSpark(cv, k.viz.series, k.viz.color, t);
    };
    animate(820, frame, cleanups);
    vizRedraws.push(() => frame(1));
  });

  // ---- Altitude histogram (real) + cursor-following bin tooltip ----
  (/** @type {HTMLElement} */ (app.querySelector('#altShown'))).textContent = `${enriched.length.toLocaleString()} objects · per 50 km band`;
  const altCanvas = /** @type {HTMLCanvasElement} */ (app.querySelector('#altCanvas'));
  let histDone = false;
  let histHover = -1;
  animate(1150, (t) => { histDone = t >= 1; drawAltHistogram(altCanvas, alts, t, histHover); }, cleanups);
  wireHistogramHover(altCanvas, /** @type {HTMLElement} */ (app.querySelector('#altTip')), alts, {
    getDone: () => histDone,
    setHover: (i) => { histHover = i; drawAltHistogram(altCanvas, alts, 1, i); },
  });

  // ---- Composition (real per-group counts) ----
  (/** @type {HTMLElement} */ (app.querySelector('#composition'))).innerHTML = Object.entries(data.byGroup).map(([g, n]) => {
    const meta = GROUP_META[g] || { label: g, hex: DIM };
    const pct = Math.round((/** @type {number} */ (n) / total) * 100);
    return instrumentBarHtml(meta.label, pct, meta.hex, (/** @type {number} */ (n)).toLocaleString());
  }).join('');

  // ---- Inclination families (real buckets) ----
  const inclBuckets = bucket(incls, [[0, 30, 'Low (0–30°)'], [30, 55, 'Mid (30–55°)'], [55, 80, 'High (55–80°)'], [80, 100, 'Polar (80–100°)']]);
  const inclMax = Math.max(1, ...inclBuckets.map((b) => b.count));
  (/** @type {HTMLElement} */ (app.querySelector('#inclFamilies'))).innerHTML = inclBuckets.map((b) =>
    instrumentBarHtml(b.label, (b.count / inclMax) * 100, INK, b.count.toLocaleString())
  ).join('');

  // ---- Orbital shells (real altitude bands) → concentric cross-section ----
  /** @type {Array<[number, number, string, string, string]>} */
  const shellDefs = [
    [0, 450, 'VLEO · <450 km', 'VLEO <450', DIM],
    [450, 600, 'Starlink shell · 450–600 km', 'STARLINK 450–600', ICE],
    [600, 900, 'LEO · 600–900 km', 'LEO 600–900', DIM],
    [900, 1300, 'OneWeb shell · 900–1300 km', 'ONEWEB 900–1300', GREY],
    [1300, 60000, 'Above 1300 km', '>1300 KM', DIM],
  ];
  const shells = shellDefs.map(([lo, hi, label, short, hex]) => ({
    label, short, hex,
    mid: hi >= 60000 ? 1450 : (lo + hi) / 2,
    count: alts.filter((a) => a >= lo && a < hi).length,
  }));
  const shellCanvas = /** @type {HTMLCanvasElement} */ (app.querySelector('#shellCanvas'));
  let shellsDone = false;
  let shellHover = -1;
  animate(950, (t) => { shellsDone = t >= 1; drawShellsCross(shellCanvas, shells, t, shellHover); }, cleanups);

  // Legend rows are buttons: hover/focus highlights the matching arc, and the
  // canvas hover highlights the matching legend row — one synced instrument.
  const legend = /** @type {HTMLElement} */ (app.querySelector('#shellLegend'));
  legend.innerHTML = shells.map((s, i) => `
    <button type="button" class="dv2-shell-legend__row" data-shell="${i}" aria-label="${esc(s.label)}: ${s.count} objects">
      <i class="dv2-shell-legend__dot" style="background:${s.hex};"></i>
      <span class="dv2-shell-legend__label">${s.label}</span>
      <span class="dv2-shell-legend__val">${s.count}</span>
    </button>`).join('');
  const setShellHover = (/** @type {number} */ i) => {
    if (!shellsDone) return; // nothing to highlight or clear mid-tween
    shellHover = i;
    drawShellsCross(shellCanvas, shells, 1, i);
    legend.querySelectorAll('.dv2-shell-legend__row').forEach((row, r) =>
      row.classList.toggle('is-hot', r === i));
  };
  legend.querySelectorAll('.dv2-shell-legend__row').forEach((row, i) => {
    row.addEventListener('mouseenter', () => setShellHover(i));
    row.addEventListener('mouseleave', () => setShellHover(-1));
    row.addEventListener('focus', () => setShellHover(i));
    row.addEventListener('blur', () => setShellHover(-1));
  });
  shellCanvas.addEventListener('pointermove', (e) => {
    if (!shellsDone) return;
    setShellHover(hitTestShell(shellCanvas, shells, e));
  });
  shellCanvas.addEventListener('pointerdown', (e) => {
    if (!shellsDone) return;
    setShellHover(hitTestShell(shellCanvas, shells, e));
  });
  shellCanvas.addEventListener('pointerleave', () => setShellHover(-1));

  // ---- Launch decades (real launch years from the TLE intl designator) ----
  const launchYears = await loadLaunchYearMap(['starlink', 'oneweb']);
  renderLaunchYears(app, enriched, launchYears);

  // ---- Extremes (real record holders of the analysed set) ----
  renderExtremes(app, enriched);

  // ---- W4-C · D2 — deorbit strip: REAL band counts (mean altitude) ----
  renderDeorbitStats(app, alts);

  // ---- Satellite table (real, first 80) ----
  (/** @type {HTMLElement} */ (app.querySelector('#tableTitle'))).textContent = `Satellite status · ${enriched.length.toLocaleString()} analysed`;
  (/** @type {HTMLElement} */ (app.querySelector('#satTable'))).innerHTML = `
    <thead><tr>
      <th>Name</th><th>NORAD</th><th>Group</th><th class="dv2-num">Alt · km</th><th class="dv2-num">Incl</th><th class="dv2-num">Period · min</th><th>Sub-point</th><th>Phase</th>
    </tr></thead>
    <tbody>
      ${enriched.slice(0, 80).map((e) => {
        const meta = GROUP_META[e.group] || { label: e.group, cls: 'other' };
        const sub = e.geo ? `${e.geo.latDeg.toFixed(1)}°, ${e.geo.lonDeg.toFixed(1)}°` : '—';
        const phase = e.lit
          ? '<span class="dv2-chip dv2-chip--sunlit"><i class="dv2-chip__dot"></i>SUNLIT</span>'
          : '<span class="dv2-chip dv2-chip--eclipse"><i class="dv2-chip__dot"></i>ECLIPSE</span>';
        return `
          <tr>
            <td class="dv2-td-name">${esc(e.name)}</td>
            <td class="dv2-td-mono">${esc(e.noradId)}</td>
            <td><span class="dv2-group dv2-group--${meta.cls || 'other'}">${esc(meta.label)}</span></td>
            <td class="dv2-num">${e.altKm.toFixed(0)}</td>
            <td class="dv2-num">${e.inclDeg.toFixed(1)}°</td>
            <td class="dv2-num">${e.periodMin.toFixed(1)}</td>
            <td class="dv2-td-mono">${sub}</td>
            <td>${phase}</td>
          </tr>`;
      }).join('')}
    </tbody>`;

  // ---- Responsive redraw: DPR-aware, redraws final state on real size change ----
  const seenSizes = new Map();
  const ro = new ResizeObserver((entries) => {
    let changed = false;
    for (const en of entries) {
      const key = `${Math.round(en.contentRect.width)}x${Math.round(en.contentRect.height)}`;
      if (seenSizes.has(en.target) && seenSizes.get(en.target) !== key) changed = true;
      seenSizes.set(en.target, key);
    }
    if (!changed) return; // first observation of each target is not a resize
    vizRedraws.forEach((fn) => fn());
    drawAltHistogram(altCanvas, alts, 1, histHover);
    drawShellsCross(shellCanvas, shells, 1, shellHover);
  });
  [kpiGrid, /** @type {HTMLElement} */ (altCanvas.parentElement), /** @type {HTMLElement} */ (shellCanvas.parentElement)].forEach((el) => ro.observe(el));
  cleanups.push(() => ro.disconnect());

  await audit.append('system', 'dashboard.analysed', { total: data.total, shown: enriched.length, source: data.source });

  return { unmount() { cleanups.forEach((fn) => fn()); } };
}

// ---------------------------------------------------------------------------
// Data helpers (unchanged logic)
// ---------------------------------------------------------------------------

/**
 * @param {number[]} sortedVals
 * @param {Array<[number, number, string]>} defs
 */
function bucket(sortedVals, defs) {
  return defs.map(([lo, hi, label]) => ({ label, count: sortedVals.filter((v) => v >= lo && v < hi).length }));
}

/**
 * @param {number[]} vals
 * @param {number} lo
 * @param {number} hi
 * @param {number} step
 * @returns {number[]}
 */
function binify(vals, lo, hi, step) {
  const bins = new Array(Math.ceil((hi - lo) / step)).fill(0);
  vals.forEach((v) => { if (v >= lo && v < hi) bins[Math.floor((v - lo) / step)]++; });
  return bins;
}

/**
 * Launch year per NORAD id, read from TLE line 1 cols 10–17 (intl designator,
 * e.g. "19074B" → 2019). Two-digit year rule per the designator convention:
 * 57–99 → 19xx, 00–56 → 20xx. Reads the same localStorage cache that
 * live-constellation.js just wrote (same keys), falling back to the bundled
 * snapshot. Returns an empty map when no TLE text is recoverable — the caller
 * must then drop the section instead of inventing years.
 */
/**
 * @param {string[]} groups
 * @returns {Promise<Map<number, number>>}
 */
async function loadLaunchYearMap(groups) {
  /** @type {Map<number, number>} */
  const years = new Map();
  for (const g of groups) {
    let text = null;
    try {
      const raw = localStorage.getItem(`orbitops:tle:${g}`);
      if (raw) text = (JSON.parse(raw) || {}).text || null;
    } catch { /* localStorage unavailable — try the snapshot */ }
    if (!text) {
      try {
        const res = await fetch(`/public/data/${g}.tle`);
        if (res.ok) text = await res.text();
      } catch { /* offline and uncached — this group contributes nothing */ }
    }
    if (!text) continue;
    for (const rec of parseTle(text)) {
      const yy = parseInt(rec.line1.slice(9, 11), 10);
      if (!Number.isFinite(yy)) continue;
      years.set(rec.noradId, yy >= 57 ? 1900 + yy : 2000 + yy);
    }
  }
  return years;
}

/**
 * Horizontal per-year bars (grouped by decade) — the Starlink surge, honest.
 * @param {HTMLElement} app
 * @param {EnrichedSat[]} enriched
 * @param {Map<number, number>} launchYears
 */
function renderLaunchYears(app, enriched, launchYears) {
  const panel = app.querySelector('#yearsPanel');
  /** @type {Map<number, { starlink: number, oneweb: number, other: number, total: number }>} */
  const byYear = new Map(); // year -> { starlink, oneweb, other, total }
  let mapped = 0;
  enriched.forEach((e) => {
    const y = launchYears.get(e.noradId);
    if (!y) return;
    mapped++;
    const row = byYear.get(y) || { starlink: 0, oneweb: 0, other: 0, total: 0 };
    row[e.group === 'starlink' || e.group === 'oneweb' ? e.group : 'other']++;
    row.total++;
    byYear.set(y, row);
  });

  if (!byYear.size) {
    // Honesty rule: no recoverable launch years → no section, no fake bars.
    if (panel) panel.remove();
    return;
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const max = Math.max(1, ...[...byYear.values()].map((r) => r.total));
  (/** @type {HTMLElement} */ (app.querySelector('#yearsTag'))).textContent =
    `${mapped.toLocaleString()} of ${enriched.length.toLocaleString()} objects · intl designator`;

  let lastDecade = -1;
  (/** @type {HTMLElement} */ (app.querySelector('#launchYears'))).innerHTML = years.map((y) => {
    const r = /** @type {{ starlink: number, oneweb: number, other: number, total: number }} */ (byYear.get(y));
    const decade = Math.floor(y / 10) * 10;
    const divider = decade !== lastDecade
      ? `<div class="dv2-year__decade">${decade}S</div>`
      : '';
    lastDecade = decade;
    const segs =
      (r.starlink ? `<div class="dv2-year__seg" style="width:${(r.starlink / max) * 100}%;background:${ICE};"></div>` : '') +
      (r.oneweb ? `<div class="dv2-year__seg" style="width:${(r.oneweb / max) * 100}%;background:${GREY};"></div>` : '') +
      (r.other ? `<div class="dv2-year__seg" style="width:${(r.other / max) * 100}%;background:${DIM};"></div>` : '');
    const detail = `${y}: ${r.total} objects — Starlink ${r.starlink}, OneWeb ${r.oneweb}`;
    return `${divider}
      <div class="dv2-year" title="${esc(detail)}">
        <span class="dv2-year__label">${y}</span>
        <div class="dv2-year__track">${segs}</div>
        <span class="dv2-year__val">${r.total.toLocaleString()}</span>
      </div>`;
  }).join('');
}

/**
 * Four mono instrument chips — real record holders, mean-element values.
 * @param {HTMLElement} app
 * @param {EnrichedSat[]} enriched
 */
function renderExtremes(app, enriched) {
  const panel = app.querySelector('#extremesPanel');
  const valid = enriched.filter((e) => e.periodMin > 0 && e.altKm > 0 && e.altKm < 60000);
  if (!valid.length) { if (panel) panel.remove(); return; }

  const pick = (/** @type {(b: EnrichedSat, a: EnrichedSat) => boolean} */ better) => valid.reduce((a, b) => (better(b, a) ? b : a));
  const chips = [
    { k: 'HIGHEST ORBIT', sat: pick((b, a) => b.altKm > a.altKm), fmt: (/** @type {EnrichedSat} */ s) => `${Math.round(s.altKm).toLocaleString()} KM`, sub: 'mean altitude' },
    { k: 'LOWEST ORBIT', sat: pick((b, a) => b.altKm < a.altKm), fmt: (/** @type {EnrichedSat} */ s) => `${Math.round(s.altKm).toLocaleString()} KM`, sub: 'mean altitude' },
    { k: 'FASTEST LAP', sat: pick((b, a) => b.periodMin < a.periodMin), fmt: (/** @type {EnrichedSat} */ s) => `${s.periodMin.toFixed(1)} MIN`, sub: 'orbital period' },
    { k: 'STEEPEST ORBIT', sat: pick((b, a) => b.inclDeg > a.inclDeg), fmt: (/** @type {EnrichedSat} */ s) => `${s.inclDeg.toFixed(1)}°`, sub: 'inclination' },
  ];

  (/** @type {HTMLElement} */ (app.querySelector('#extremes'))).innerHTML = chips.map((c) => `
    <div class="dv2-extreme hover-lift" tabindex="0"
      aria-label="${esc(c.k)}: ${esc(c.sat.name)}, ${esc(c.fmt(c.sat))} ${esc(c.sub)}">
      <div class="dv2-extreme__k">${c.k}</div>
      <div class="dv2-extreme__v">${esc(c.fmt(c.sat))}</div>
      <div class="dv2-extreme__name" title="${esc(c.sat.name)}">${esc(c.sat.name)}</div>
      <div class="dv2-extreme__sub">${c.sub} · NORAD ${esc(c.sat.noradId)}</div>
    </div>`).join('');
}

/**
 * W4-C · D2 — the only dynamic piece of the deorbit strip: two REAL counts
 * from the analysed set's mean altitudes. Everything else in that panel is
 * static design in a PLANNED state. No drag model is run here and the copy
 * says so; if the altitude list is empty the values stay "—", never invented.
 */
/**
 * @param {HTMLElement} app
 * @param {number[]} alts
 */
function renderDeorbitStats(app, alts) {
  const low = alts.filter((a) => a < 400).length;
  const high = alts.filter((a) => a > 1200).length;
  const lowEl = /** @type {HTMLElement|null} */ (app.querySelector('#deoLow'));
  const highEl = /** @type {HTMLElement|null} */ (app.querySelector('#deoHigh'));
  if (!lowEl || !highEl) return;
  if (!alts.length) return; // leave the honest "—"
  lowEl.textContent = low.toLocaleString();
  highEl.textContent = high.toLocaleString();
  lowEl.title = `${low.toLocaleString()} of ${alts.length.toLocaleString()} analysed objects have mean altitude below 400 km`;
  highEl.title = `${high.toLocaleString()} of ${alts.length.toLocaleString()} analysed objects have mean altitude above 1200 km`;
}

/** @param {string} active */
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
    </a>`).join('');
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Staggered band reveal (~80 ms), once. Reduced motion: instant via CSS+skip.
 * @param {HTMLElement} app
 * @param {Array<() => void>} cleanups
 */
function revealBands(app, cleanups) {
  const bands = /** @type {NodeListOf<HTMLElement>} */ (app.querySelectorAll('.dv2-head, .dv2-band'));
  if (prefersReduced()) return;
  bands.forEach((b, i) => {
    b.classList.add('dv2-reveal');
    b.style.transitionDelay = `${i * 80}ms`;
  });
  let raf2 = 0;
  const raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => bands.forEach((b) => b.classList.add('is-in')));
  });
  cleanups.push(() => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); });
}

/**
 * @param {string} label
 * @param {number} pct
 * @param {string} hex
 * @param {string} val
 */
function instrumentBarHtml(label, pct, hex, val) {
  const w = Math.max(0, Math.min(100, pct));
  return `
    <div class="dv2-bar">
      <span class="dv2-bar__label">${esc(label)}</span>
      <div class="dv2-bar__track"><div class="dv2-bar__fill" style="width:${w}%; --dv2-bar:${hex};"></div></div>
      <span class="dv2-bar__val">${val}</span>
    </div>`;
}

/**
 * rAF tween: frame() receives eased t in [0..1]; reduced motion jumps to 1.
 * @param {number} duration
 * @param {(t: number) => void} frame
 * @param {Array<() => void>} cleanups
 */
function animate(duration, frame, cleanups) {
  if (prefersReduced()) { frame(1); return; }
  let raf = 0;
  const t0 = performance.now();
  const tick = (/** @type {number} */ nowMs) => {
    const t = Math.min(1, (nowMs - t0) / duration);
    frame(easeOut(t));
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  cleanups.push(() => cancelAnimationFrame(raf));
}

/**
 * Size a canvas to its CSS box, devicePixelRatio-aware. Returns ctx + CSS size.
 * Guards zero/unstyled boxes (stylesheet may still be loading) so the bitmap
 * is never 0×N — the ResizeObserver redraw trues it up once styles apply.
 */
/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} fallbackW
 * @param {number} fallbackH
 * @returns {{ ctx: CanvasRenderingContext2D, w: number, h: number }}
 */
function fitCanvas(canvas, fallbackW, fallbackH) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || fallbackW;
  const h = canvas.clientHeight || fallbackH;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * Small full-circle share ring for count tiles.
 * @param {HTMLCanvasElement} canvas
 * @param {number} frac
 * @param {string} color
 * @param {number} t
 */
function drawRing(canvas, frac, color, t) {
  const { ctx, w, h } = fitCanvas(canvas, 44, 44);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 5;
  if (r <= 0) return;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const sweep = Math.PI * 2 * frac * t;
  if (sweep <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + sweep); ctx.stroke();
}

/**
 * 270° radial instrument gauge (sunlight %).
 * @param {HTMLCanvasElement} canvas
 * @param {number} frac
 * @param {string} color
 * @param {number} t
 */
function drawGauge(canvas, frac, color, t) {
  const { ctx, w, h } = fitCanvas(canvas, 96, 96);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 9;
  if (r <= 0) return;
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  // track + quarter ticks
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + span); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i <= 4; i++) {
    const a = a0 + (span * i) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
    ctx.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
    ctx.stroke();
  }
  const sweep = span * frac * t;
  if (sweep <= 0) return;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + sweep); ctx.stroke();
}

/**
 * Tiny real-distribution sparkline for value tiles.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} series
 * @param {string} color
 * @param {number} t
 */
function drawSpark(canvas, series, color, t) {
  const { ctx, w, h } = fitCanvas(canvas, 72, 34);
  ctx.clearRect(0, 0, w, h);
  if (!series.length) return;
  const max = Math.max(1, ...series);
  const bw = w / series.length;
  const shown = Math.max(1, Math.round(series.length * t));
  for (let i = 0; i < shown; i++) {
    const bh = Math.max(1, (series[i] / max) * (h - 4));
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1.5), bh);
    ctx.globalAlpha = 0.95;
    ctx.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1.5), 1.5);
  }
  ctx.globalAlpha = 1;
}

/**
 * Altitude histogram: gradient bars + bright topline, faint grid, shell
 * markers at the real Starlink/OneWeb bands, scan-sweep reveal (t: 0..1).
 * hover ≥ 0 lights that bin's bar with the ice accent (tooltip shows the bin).
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} alts
 * @param {number} t
 * @param {number} [hover]
 */
function drawAltHistogram(canvas, alts, t, hover = -1) {
  const { ctx, w, h } = fitCanvas(canvas, 900, 300);
  ctx.clearRect(0, 0, w, h);
  if (!alts.length) return;

  const pad = { l: HIST.padL, r: HIST.padR, t: HIST.padT, b: HIST.padB };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  if (cw <= 0 || ch <= 0) return;
  const { lo, hi, band } = HIST;
  const bins = binify(alts, lo, hi, band);
  const maxBin = Math.max(1, ...bins);
  const xOf = (/** @type {number} */ alt) => pad.l + ((alt - lo) / (hi - lo)) * cw;
  const line = (/** @type {number} */ x1, /** @type {number} */ y1, /** @type {number} */ x2, /** @type {number} */ y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

  ctx.font = '10px "JetBrains Mono", monospace';

  // horizontal grid + count labels
  ctx.strokeStyle = GRID;
  ctx.fillStyle = AXIS;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ch / 4) * i;
    line(pad.l, y, w - pad.r, y);
    ctx.fillText(String(Math.round((maxBin / 4) * (4 - i))), pad.l - 8, y + 3);
  }
  // altitude axis labels every 200 km
  ctx.textAlign = 'center';
  for (let a = 400; a <= 1400; a += 200) ctx.fillText(String(a), xOf(a), h - 12);

  // bars: dim ahead of the sweep, lit with a crisp white topline behind it;
  // the hovered bin gets the single ice accent instead of white
  const sweepX = pad.l + cw * t;
  const bw = cw / bins.length;
  bins.forEach((c, i) => {
    if (!c) return;
    const bh = (c / maxBin) * ch;
    const x = pad.l + i * bw;
    const y = pad.t + ch - bh;
    const revealed = x <= sweepX;
    const hot = i === hover;
    const grad = ctx.createLinearGradient(0, y, 0, pad.t + ch);
    if (hot) {
      grad.addColorStop(0, 'rgba(143,198,255,0.42)');
      grad.addColorStop(1, 'rgba(143,198,255,0.05)');
    } else {
      grad.addColorStop(0, revealed ? 'rgba(244,246,248,0.50)' : 'rgba(244,246,248,0.08)');
      grad.addColorStop(1, revealed ? 'rgba(244,246,248,0.04)' : 'rgba(244,246,248,0.02)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, y, Math.max(1, bw - 2), bh);
    if (revealed || hot) {
      ctx.fillStyle = hot ? ICE : INK;
      ctx.fillRect(x + 1, y - 1, Math.max(1, bw - 2), 1.5);
    }
  });

  // real shell markers
  const marker = (/** @type {number} */ alt, /** @type {string} */ label, /** @type {string} */ color) => {
    const x = xOf(alt);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 4]);
    line(x, pad.t, x, pad.t + ch);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, pad.t - 8);
    ctx.restore();
  };
  marker(550, 'STARLINK ~550', ICE);
  marker(1200, 'ONEWEB ~1200', GREY);

  // moving scan-sweep highlight while loading (single subtle ice pass)
  if (t < 1) {
    const bandW = Math.min(60, Math.max(0, sweepX - pad.l));
    if (bandW > 0) {
      const g = ctx.createLinearGradient(sweepX - bandW, 0, sweepX, 0);
      g.addColorStop(0, 'rgba(143,198,255,0)');
      g.addColorStop(1, 'rgba(143,198,255,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(sweepX - bandW, pad.t, bandW, ch);
    }
    ctx.fillStyle = 'rgba(143,198,255,0.7)';
    ctx.fillRect(sweepX, pad.t, 1, ch);
  }
}

/**
 * Bin index under the pointer, or -1 outside the plot area.
 * @param {HTMLCanvasElement} canvas
 * @param {PointerEvent} e
 */
function histBinAt(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cw = rect.width - HIST.padL - HIST.padR;
  const ch = rect.height - HIST.padT - HIST.padB;
  if (cw <= 0 || ch <= 0) return -1;
  if (x < HIST.padL || x > rect.width - HIST.padR) return -1;
  if (y < HIST.padT || y > HIST.padT + ch) return -1;
  const nBins = Math.ceil((HIST.hi - HIST.lo) / HIST.band);
  return Math.min(nBins - 1, Math.max(0, Math.floor(((x - HIST.padL) / cw) * nBins)));
}

/**
 * Mono HTML tooltip following the cursor over the histogram (tap on touch).
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} tip
 * @param {number[]} alts
 * @param {{ getDone: () => boolean, setHover: (i: number) => void }} handlers
 */
function wireHistogramHover(canvas, tip, alts, { getDone, setHover }) {
  const bins = binify(alts, HIST.lo, HIST.hi, HIST.band);
  const wrap = /** @type {HTMLElement} */ (canvas.parentElement);
  const show = (/** @type {PointerEvent} */ e) => {
    if (!getDone()) return;
    const i = histBinAt(canvas, e);
    if (i < 0) { hide(); return; }
    const lo = HIST.lo + i * HIST.band;
    tip.innerHTML =
      `<span class="dv2-tip__k">${lo}–${lo + HIST.band} KM</span>` +
      `<span class="dv2-tip__v">${bins[i].toLocaleString()} OBJ</span>`;
    tip.hidden = false;
    const wrapRect = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const ox = Math.min(Math.max(4, e.clientX - wrapRect.left + 14), wrapRect.width - tw - 4);
    const oy = Math.min(Math.max(4, e.clientY - wrapRect.top - th - 10), wrapRect.height - th - 4);
    tip.style.transform = `translate(${Math.round(ox)}px, ${Math.round(oy)}px)`;
    setHover(i);
  };
  const hide = () => {
    if (tip.hidden) return;
    tip.hidden = true;
    setHover(-1);
  };
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show); // tap = tooltip on touch
  canvas.addEventListener('pointerleave', hide);
  canvas.addEventListener('pointercancel', hide);
}

/**
 * Shared cross-section geometry for draw + hover hit-testing.
 * @param {number} w
 * @param {number} h
 */
function shellGeom(w, h) {
  const cx = w / 2, cy = h - 24;
  const rEarth = 13;
  const maxR = Math.min(h - 52, w / 2 - 14);
  const rOf = (/** @type {number} */ alt) => rEarth + 6 + (Math.min(alt, 1500) / 1500) * (maxR - rEarth - 6);
  return { cx, cy, rEarth, maxR, rOf };
}

/**
 * Nearest shell arc within 14 px of the pointer, else -1.
 * @param {HTMLCanvasElement} canvas
 * @param {Shell[]} shells
 * @param {PointerEvent} e
 */
function hitTestShell(canvas, shells, e) {
  const rect = canvas.getBoundingClientRect();
  const { cx, cy, rEarth, maxR, rOf } = shellGeom(rect.width, rect.height);
  if (maxR <= rEarth + 10) return -1;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (y > cy) return -1; // below the ground line
  const d = Math.hypot(x - cx, y - cy);
  let best = -1, bestErr = 14;
  shells.forEach((s, i) => {
    const err = Math.abs(d - rOf(s.mid));
    if (err < bestErr) { bestErr = err; best = i; }
  });
  return best;
}

/**
 * Orbital-shell cross-section: concentric arcs above Earth, arc thickness /
 * brightness proportional to real object counts (t: 0..1 sweep). Apex labels
 * get a knocked-out backing so arcs never strike through the text; hover ≥ 0
 * lifts one arc and dims the rest.
 * @param {HTMLCanvasElement} canvas
 * @param {Shell[]} shells
 * @param {number} t
 * @param {number} [hover]
 */
function drawShellsCross(canvas, shells, t, hover = -1) {
  const { ctx, w, h } = fitCanvas(canvas, 360, 290);
  ctx.clearRect(0, 0, w, h);
  const { cx, cy, rEarth, maxR, rOf } = shellGeom(w, h);
  if (maxR <= rEarth + 10) return;
  const maxCount = Math.max(1, ...shells.map((s) => s.count));

  ctx.font = '9px "JetBrains Mono", monospace';

  // faint reference semicircles + ground line
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, rEarth + ((maxR - rEarth) * i) / 3, Math.PI, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(Math.max(0, cx - maxR - 6), cy); ctx.lineTo(Math.min(w, cx + maxR + 6), cy); ctx.stroke();

  // earth dot — one thin ice hairline, no glow
  ctx.fillStyle = '#0B0E12';
  ctx.strokeStyle = ICE;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, rEarth, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = AXIS;
  ctx.textAlign = 'center';
  ctx.fillText('EARTH', cx, cy + 14);

  // shell arcs sweep from the left horizon to the right
  const endA = Math.PI + Math.PI * t;
  shells.forEach((s, i) => {
    const k = s.count / maxCount;
    const hot = i === hover;
    const dimmed = hover >= 0 && !hot;
    ctx.strokeStyle = s.hex;
    ctx.globalAlpha = dimmed ? (0.25 + 0.7 * k) * 0.3 : hot ? Math.min(1, 0.55 + 0.45 * k) : 0.25 + 0.7 * k;
    ctx.lineWidth = (2 + 10 * k) + (hot ? 2 : 0);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, rOf(s.mid), Math.PI, endA); ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // apex labels fade in once the sweep passes vertical — each drawn over a
  // knocked-out dark backing, clamped to the canvas, so arcs never cross text
  if (t >= 0.5) {
    ctx.globalAlpha = Math.min(1, (t - 0.5) * 2);
    ctx.textAlign = 'left';
    shells.forEach((s, i) => {
      const r = rOf(s.mid);
      const hot = i === hover;
      const dimmed = hover >= 0 && !hot;
      const text = `${s.short} · ${s.count}`;
      const tw = ctx.measureText(text).width;
      const lx = Math.min(cx + 10, w - 6 - tw); // never clip at the right edge
      if (dimmed) ctx.globalAlpha = Math.min(1, (t - 0.5) * 2) * 0.35;
      ctx.fillStyle = 'rgba(5,7,8,0.82)'; // knockout backing (page bg tone)
      ctx.fillRect(lx - 4, cy - r - 6, tw + 8, 13);
      ctx.fillStyle = s.hex;
      ctx.beginPath(); ctx.arc(cx, cy - r, hot ? 2.4 : 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hot ? ICE : 'rgba(244,246,248,0.85)';
      ctx.fillText(text, lx, cy - r + 3);
      ctx.globalAlpha = Math.min(1, (t - 0.5) * 2);
    });
    ctx.globalAlpha = 1;
  }
}
