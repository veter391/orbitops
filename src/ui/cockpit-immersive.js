// @ts-check
/**
 * Immersive cockpit — the full-screen mission-control experience.
 *
 * v2: renders a REAL constellation. Thousands of catalogued objects (Starlink,
 * OneWeb) are pulled from CelesTrak and propagated with real SGP4 on a globe
 * that spins by real sidereal time under a day/night terminator that tracks
 * the real Sun. Orbital data is real; per-satellite health telemetry has no
 * public feed and is clearly labelled SIMULATED.
 *
 * @module ui/cockpit-immersive
 */

'use strict';

import { SATELLITES } from '../data/satellites.js';
import { agent, SCENARIOS } from '../scenarios/index.js';
import { mountAgentPanel } from './agent-panel.js';
import { audit } from '../core/audit-log.js';
import { isConnected, BackendClient } from '../core/backend-client.js';
import { error as toastError } from './toast.js';
import { loadConstellation } from '../core/live-constellation.js';
import { propagateEci, geodetic, speedKms } from '../core/sgp4.js';
import { sunEciDirection } from '../core/sun.js';
import { esc } from '../utils.js';

const EARTH_RADIUS = 6371; // km
const SCENE_SCALE = 1 / 1500;
const MAX_SATS = 2200; // rendered/propagated per frame — real total is reported separately

// v3 monochrome-premium palette: white light + a single ice accent.
/** @type {Record<string, number>} */
const GROUP_COLOR = {
  starlink: 0x8fc6ff, // ice
  oneweb: 0xe6edf4, // white
  stations: 0xe0b568,
  default: 0xc9d6e2,
};
/** @type {Record<string, string>} */
const SOURCE_LABEL = {
  live: 'LIVE · CELESTRAK',
  cache: 'CACHED · CELESTRAK',
  snapshot: 'SNAPSHOT · CELESTRAK',
  custom: 'LIVE · CUSTOM FEED',
};

// ECI (km) -> scene coords. ECI z (spin axis) maps to scene +Y (up).
// Returns a REUSED scratch triple to avoid ~44k array allocs/sec in the render
// loop — callers must destructure immediately and never hold the reference.
const _scenePt = [0, 0, 0];
/** @param {{x: number, y: number, z: number}} p @returns {number[]} */
function eciToScene(p) {
  _scenePt[0] = p.x * SCENE_SCALE;
  _scenePt[1] = p.z * SCENE_SCALE;
  _scenePt[2] = -p.y * SCENE_SCALE;
  return _scenePt;
}

/** Telemetry `quality` → cockpit status color. */
const QUALITY_COLOR = {
  good: 'var(--ok)',
  suspect: 'var(--warn)',
  bad: 'var(--alert)',
  stale: 'var(--text-mute)',
};

// Defensive render caps — the backend is a trust boundary and `latestPerMetric`
// carries no LIMIT, so an oversized/adversarial payload must not be able to
// freeze the footer. Mirrors the dashboard's `slice` caps.
const MAX_LIVE_POINTS = 64; // bound the grouping pass over the readings
const MAX_LIVE_SUBSYSTEMS = 8; // bound the number of rendered subsystem cells

/**
 * Render the LIVE telemetry panel for a selected object from real backend
 * points, grouped by subsystem and colored by reading quality. Mirrors the
 * SIMULATED panel's markup (same `.cockpit-tlm__*` classes) so the footer looks
 * identical apart from an honest green "LIVE TELEMETRY" chip.
 * @param {{name: string}} sat
 * @param {Array<{subsystem: string, metric: string, value: number, unit: string|null, quality: string}>} points
 * @returns {string}
 */
function liveTelemetryHtml(sat, points) {
  /** @type {Map<string, typeof points>} subsystem → its points */
  const bySub = new Map();
  for (const p of points.slice(0, MAX_LIVE_POINTS)) {
    const key = p.subsystem || '—';
    const arr = bySub.get(key) || [];
    arr.push(p);
    bySub.set(key, arr);
  }
  let html =
    `<div class="cockpit-tlm__head"><span class="cockpit-tlm__sat">${esc(sat.name)}</span>` +
    `<span class="cockpit-tlm__sub cockpit-tlm__sub--live" title="Real readings streamed from the connected backend for this satellite id.">LIVE TELEMETRY</span></div>` +
    `<div class="cockpit-tlm__grid">`;
  for (const [sub, pts] of [...bySub].slice(0, MAX_LIVE_SUBSYSTEMS)) {
    html += `<div class="cockpit-tlm__cell"><div class="cockpit-tlm__cell-head">${esc(sub)}</div>`;
    for (const p of pts.slice(0, 4)) {
      const v = Number(p.value);
      const val = !Number.isFinite(v)
        ? '—'
        : Math.abs(v) >= 100
          ? v.toFixed(0)
          : Math.abs(v) >= 10
            ? v.toFixed(1)
            : v.toFixed(2);
      const color = QUALITY_COLOR[/** @type {keyof typeof QUALITY_COLOR} */ (p.quality)] || 'var(--ok)';
      html +=
        `<div class="cockpit-tlm__metric"><span class="cockpit-tlm__metric-label">${esc(p.metric)}</span>` +
        `<span class="cockpit-tlm__metric-val" style="color: ${color};">${val}${p.unit ? ' ' + esc(p.unit) : ''}</span></div>`;
    }
    html += '</div>';
  }
  return html + '</div>';
}

/**
 * Connected-mode live telemetry controller for the cockpit.
 *
 * The cockpit shows the public catalog (Starlink/OneWeb); the backend serves an
 * OPERATOR's own fleet telemetry keyed by an arbitrary `satelliteId`. When the
 * operator keys their readings by a catalog object's NORAD id or exact name, the
 * selected object's footer panel switches from SIMULATED to the real streamed
 * readings — otherwise it stays honestly labelled SIMULATED. Fully additive and
 * fail-safe: any backend/stream error silently leaves the cockpit in its
 * deterministic simulation, so demo mode is never affected.
 *
 * @param {() => ({name: string, noradId: number}|null)} getSelected
 * @returns {{ pointsFor: (sat: any) => any[]|null, onSelect: (sat: any) => void, dispose: () => void }}
 */
function createLiveTelemetry(getSelected) {
  const client = new BackendClient();
  let disposed = false;
  /** @type {WebSocket|null} */
  let socket = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let refreshTimer = null;
  /** @type {Set<string>} coalesced ids awaiting refresh */
  const pending = new Set();
  /** @type {Map<string, string>} lowercased match-key → canonical backend satelliteId */
  const ids = new Map();
  /** @type {Map<string, any[]>} canonical satelliteId → latest points */
  const cache = new Map();
  /** @type {Map<string, number>} canonical satelliteId → latest issued fetch sequence */
  const seq = new Map();

  /** Resolve a catalog object to the backend satelliteId that reports it, if any.
   * @param {any} sat @returns {string|null} */
  const resolve = (sat) => {
    if (!sat) return null;
    return ids.get(String(sat.noradId).toLowerCase()) || ids.get(String(sat.name || '').toLowerCase()) || null;
  };

  /** Sequence-guarded latest-readings fetch (drops out-of-order responses).
   * @param {string} id */
  const fetchSat = async (id) => {
    const my = (seq.get(id) || 0) + 1;
    seq.set(id, my);
    try {
      const { points } = await client.latestTelemetry(id);
      if (disposed || seq.get(id) !== my) return;
      cache.set(id, Array.isArray(points) ? points : []);
    } catch {
      /* one satellite's fetch failing is non-fatal — the sim panel stays */
    }
  };

  /** @param {string} id */
  const scheduleRefresh = (id) => {
    if (disposed) return;
    pending.add(id);
    if (refreshTimer) return;
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      const batch = [...pending];
      pending.clear();
      await Promise.all(batch.map(fetchSat));
      // Reconcile the id/cache maps against the live fleet so a departed
      // satellite ages out (mirrors the dashboard's post-fetch reconcile).
      await loadIds();
    }, 400);
  };

  const loadIds = async () => {
    try {
      const { satellites } = await client.telemetrySatellites();
      if (disposed || !Array.isArray(satellites)) return;
      // Rebuild the resolve map from the authoritative fleet list and prune any
      // satellite that no longer reports, so ids/cache/seq stay bounded to the
      // live fleet over a long session (the dashboard prunes the same way).
      ids.clear();
      for (const s of satellites) {
        if (s && s.satelliteId) ids.set(String(s.satelliteId).toLowerCase(), s.satelliteId);
      }
      const live = new Set(ids.values());
      for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
      for (const id of [...seq.keys()]) if (!live.has(id)) seq.delete(id);
      // The selected object may now resolve — warm its panel.
      const id = resolve(getSelected());
      if (id && !cache.has(id)) fetchSat(id);
    } catch {
      /* backend unreachable — the cockpit stays in its deterministic simulation */
    }
  };

  loadIds();
  client
    .openStream(
      (evt) => {
        const d = /** @type {{satelliteId?: string}} */ ((evt && evt.data) || {});
        if (!evt || evt.type !== 'telemetry' || !d.satelliteId) return;
        // React only to the object currently on screen, matched directly against
        // the selection — so we never accumulate ids for satellites never viewed.
        const sel = getSelected();
        if (!sel) return;
        const key = String(d.satelliteId).toLowerCase();
        if (key === String(sel.noradId).toLowerCase() || key === String(sel.name || '').toLowerCase()) {
          scheduleRefresh(d.satelliteId);
        }
      },
      {},
    )
    .then((ws) => {
      if (disposed) {
        try { ws.close(); } catch { /* already closing */ }
        return;
      }
      socket = ws;
    })
    .catch(() => { /* streaming optional — the panel keeps its last snapshot / sim */ });

  return {
    /** @param {any} sat @returns {any[]|null} live points for this object, or null */
    pointsFor(sat) {
      const id = resolve(sat);
      if (!id) return null;
      const pts = cache.get(id);
      return pts && pts.length ? pts : null;
    },
    /** @param {any} sat fetch the object's readings on selection if not cached */
    onSelect(sat) {
      if (disposed) return;
      const id = resolve(sat);
      if (id) {
        if (!cache.has(id)) fetchSat(id);
      } else {
        // Unknown so far — reconcile in case it started reporting since load.
        loadIds();
      }
    },
    dispose() {
      disposed = true;
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      if (socket) { try { socket.close(); } catch { /* already closing */ } socket = null; }
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {any} THREE
 */
export async function mountCockpit(host, THREE) {
  await audit.append('system', 'cockpit.mount', { view: 'immersive' });

  host.innerHTML = `
    <div class="cockpit-immersive">
      <div class="cockpit-immersive__chrome">
        <div class="cockpit-immersive__brand">
          <span class="cockpit-immersive__pulse"></span>
          <span>orbitops://cockpit</span>
          <span class="cockpit-datapill" id="cockpitSource">CONNECTING…</span>
        </div>
        <div class="cockpit-immersive__title" id="cockpitTitle">ACQUIRING CATALOG…</div>
        <div class="cockpit-immersive__status">
          <span class="cockpit-immersive__status-dot"></span>
          <span id="healthReadout">— TRACKED</span>
        </div>
      </div>

      <div class="cockpit-immersive__viewport">
        <aside class="cockpit-side cockpit-side--left">
          <div class="cockpit-side__head">
            <span class="cockpit-side__label">CONSTELLATION</span>
            <span class="cockpit-side__value" id="satCount">…</span>
          </div>
          <input class="cockpit-search" id="satSearch" placeholder="Search by name / NORAD…" autocomplete="off" />
          <div class="cockpit-sats" id="cockpitSats"></div>
        </aside>

        <div class="cockpit-stage" id="cockpitStage">
          <div class="hud hud--tl">
            <div class="hud__label">MISSION CLOCK · UTC</div>
            <div class="hud__value" id="hudClock">--:--:--</div>
            <div class="hud__sub" id="hudFrame">T+00:00:00</div>
          </div>
          <div class="hud hud--tr">
            <div class="hud__label">IN SUNLIGHT</div>
            <div class="hud__bar"><div class="hud__bar-fill" id="hudSunBar" style="width:0%; background: var(--warn);"></div></div>
            <div class="hud__value" id="hudSun">—</div>
          </div>
          <div class="hud hud--bl">
            <div class="hud__label">FOCUS</div>
            <div class="hud__value" id="hudFocus">—</div>
            <div class="hud__sub" id="hudFocusSub">select an object</div>
            <div class="hud__sub" id="hudNextPass" hidden></div>
          </div>
          <div class="hud hud--br">
            <div class="hud__label">AUDIT CHAIN · SHA-256</div>
            <div class="hud__value" id="hudAudit">0 entries</div>
          </div>
          <canvas id="cockpitCanvas"></canvas>
        </div>

        <aside class="cockpit-side cockpit-side--right">
          <div class="cockpit-side__head">
            <span class="cockpit-side__label" title="Scripted flight-ops scenarios over real orbital math. Connect a backend (Settings) for the live triage queue on the Agent page.">AI AGENT · SCENARIOS</span>
            <span class="cockpit-side__value">${SCENARIOS.length} scenarios</span>
          </div>
          <div class="cockpit-scenarios" id="cockpitScenarios"></div>
        </aside>

        <div class="cockpit-ticker">
          <span class="cockpit-ticker__arrow">›</span>
          <span class="cockpit-ticker__content" id="cockpitTicker"></span>
        </div>
      </div>

      <div class="cockpit-immersive__footer">
        <div class="cockpit-telemetry" id="cockpitTelemetry"></div>
        <div class="cockpit-controls">
          <button class="cockpit-control" id="ctrlPlay" title="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
          <button class="cockpit-control" id="ctrlPause" title="Pause"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg></button>
          <div class="cockpit-control__divider"></div>
          <button class="cockpit-control" id="ctrlSpeed"><span style="font-family: var(--font-mono); font-size: 10px; font-weight: 700;">1×</span></button>
          <div class="cockpit-control__divider"></div>
          <button class="cockpit-control" id="ctrlReset" title="Reset to now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
        </div>
      </div>

      <div class="modal-backdrop" id="proposalModal"><div class="modal" id="proposalCard"></div></div>
    </div>
  `;

  // ============== Three.js scene ==============
  const stage = /** @type {HTMLElement} */ (host.querySelector('#cockpitStage'));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050708);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.01, 2000);

  const renderer = new THREE.WebGLRenderer({
    canvas: stage.querySelector('#cockpitCanvas'),
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // ---- v3 stylized Earth: NO photo textures, no mixed skins. A dark matte
  // sphere whose CONTINENTS ARE BUILT FROM PARTICLES (dot-matrix landmass,
  // sampled from the real NASA landmass raster, then discarded — only the
  // geography survives, not the imagery) + thin white country borders.
  // Monochrome premium: white light, one ice accent, zero orange.
  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE, 96, 72);
  const earthMat = new THREE.MeshBasicMaterial({ color: 0x0a0e14 });
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // subtle white fresnel rim so the sphere reads as a body, not a hole
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE * 1.012, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying vec3 vN; void main(){ float i=pow(0.72-dot(vN,vec3(0,0,1.0)),3.0); gl_FragColor=vec4(0.62,0.70,0.78,1.0)*max(i,0.0)*0.9;} `,
      blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
    })
  ));

  const D2R = Math.PI / 180;
  // three.js SphereGeometry equirectangular mapping
  const llToXyz = (/** @type {number} */ lonDeg, /** @type {number} */ latDeg, /** @type {number} */ R) => {
    const la = latDeg * D2R, lo = lonDeg * D2R;
    return [-R * Math.cos(la) * Math.cos(lo), R * Math.sin(la), R * Math.cos(la) * Math.sin(lo)];
  };

  // Set true on unmount; the async loaders below check it so a fetch/decode that
  // resolves AFTER teardown does not attach geometry to a detached scene.
  let disposed = false;

  // Continents from particles: sample the NASA raster on a hidden 2D canvas,
  // keep only land pixels, place one particle per land cell on the sphere.
  (() => {
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      try {
        const W = 640, H = 320;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const c2 = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
        c2.drawImage(img, 0, 0, W, H);
        const px = c2.getImageData(0, 0, W, H).data;
        /** @type {number[]} */
        const pos = [];
        const shade = [];
        const R = EARTH_RADIUS * SCENE_SCALE * 1.004;
        for (let y = 1; y < H; y += 2) {
          const lat = 90 - (y / H) * 180;
          // constant surface density: sample longitude sparser near the poles
          const lonStep = Math.max(2, Math.round(2 / Math.max(0.25, Math.cos(lat * D2R))));
          for (let x = 0; x < W; x += lonStep) {
            const i = (y * W + x) * 4;
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const isOcean = b > r * 1.12 && b > g * 1.02 && b > 28;
            if (isOcean) continue;
            const lon = (x / W) * 360 - 180;
            const [X, Y, Z] = llToXyz(lon, lat, R);
            pos.push(X, Y, Z);
            // subtle per-dot brightness variation so the field feels alive
            const s = 0.72 + ((r * 7 + g * 13 + b * 3) % 40) / 140;
            shade.push(0.90 * s, 0.95 * s, 1.0 * s);
          }
        }
        const gDots = new THREE.BufferGeometry();
        gDots.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        gDots.setAttribute('color', new THREE.BufferAttribute(new Float32Array(shade), 3));
        const dots = new THREE.Points(gDots, new THREE.PointsMaterial({
          size: 0.0135, vertexColors: true, transparent: true, opacity: 0.92,
          depthWrite: false, sizeAttenuation: true,
        }));
        earth.add(dots); // rotates with the globe
      } catch (err) {
        console.warn('landmass particles failed', err);
      }
    };
    img.onerror = (e) => console.warn('landmass raster failed to load', e);
    img.src = '/public/img/3d/earth-day.jpg';
  })();

  // Country borders — thin white vectors, same rotation frame as the dots.
  (async () => {
    try {
      const res = await fetch('/public/data/world-borders.json');
      const geo = await res.json();
      if (disposed) return; // torn down while the fetch was in flight
      const R = EARTH_RADIUS * SCENE_SCALE * 1.006;
      /** @type {number[]} */
      const pos = [];
      const push = (/** @type {number} */ lon, /** @type {number} */ lat) => { const [X, Y, Z] = llToXyz(lon, lat, R); pos.push(X, Y, Z); };
      const addRing = (/** @type {any} */ ring) => {
        const step = ring.length > 400 ? 2 : 1;
        for (let i = step; i < ring.length; i += step) {
          push(ring[i - step][0], ring[i - step][1]);
          push(ring[i][0], ring[i][1]);
        }
      };
      for (const f of geo.features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') g.coordinates.forEach(addRing);
        else if (g.type === 'MultiPolygon') g.coordinates.forEach((/** @type {any[]} */ p) => p.forEach(addRing));
      }
      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      const borders = new THREE.LineSegments(
        bGeo,
        new THREE.LineBasicMaterial({ color: 0xd7e3ee, transparent: true, opacity: 0.22, depthWrite: false })
      );
      earth.add(borders);
    } catch (err) {
      console.warn('country borders failed to load', err);
    }
  })();

  // Stars
  const starsGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(3500 * 3);
  for (let i = 0; i < 3500; i++) {
    const r = 120, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    starPos[i * 3 + 2] = r * Math.cos(ph);
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xaebfd2, size: 0.1, transparent: true, opacity: 0.6 })));

  // ---- Satellites (populated after the catalog loads) ----
  /** @typedef {{name: string, noradId: number, satrec: any, group: string}} Sat */
  /** @type {Sat[]} */
  let sats = [];               // {name, noradId, satrec, group}
  /** @type {Sat|null} */
  let selected = null;
  /** @type {any} */
  let satInstanced = null;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // Satellite marker sprite — a crisp reticle (diamond + cross-ticks), not a
  // fuzzy blob. Reads like a radar contact on a real ops display.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const gctx = /** @type {CanvasRenderingContext2D} */ (glowCanvas.getContext('2d'));
  gctx.strokeStyle = 'rgba(255,255,255,1)';
  gctx.lineWidth = 9;
  gctx.beginPath(); // diamond
  gctx.moveTo(32, 6); gctx.lineTo(58, 32); gctx.lineTo(32, 58); gctx.lineTo(6, 32); gctx.closePath();
  gctx.stroke();
  gctx.fillStyle = 'rgba(255,255,255,1)';
  gctx.beginPath(); gctx.arc(32, 32, 8, 0, Math.PI * 2); gctx.fill();
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  /** @type {any} */
  let glowGeo = null;
  /** @type {any} */
  let glowPoints = null;

  // selected-sat orbit ribbon + halo
  /** @type {any} */
  let orbitLine = null;
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec2 vUv; void main(){ float dd=distance(vUv,vec2(0.5)); float ring=smoothstep(0.30,0.34,dd)*(1.0-smoothstep(0.40,0.44,dd)); float core=1.0-smoothstep(0.0,0.10,dd); float a=ring*0.9+core*0.5; gl_FragColor=vec4(0.56,0.78,1.0,a);} `,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), haloMat);
  halo.visible = false;
  scene.add(halo);

  // Hover marker — a single brighter reticle that rides the object nearest the
  // cursor and snaps to the pointer so it reads as "locked on". It is ONE extra
  // sprite updated only on pointer move (rAF-throttled), so next to the 2200-
  // object field it costs nothing. Fades via a lerp in the tick loop.
  const hoverMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const hoverMarker = new THREE.Sprite(hoverMat);
  hoverMarker.scale.setScalar(0.001);
  hoverMarker.renderOrder = 3;
  scene.add(hoverMarker);
  /** @type {Sat|null} */
  let hoveredSat = null;
  let hoverOn = 0; // eased 0..1 presence, driven in tick()

  /** @param {number} count */
  function buildSatObjects(count) {
    // invisible spheres kept purely as raycast/picking proxies
    satInstanced = new THREE.InstancedMesh(
      // 0.045 proxy radius ≈ the visible reticle's core, so both hover and
      // click land on the object you're actually aiming at, not a sub-pixel.
      new THREE.SphereGeometry(0.045, 6, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      count
    );
    satInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(satInstanced);

    // the visible layer: reticle markers, per-constellation tinted
    glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    glowPoints = new THREE.Points(glowGeo, new THREE.PointsMaterial({
      size: 0.11, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, toneMapped: false,
    }));
    scene.add(glowPoints);
  }

  function rebuildOrbit() {
    if (orbitLine) { scene.remove(orbitLine); orbitLine.geometry.dispose(); orbitLine.material.dispose(); orbitLine = null; }
    if (!selected) return;
    const noRadPerMin = selected.satrec.no; // mean motion (rad/min)
    const periodMin = noRadPerMin > 0 ? (2 * Math.PI) / noRadPerMin : 95;
    const pts = [];
    for (let j = 0; j <= 160; j++) {
      const d = new Date(simDate.getTime() + (j / 160) * periodMin * 60000);
      const pv = propagateEci(selected.satrec, d);
      if (!pv) continue;
      const [x, y, z] = eciToScene(pv.position);
      pts.push(new THREE.Vector3(x, y, z));
    }
    if (pts.length < 2) return;
    const col = GROUP_COLOR[selected.group] || GROUP_COLOR.default;
    orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.55 })
    );
    scene.add(orbitLine);
  }

  // ============== camera controls ==============
  let camTheta = 0.5, camPhi = 0.35, camDist = 11;
  let dragging = false, last = { x: 0, y: 0 }, moved = 0;
  function updateCamera() {
    camera.position.set(
      camDist * Math.cos(camPhi) * Math.sin(camTheta),
      camDist * Math.sin(camPhi),
      camDist * Math.cos(camPhi) * Math.cos(camTheta)
    );
    camera.lookAt(0, 0, 0);
  }
  renderer.domElement.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => { dragging = true; moved = 0; last = { x: e.clientX, y: e.clientY }; });
  // Named so unmount() can remove them — otherwise each /cockpit visit leaks a
  // window listener whose closure pins the (disposed) scene, blocking GC.
  const onDragEnd = () => { dragging = false; };
  const onDragMove = (/** @type {MouseEvent} */ e) => {
    if (!dragging) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    moved += Math.abs(dx) + Math.abs(dy);
    camTheta -= dx * 0.005;
    camPhi = Math.max(-1.35, Math.min(1.35, camPhi + dy * 0.005));
    last = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('mousemove', onDragMove);
  renderer.domElement.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
    e.preventDefault();
    camDist = Math.max(4.6, Math.min(40, camDist + e.deltaY * 0.01));
  }, { passive: false });

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.06 };
  const mousev = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    if (moved > 6 || !satInstanced) return;
    const r = renderer.domElement.getBoundingClientRect();
    mousev.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mousev.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mousev, camera);
    const hit = raycaster.intersectObject(satInstanced);
    if (hit.length > 0 && hit[0].instanceId != null) selectSat(sats[hit[0].instanceId]);
  });

  // Hover pick — the object nearest the cursor lights up and snaps to the
  // pointer. rAF-throttled so flinging the mouse can't queue work; at most one
  // ray + one sprite move per frame. Suppressed while dragging the camera so
  // the marker doesn't flicker during an orbit drag.
  const hoverRay = new THREE.Vector3();
  /** @type {{x: number, y: number}|null} */
  let hoverPointer = null; // {x, y} client px, or null when the pointer left
  let hoverRaf = 0;
  // While hovering an object we ask the GLOBAL cursor satellite (cursor-sat.js,
  // mounted by main.js on this route) to ride the pointer tip instead of
  // trailing beside it — so on the globe it reads as "locked on" to the object
  // under the cursor. Decoupled via window events; a no-op if it isn't mounted.
  let cursatLocked = false;
  let cursatUnlockTimer = 0;
  function syncCursat() {
    if (hoveredSat) {
      // gained (or still on) an object — lock immediately, cancel any pending
      // release so a one-frame raycast miss as an object drifts under the
      // cursor doesn't make the satellite flicker off the tip.
      if (cursatUnlockTimer) { clearTimeout(cursatUnlockTimer); cursatUnlockTimer = 0; }
      if (!cursatLocked) {
        cursatLocked = true;
        window.dispatchEvent(new CustomEvent('orbitops:cursat-lock'));
      }
    } else if (cursatLocked && !cursatUnlockTimer) {
      // left every object — release after a short grace period.
      cursatUnlockTimer = setTimeout(() => {
        cursatUnlockTimer = 0;
        cursatLocked = false;
        window.dispatchEvent(new CustomEvent('orbitops:cursat-unlock'));
      }, 180);
    }
  }
  function pickHover() {
    hoverRaf = 0;
    if (!satInstanced || !sats.length || !hoverPointer || dragging) {
      hoveredSat = null;
      syncCursat();
      return;
    }
    const r = renderer.domElement.getBoundingClientRect();
    mousev.x = ((hoverPointer.x - r.left) / r.width) * 2 - 1;
    mousev.y = -((hoverPointer.y - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mousev, camera);
    const hit = raycaster.intersectObject(satInstanced);
    if (hit.length > 0 && hit[0].instanceId != null) {
      hoveredSat = sats[hit[0].instanceId] || null;
      // snap to the cursor ray at the object's depth → "locked to the mouse"
      raycaster.ray.at(hit[0].distance, hoverRay);
      hoverMarker.position.copy(hoverRay);
      renderer.domElement.style.cursor = 'pointer';
    } else {
      hoveredSat = null;
      renderer.domElement.style.cursor = '';
    }
    syncCursat();
  }
  function onHoverMove(/** @type {PointerEvent} */ e) {
    hoverPointer = { x: e.clientX, y: e.clientY };
    if (!hoverRaf) hoverRaf = requestAnimationFrame(pickHover);
  }
  function onHoverLeave() {
    hoverPointer = null;
    hoveredSat = null;
    renderer.domElement.style.cursor = '';
    syncCursat();
  }
  renderer.domElement.addEventListener('pointermove', onHoverMove, { passive: true });
  renderer.domElement.addEventListener('pointerleave', onHoverLeave);

  function resize() {
    const r = stage.getBoundingClientRect();
    const hasTicker = !!host.querySelector('.cockpit-ticker');
    const w = r.width, h = hasTicker ? r.height - 32 : r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ============== left list ==============
  const satListEl = /** @type {HTMLElement} */ (host.querySelector('#cockpitSats'));
  const searchEl = /** @type {HTMLInputElement} */ (host.querySelector('#satSearch'));
  function renderList(/** @type {string} */ filter = '') {
    const f = filter.trim().toLowerCase();
    const matches = (f ? sats.filter((s) => s.name.toLowerCase().includes(f) || String(s.noradId).includes(f)) : sats).slice(0, 90);
    satListEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    matches.forEach((s) => {
      const item = document.createElement('button');
      item.className = 'cockpit-sat-item';
      item.dataset.norad = /** @type {any} */ (s.noradId);
      const color = '#' + (GROUP_COLOR[s.group] || GROUP_COLOR.default).toString(16).padStart(6, '0');
      item.innerHTML = `
        <div class="cockpit-sat-item__dot" style="background:${color}; box-shadow:0 0 8px ${color};"></div>
        <div class="cockpit-sat-item__info">
          <div class="cockpit-sat-item__name">${esc(s.name)}</div>
          <div class="cockpit-sat-item__sub">${s.group} · ${s.noradId}</div>
        </div>`;
      item.addEventListener('click', () => selectSat(s));
      if (selected && s.noradId === selected.noradId) item.classList.add('is-active');
      frag.appendChild(item);
    });
    satListEl.appendChild(frag);
  }
  /** @type {ReturnType<typeof setTimeout>|null} */
  let searchTimer = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(/** @type {any} */ (searchTimer));
    searchTimer = setTimeout(() => renderList(searchEl.value), 120);
  });

  // W4-C · D5 — "next pass over you" (REAL): shown only if geolocation
  // permission is ALREADY granted — we never prompt from the cockpit. Uses the
  // shared core/passes.js look-angle math (lazy import). If anything is
  // unavailable (no permissions API, denied, no pass), the line stays hidden —
  // never a fake value.
  /** @type {{latDeg: number, lonDeg: number}|null} */
  let passObserverSite = null; // {latDeg, lonDeg}, resolved once
  let passHudToken = 0;
  async function updateNextPassHud() {
    const el = /** @type {HTMLElement|null} */ (host.querySelector('#hudNextPass'));
    if (!el) return;
    const token = ++passHudToken;
    el.hidden = true;
    try {
      if (!selected || !navigator.permissions || !navigator.geolocation) return;
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state !== 'granted') return;
      if (!passObserverSite) {
        passObserverSite = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (/** @type {GeolocationPosition} */ pos) => resolve({ latDeg: pos.coords.latitude, lonDeg: pos.coords.longitude }),
            reject,
            { maximumAge: 600000, timeout: 8000 }
          );
        });
      }
      const sat = selected;
      const { nextPass } = await import('../core/passes.js');
      const p = nextPass(sat.satrec, /** @type {{latDeg: number, lonDeg: number}} */ (passObserverSite), { hours: 24, stepSec: 30, minElevationDeg: 10 });
      if (token !== passHudToken || selected !== sat) return; // stale result
      el.textContent = p
        ? `NEXT PASS ${p.aos.toISOString().slice(11, 19)} UTC · MAX EL ${p.maxElDeg.toFixed(0)}°`
        : 'NO PASS ≥10° OVER YOU IN 24 H';
      el.hidden = false;
    } catch {
      /* honest silence — geolocation or math unavailable, so no line */
    }
  }

  /** @param {Sat|null} s */
  function selectSat(s) {
    if (!s) return;
    selected = s;
    liveTlm?.onSelect(s);
    rebuildOrbit();
    updateFocusHud();
    updateNextPassHud();
    host.querySelectorAll('.cockpit-sat-item').forEach((x) => x.classList.toggle('is-active', Number(/** @type {HTMLElement} */ (x).dataset.norad) === selected?.noradId));
  }

  // ============== right: scenarios (labelled demo on the reference fleet) ==============
  const scEl = /** @type {HTMLElement} */ (host.querySelector('#cockpitScenarios'));
  SCENARIOS.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'cockpit-scenario';
    btn.innerHTML = `<div class="cockpit-scenario__icon">${s.icon}</div><div><div class="cockpit-scenario__name">${s.title}</div><div class="cockpit-scenario__desc">${s.description}</div></div>`;
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.classList.add('is-thinking');
      try {
        const p = await agent.runScenario(s.id, { satelliteId: SATELLITES[0].id, timeSec: Math.floor(simSeconds) });
        showProposal(p);
      } catch (err) {
        console.error(`cockpit scenario "${s.id}" failed`, err);
        toastError(`Could not run "${s.title}".`, { title: 'Scenario failed' });
      }
      btn.disabled = false; btn.classList.remove('is-thinking');
    });
    scEl.appendChild(btn);
  });

  const modal = /** @type {HTMLElement} */ (host.querySelector('#proposalModal'));
  const modalCard = /** @type {HTMLElement} */ (host.querySelector('#proposalCard'));
  /** @param {any} p */
  function showProposal(p) {
    mountAgentPanel(modalCard, p, {
      onApprove: async () => { await agent.approve(p.id, 'demo-operator'); modal.classList.remove('is-show'); updateAuditHud(); },
      onReject: async (r) => { await agent.reject(p.id, 'demo-operator', r); modal.classList.remove('is-show'); updateAuditHud(); },
      onModify: async (m) => { await agent.modifyAndApprove(p.id, 'demo-operator', m); modal.classList.remove('is-show'); updateAuditHud(); },
      onClose: () => modal.classList.remove('is-show'),
    });
    modal.classList.add('is-show');
    updateAuditHud();
  }

  // ============== time controls ==============
  const startMs = Date.now();
  let simSeconds = 0, speed = 1, playing = true, lastTs = performance.now();
  let simDate = new Date(startMs);
  const speeds = [1, 10, 60, 300, 1800];
  let speedIdx = 0;
  /** @type {HTMLElement} */ (host.querySelector('#ctrlPlay')).addEventListener('click', () => (playing = true));
  /** @type {HTMLElement} */ (host.querySelector('#ctrlPause')).addEventListener('click', () => (playing = false));
  const speedBtn = /** @type {HTMLElement} */ (host.querySelector('#ctrlSpeed'));
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    speed = speeds[speedIdx];
    /** @type {HTMLElement} */ (speedBtn.querySelector('span')).textContent = speed + '×';
  });
  /** @type {HTMLElement} */ (host.querySelector('#ctrlReset')).addEventListener('click', () => { simSeconds = 0; });

  // ============== HUD / telemetry ==============
  function fmt(/** @type {number} */ v, dp = 1) { return Number(v).toFixed(dp); }
  function pad(/** @type {number} */ n) { return String(n).padStart(2, '0'); }
  function fmtDur(/** @type {number} */ s) { return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`; }

  function updateFocusHud() {
    if (!selected) return;
    const pv = propagateEci(selected.satrec, simDate);
    const focusEl = /** @type {HTMLElement} */ (host.querySelector('#hudFocus'));
    const subEl = /** @type {HTMLElement} */ (host.querySelector('#hudFocusSub'));
    focusEl.textContent = selected.name;
    if (pv) {
      const g = geodetic(pv.position, simDate);
      subEl.textContent = `${fmt(g.altKm, 0)} km · ${fmt(g.latDeg, 1)}°, ${fmt(g.lonDeg, 1)}° · ${fmt(speedKms(pv.velocity), 2)} km/s`;
    } else {
      subEl.textContent = `${selected.group} · ${selected.noradId}`;
    }
  }
  function updateAuditHud() {
    /** @type {HTMLElement} */ (host.querySelector('#hudAudit')).textContent = `${audit.entries.length} entries`;
  }

  // Connected mode: a live telemetry controller streams the operator's real
  // fleet health from the backend and lights up the panel for any selected
  // object whose NORAD id / name it reports. Null (and inert) in the default
  // simulation, so demo mode is untouched.
  const liveTlm = isConnected() ? createLiveTelemetry(() => selected) : null;

  // Simulated telemetry (no public per-sat feed exists) — deterministic per object.
  /** @type {Array<[string, Array<[string, number, number, string]>]>} */
  const SUBSYS = [
    ['PWR', [['Battery V', 27.4, 0.6, 'V'], ['Panel A', 6.0, 0.5, 'A'], ['Bus', 640, 40, 'W']]],
    ['THM', [['Battery °C', 19, 3, ''], ['CPU °C', 44, 5, ''], ['Radiator °C', 22, 4, '']]],
    ['ATT', [['Pointing', 0.03, 0.04, '°'], ['Wheel', 1450, 220, 'rpm']]],
    ['COM', [['Signal', -85, 4, 'dBm'], ['Downlink', 52, 8, 'Mbps']]],
  ];
  function telemetryHtml() {
    if (!selected) return '<div class="cockpit-tlm__head"><span class="cockpit-tlm__sat">No object selected</span></div>';
    // Connected mode: if the backend reports real telemetry for this object,
    // show it (honestly labelled LIVE); otherwise fall through to SIMULATED.
    if (liveTlm) {
      const livePts = liveTlm.pointsFor(selected);
      if (livePts) return liveTelemetryHtml(selected, livePts);
    }
    const seed = selected.noradId;
    let html = `<div class="cockpit-tlm__head"><span class="cockpit-tlm__sat">${esc(selected.name)}</span><span class="cockpit-tlm__sub" title="No public per-satellite health feed exists — these values are modelled. Connect your fleet's telemetry (Settings → Connected Backend) or self-host to stream live readings here.">CONNECT FEED FOR LIVE</span></div><div class="cockpit-tlm__grid">`;
    for (const [label, metrics] of SUBSYS) {
      html += `<div class="cockpit-tlm__cell"><div class="cockpit-tlm__cell-head">${label}</div>`;
      metrics.forEach(([name, base, amp, unit], i) => {
        const v = base + Math.sin(simSeconds / 300 + seed * 0.1 + i) * amp + (Math.sin(seed * 12.9 + i * 7.7) * 0.5) * amp * 0.3;
        const val = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
        html += `<div class="cockpit-tlm__metric"><span class="cockpit-tlm__metric-label">${name}</span><span class="cockpit-tlm__metric-val" style="color: var(--ok);">${val}${unit}</span></div>`;
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  const tlmEl = /** @type {HTMLElement} */ (host.querySelector('#cockpitTelemetry'));
  const tickerEl = /** @type {HTMLElement} */ (host.querySelector('#cockpitTicker'));

  // ============== load the real catalog ==============
  let litFraction = 0;
  try {
    const result = await loadConstellation(['starlink', 'oneweb'], { max: MAX_SATS });
    sats = /** @type {Sat[]} */ (result.sats);
    selected = sats[0] || null;
    liveTlm?.onSelect(selected);
    buildSatObjects(sats.length);
    rebuildOrbit();
    renderList('');
    /** @type {HTMLElement} */ (host.querySelector('#cockpitSource')).textContent = SOURCE_LABEL[result.source] || 'CELESTRAK';
    /** @type {HTMLElement} */ (host.querySelector('#cockpitTitle')).textContent =
      `${result.total.toLocaleString()} OBJECTS · STARLINK + ONEWEB · ${sats.length.toLocaleString()} SHOWN`;
    /** @type {HTMLElement} */ (host.querySelector('#satCount')).textContent = `${sats.length.toLocaleString()} shown`;
    /** @type {HTMLElement} */ (host.querySelector('#healthReadout')).textContent = `${result.total.toLocaleString()} TRACKED`;
    updateFocusHud();
    updateAuditHud();
    await audit.append('system', 'catalog.loaded', { total: result.total, shown: sats.length, source: result.source });
  } catch (err) {
    console.error('constellation load failed', err);
    /** @type {HTMLElement} */ (host.querySelector('#cockpitSource')).textContent = 'CATALOG UNAVAILABLE';
    toastError('Could not load the satellite catalog.', { title: 'Catalog' });
  }

  // ============== animation ==============
  const R2 = (EARTH_RADIUS * SCENE_SCALE) * (EARTH_RADIUS * SCENE_SCALE);
  const FIELD_MS = 50;     // refresh the 2200-object field at ~20 Hz
  let lastFieldMs = -1e9;  // negative sentinel forces a field pass on frame 1
  function tick(/** @type {number} */ ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (playing) simSeconds += dt * speed;
    simDate = new Date(startMs + simSeconds * 1000);

    updateCamera();

    // Slow cinematic spin; the "in sunlight" metric stays honest — computed
    // against the REAL solar direction for the current sim time.
    earth.rotation.y += dt * 0.015;

    // Heavy field — 2200 SGP4 propagations. At everyday speeds each object
    // moves sub-pixel between frames, so recomputing the whole field every
    // frame is wasted work; we refresh it at ~20 Hz. Only fast time-scrub
    // (≥60×) would visibly step, so there we fall back to per-frame. Camera,
    // globe spin and the selected-sat halo stay per-frame regardless, so the
    // view never feels stalled — this is a pure CPU saving, not a visual one.
    if (satInstanced && sats.length && (speed >= 60 || ts - lastFieldMs >= FIELD_MS)) {
      lastFieldMs = ts;
      // unit sun vector in scene axes (same axis swap as eciToScene, NO scale —
      // scaling it would break the eclipse test's geometry)
      const se = sunEciDirection(simDate);
      const sx = se.x, sy = se.z, sz = -se.y;
      const gp = glowGeo.attributes.position.array;
      const gc = glowGeo.attributes.color.array;
      let lit = 0;
      for (let i = 0; i < sats.length; i++) {
        const pv = propagateEci(sats[i].satrec, simDate);
        if (!pv) { dummy.scale.setScalar(0); dummy.updateMatrix(); satInstanced.setMatrixAt(i, dummy.matrix); continue; }
        const [x, y, z] = eciToScene(pv.position);
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(sats[i] === selected ? 3.2 : 1);
        dummy.updateMatrix();
        satInstanced.setMatrixAt(i, dummy.matrix);
        tmpColor.set(GROUP_COLOR[sats[i].group] || GROUP_COLOR.default);
        satInstanced.setColorAt(i, tmpColor);
        gp[i * 3] = x; gp[i * 3 + 1] = y; gp[i * 3 + 2] = z;
        gc[i * 3] = tmpColor.r; gc[i * 3 + 1] = tmpColor.g; gc[i * 3 + 2] = tmpColor.b;
        // in sunlight if not behind Earth relative to the Sun
        const along = x * sx + y * sy + z * sz;
        const perp2 = (x * x + y * y + z * z) - along * along;
        if (along > 0 || perp2 > R2) lit++;
      }
      satInstanced.instanceMatrix.needsUpdate = true;
      if (satInstanced.instanceColor) satInstanced.instanceColor.needsUpdate = true;
      glowGeo.attributes.position.needsUpdate = true;
      glowGeo.attributes.color.needsUpdate = true;
      litFraction = lit / sats.length;
    }

    // Selected-sat halo — every frame so the focal point stays fluid even
    // while the background field refreshes at the lower cadence above.
    if (satInstanced && sats.length) {
      const spv = propagateEci(selected?.satrec, simDate);
      if (spv) {
        const [hx, hy, hz] = eciToScene(spv.position);
        halo.position.set(hx, hy, hz);
        halo.lookAt(camera.position);
        halo.scale.setScalar(1 + Math.sin(simSeconds * 2) * 0.12);
        halo.visible = true;
      } else halo.visible = false;
    }

    // Hover marker — eased grow + brighten toward the locked object, so it
    // never pops. Position is set on pointer move (snapped to the cursor); here
    // we only animate presence. One sprite, a couple of scalar lerps per frame.
    const hoverTarget = hoveredSat ? 1 : 0;
    hoverOn += (hoverTarget - hoverOn) * 0.25;
    if (hoverOn < 0.001) hoverOn = 0;
    hoverMat.opacity = 0.95 * hoverOn;
    hoverMarker.scale.setScalar(0.16 * hoverOn + 0.001);

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  let lastUI = 0, frames = 0, fps = 0, fpsT = performance.now();
  function uiTick() {
    frames++;
    const now = performance.now();
    if (now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; }
    if (now - lastUI > 250) {
      /** @type {HTMLElement} */ (host.querySelector('#hudClock')).textContent = simDate.toISOString().slice(11, 19);
      /** @type {HTMLElement} */ (host.querySelector('#hudFrame')).textContent = 'T+' + fmtDur(simSeconds);
      const sunPct = Math.round(litFraction * 100);
      const sunBar = /** @type {HTMLElement} */ (host.querySelector('#hudSunBar'));
      sunBar.style.width = sunPct + '%';
      sunBar.style.background = sunPct > 55 ? 'var(--ok)' : sunPct > 30 ? 'var(--warn)' : 'var(--alert)';
      /** @type {HTMLElement} */ (host.querySelector('#hudSun')).textContent = sats.length ? sunPct + '%' : '—';
      updateFocusHud();
      tlmEl.innerHTML = telemetryHtml();
      tickerEl.innerHTML = [
        `<span style="color: var(--accent);">▶ ${simDate.toISOString().slice(11, 19)} UTC</span>`,
        `<span style="color: var(--ok);">● ${sats.length.toLocaleString()} objects propagated (SGP4)</span>`,
        `<span style="color: var(--warn);">● ${Math.round(litFraction * 100)}% in sunlight</span>`,
        `<span style="color: var(--text-mute);">● ${fps} fps · ${speed}×</span>`,
      ].join('  ·  ');
      lastUI = now;
    }
    uiId = requestAnimationFrame(uiTick);
  }

  let rafId = requestAnimationFrame(tick);
  let uiId = requestAnimationFrame(uiTick);

  return {
    unmount() {
      disposed = true;
      liveTlm?.dispose();
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(uiId);
      cancelAnimationFrame(hoverRaf);
      renderer.domElement.removeEventListener('pointermove', onHoverMove);
      renderer.domElement.removeEventListener('pointerleave', onHoverLeave);
      if (cursatUnlockTimer) clearTimeout(cursatUnlockTimer);
      if (cursatLocked) window.dispatchEvent(new CustomEvent('orbitops:cursat-unlock'));
      ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('mousemove', onDragMove);
      // Free every GPU buffer in the scene graph — renderer.dispose() alone does
      // NOT walk the scene, so geometries/materials/textures would leak on each
      // repeat visit to /cockpit (this is the heaviest 3D view in the app).
      scene.traverse((/** @type {any} */ obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((/** @type {any} */ m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
    },
  };
}
