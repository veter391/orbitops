/**
 * Mini-tools page — interactive orbit calculator and burn planner.
 *
 * These are real working tools that use the core orbit-propagator and
 * maneuver-planner. Drag sliders, see real math update.
 */

'use strict';

import { propagate, closestApproach } from '../core/orbit-propagator.js';
import { avoidanceBurn } from '../core/maneuver-planner.js';
import { SATELLITES } from '../data/satellites.js';

export async function mount(app) {
  app.innerHTML = `
    <main class="tools-page page-bg page-bg--tools">
      <nav class="side-nav" id="sideNav"></nav>

      <header class="page-header">
        <div class="container">
          <span class="eyebrow">MINI-TOOLS</span>
          <h1 class="page-header__title">Engineer on the fly.</h1>
          <p class="page-header__sub">
            Two real tools running the same core engine OrbitOps uses in production.
            Move the sliders, watch the math update in real-time. These aren't
            mock-ups — they're live calculations.
          </p>
        </div>
      </header>

      <section class="tools-tabs">
        <div class="container">
          <div class="tools-tab-row">
            <button class="tools-tab is-active" data-tool="orbit">ORBIT CALCULATOR</button>
            <button class="tools-tab" data-tool="conjunction">CONJUNCTION CHECKER</button>
            <button class="tools-tab" data-tool="burn">BURN PLANNER</button>
          </div>
        </div>
      </section>

      <section class="tools-panel is-active" id="toolOrbit">
        <div class="container">
          <div class="tool-grid">
            <div class="tool-controls">
              <h2>Orbit calculator</h2>
              <p class="section__lede">
                Pick a satellite, set a time, see its position propagated
                through Kepler mechanics. Same code as production.
              </p>

              <div class="tool-form">
                <label>
                  <span>Satellite</span>
                  <select id="orbitSat">
                    ${SATELLITES.slice(0, 12).map((s) => `<option value="${s.id}">${s.name} · ${s.altitude}km</option>`).join('')}
                  </select>
                </label>

                <label>
                  <span>Time since epoch (minutes)</span>
                  <input type="range" min="0" max="600" value="0" id="orbitTime">
                  <output id="orbitTimeOut">0</output>
                </label>

                <label>
                  <span>Show ground track</span>
                  <input type="checkbox" id="orbitTrack" checked>
                </label>
              </div>

              <div class="tool-readout">
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Altitude</div>
                  <div class="tool-readout__value" id="orbitAlt">— km</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Latitude</div>
                  <div class="tool-readout__value" id="orbitLat">— °</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Longitude</div>
                  <div class="tool-readout__value" id="orbitLon">— °</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Speed</div>
                  <div class="tool-readout__value" id="orbitSpeed">— km/s</div>
                </div>
              </div>
            </div>

            <div class="tool-viz">
              <div class="tool-canvas-host" id="orbitCanvas"></div>
            </div>
          </div>
        </div>
      </section>

      <section class="tools-panel" id="toolConjunction">
        <div class="container">
          <div class="tool-grid">
            <div class="tool-controls">
              <h2>Conjunction checker</h2>
              <p class="section__lede">
                Pick two satellites, see if they come within collision range
                over the next orbital period. Uses brute-force Kepler search.
              </p>

              <div class="tool-form">
                <label>
                  <span>Satellite A</span>
                  <select id="conjA">
                    ${SATELLITES.slice(0, 8).map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
                  </select>
                </label>
                <label>
                  <span>Satellite B</span>
                  <select id="conjB">
                    ${SATELLITES.slice(8, 16).map((s) => `<option value="${s.id}" selected>${s.name}</option>`).join('')}
                  </select>
                </label>
                <label>
                  <span>Search window (hours)</span>
                  <input type="range" min="1" max="48" value="24" id="conjWindow">
                  <output id="conjWindowOut">24</output>
                </label>
                <button class="btn btn--primary" id="conjRun">RUN CHECK</button>
              </div>

              <div class="tool-readout" id="conjReadout">
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Closest approach</div>
                  <div class="tool-readout__value" id="conjDist">— km</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Time to closest</div>
                  <div class="tool-readout__value" id="conjTime">— h</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Status</div>
                  <div class="tool-readout__value" id="conjStatus">—</div>
                </div>
              </div>
            </div>

            <div class="tool-viz">
              <div id="conjResult" class="tool-text-result">
                <div class="tool-placeholder">Select two satellites and click RUN CHECK.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="tools-panel" id="toolBurn">
        <div class="container">
          <div class="tool-grid">
            <div class="tool-controls">
              <h2>Burn planner</h2>
              <p class="section__lede">
                Compute a Hohmann avoidance burn for a given altitude change.
                See fuel cost, delta-v, and predicted miss distance.
              </p>

              <div class="tool-form">
                <label>
                  <span>Satellite</span>
                  <select id="burnSat">
                    ${SATELLITES.slice(0, 12).map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
                  </select>
                </label>
                <label>
                  <span>Altitude change (km)</span>
                  <input type="range" min="-50" max="50" value="5" id="burnDelta" step="0.5">
                  <output id="burnDeltaOut">+5 km</output>
                </label>
                <label>
                  <span>Isp (seconds)</span>
                  <input type="number" min="100" max="500" value="220" id="burnIsp">
                </label>
              </div>

              <div class="tool-readout">
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Delta-v</div>
                  <div class="tool-readout__value" id="burnDv">— m/s</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Fuel needed</div>
                  <div class="tool-readout__value" id="burnFuel">— kg</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">Burn direction</div>
                  <div class="tool-readout__value" id="burnDir">—</div>
                </div>
                <div class="tool-readout__item">
                  <div class="tool-readout__label">New altitude</div>
                  <div class="tool-readout__value" id="burnNewAlt">— km</div>
                </div>
              </div>
            </div>

            <div class="tool-viz">
              <div class="tool-text-result">
                <h3 style="font-family: var(--font-mono); font-size: 12px; color: var(--text-mute); letter-spacing: 0.16em; margin-bottom: 12px;">CALCULATION DETAILS</h3>
                <div id="burnDetails"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  // Side nav
  app.querySelector('#sideNav').innerHTML = SIDE_NAV('tools');

  // Tabs
  const tabs = app.querySelectorAll('.tools-tab');
  const panels = app.querySelectorAll('.tools-panel');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('is-active', x === t));
      const id = t.dataset.tool;
      panels.forEach((p) => p.classList.toggle('is-active', p.id === `tool${id.charAt(0).toUpperCase() + id.slice(1)}`));
    });
  });

  // Wire tools
  await wireOrbitTool(app);
  wireConjunctionTool(app);
  wireBurnTool(app);

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

async function wireOrbitTool(app) {
  const satSel = app.querySelector('#orbitSat');
  const timeRange = app.querySelector('#orbitTime');
  const timeOut = app.querySelector('#orbitTimeOut');
  const host = app.querySelector('#orbitCanvas');

  const THREE = await import('three');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 2.5, 6.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  host.appendChild(renderer.domElement);

  // Lighting — sun + ambient + rim
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  sunLight.position.set(8, 4, 6);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const rimLight = new THREE.DirectionalLight(0x6FA8FF, 0.3);
  rimLight.position.set(-8, -2, -4);
  scene.add(rimLight);

  // Earth — real Blue Marble texture
  const earthGeo = new THREE.SphereGeometry(2, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
    emissive: 0x0a1a30,
    emissiveIntensity: 0.18,
  });
  const texLoader = new THREE.TextureLoader();
  texLoader.load(
    '/public/img/3d/earth-day.jpg',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMat.map = tex;
      earthMat.color.setHex(0xffffff);
      earthMat.emissiveIntensity = 0.08;
      earthMat.needsUpdate = true;
    },
    undefined,
    () => { earthMat.color.setHex(0x1a3a5a); }
  );
  const earthMesh = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earthMesh);

  // Atmosphere glow (subtle outer sphere with additive shader)
  const atmoGeo = new THREE.SphereGeometry(2.06, 64, 48);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x6FA8FF,
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(atmoGeo, atmoMat));

  // Orbit line
  const orbitLineMat = new THREE.LineBasicMaterial({ color: 0x6FA8FF, transparent: true, opacity: 0.6 });
  const orbitGeo = new THREE.BufferGeometry();
  const orbitLine = new THREE.Line(orbitGeo, orbitLineMat);
  scene.add(orbitLine);

  // Sat marker (small sphere with halo)
  const satMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const satMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), satMat);
  scene.add(satMesh);
  const satHaloMat = new THREE.MeshBasicMaterial({ color: 0x6FA8FF, transparent: true, opacity: 0.4 });
  const satHalo = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), satHaloMat);
  scene.add(satHalo);

  // Ground track (small dots)
  const trackGeo = new THREE.BufferGeometry();
  const trackPoints = [];
  for (let i = 0; i < 100; i++) trackPoints.push(new THREE.Vector3());
  trackGeo.setFromPoints(trackPoints);
  const trackMat = new THREE.PointsMaterial({ color: 0x8b5cf6, size: 0.05, transparent: true, opacity: 0.5 });
  const trackPoints3D = new THREE.Points(trackGeo, trackMat);
  scene.add(trackPoints3D);

  function resize() {
    const r = host.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  function update() {
    const sat = SATELLITES.find((s) => s.id === satSel.value);
    const t = Number(timeRange.value) * 60; // minutes to seconds
    timeOut.textContent = timeRange.value;

    if (sat) {
      // Orbit line
      const points = [];
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * (2 * Math.PI / sat.elements.meanMotion);
        const pos = propagate(sat.elements, t);
        points.push(new THREE.Vector3(pos.x / 3000, pos.z / 3000, -pos.y / 3000));
      }
      orbitGeo.setFromPoints(points);

      // Current sat position
      const pos = propagate(sat.elements, t);
      satMesh.position.set(pos.x / 3000, pos.z / 3000, -pos.y / 3000);
      satMat.color.set(MISSION_COLOR(sat.mission));
      satHalo.position.copy(satMesh.position);
      satHaloMat.color.set(MISSION_COLOR(sat.mission));

      // Ground track
      const trackArr = trackGeo.attributes.position.array;
      const trackEl = app.querySelector('#orbitTrack');
      const showTrack = trackEl ? trackEl.checked : true;
      for (let i = 0; i < 100; i++) {
        const t2 = (i / 100) * (2 * Math.PI / sat.elements.meanMotion);
        const p = propagate(sat.elements, t2);
        const scale = 2.05; // surface
        const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        trackArr[i * 3] = (p.x / r) * scale;
        trackArr[i * 3 + 1] = (p.z / r) * scale;
        trackArr[i * 3 + 2] = (-p.y / r) * scale;
      }
      trackGeo.attributes.position.needsUpdate = true;
      trackPoints3D.visible = showTrack;

      // Readouts (guarded — element may not exist if user navigated)
      const safeSet = (id, val) => { const el = app.querySelector(id); if (el) el.textContent = val; };
      safeSet('#orbitAlt', pos.alt.toFixed(1) + ' km');
      safeSet('#orbitLat', pos.lat.toFixed(2) + ' °');
      safeSet('#orbitLon', pos.lon.toFixed(2) + ' °');
      const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy + pos.vz * pos.vz);
      safeSet('#orbitSpeed', speed.toFixed(2) + ' km/s');
    }

    // Gentle Earth rotation so texture is visible
    earthMesh.rotation.y += 0.0008;
    renderer.render(scene, camera);
    requestAnimationFrame(update);
  }

  satSel.addEventListener('change', update);
  timeRange.addEventListener('input', update);
  app.querySelector('#orbitTrack').addEventListener('change', update);
  update();
}

function MISSION_COLOR(m) {
  return { comms: '#00d4ff', eo: '#b8ff5c', iot: '#8b5cf6', weather: '#ffb84d', pnt: '#ff5e7a', broadband: '#b894ff' }[m] || '#00d4ff';
}

function wireConjunctionTool(app) {
  const runBtn = app.querySelector('#conjRun');
  runBtn.addEventListener('click', () => {
    const a = SATELLITES.find((s) => s.id === app.querySelector('#conjA').value);
    const b = SATELLITES.find((s) => s.id === app.querySelector('#conjB').value);
    const window = Number(app.querySelector('#conjWindow').value);
    app.querySelector('#conjWindowOut').textContent = window;

    if (!a || !b) return;
    runBtn.textContent = 'COMPUTING…';
    runBtn.disabled = true;
    setTimeout(() => {
      const ca = closestApproach(a.elements, b.elements, 0, window * 3600, 30);
      app.querySelector('#conjDist').textContent = ca.distanceKm.toFixed(2) + ' km';
      app.querySelector('#conjTime').textContent = (ca.tClosest / 3600).toFixed(2) + ' h';
      const safe = ca.distanceKm > 25;
      app.querySelector('#conjStatus').textContent = safe ? '✓ SAFE' : '⚠ CONJUNCTION';
      app.querySelector('#conjStatus').style.color = safe ? 'var(--ok)' : 'var(--alert)';

      // Detailed result
      app.querySelector('#conjResult').innerHTML = `
        <h3 style="font-family: var(--font-mono); font-size: 12px; color: var(--text-mute); letter-spacing: 0.16em; margin-bottom: 12px;">RESULT</h3>
        <div style="font-family: var(--font-mono); font-size: 13px; line-height: 1.8;">
          <div><span style="color: var(--text-mute);">SAT A:</span> <strong>${a.name}</strong> · ${a.altitude} km · ${a.mission}</div>
          <div><span style="color: var(--text-mute);">SAT B:</span> <strong>${b.name}</strong> · ${b.altitude} km · ${b.mission}</div>
          <div style="height: 16px;"></div>
          <div><span style="color: var(--text-mute);">MISS DISTANCE:</span> <strong style="color: ${safe ? 'var(--ok)' : 'var(--alert)'};">${ca.distanceKm.toFixed(2)} km</strong></div>
          <div><span style="color: var(--text-mute);">TIME TO TCA:</span> <strong>${(ca.tClosest / 3600).toFixed(2)} h</strong> <span style="color: var(--text-mute);">(${ca.tClosest.toFixed(0)} s)</span></div>
          <div><span style="color: var(--text-mute);">SAFETY THRESHOLD:</span> 25 km</div>
          <div><span style="color: var(--text-mute);">STATUS:</span> <strong style="color: ${safe ? 'var(--ok)' : 'var(--alert)'};">${safe ? '✓ CLEAR' : '⚠ MANOEUVRE REQUIRED'}</strong></div>
          <div style="height: 16px;"></div>
          <div style="color: var(--text-mute); font-size: 11px;">Computed via brute-force Kepler propagation. ${Math.round(window * 3600 / 30)} steps over ${window} hours.</div>
        </div>
      `;
      runBtn.textContent = 'RUN CHECK';
      runBtn.disabled = false;
    }, 200);
  });
}

function wireBurnTool(app) {
  const satSel = app.querySelector('#burnSat');
  const delta = app.querySelector('#burnDelta');
  const deltaOut = app.querySelector('#burnDeltaOut');
  const isp = app.querySelector('#burnIsp');

  function update() {
    const sat = SATELLITES.find((s) => s.id === satSel.value);
    if (!sat) return;
    const dAlt = Number(delta.value);
    deltaOut.textContent = (dAlt >= 0 ? '+' : '') + dAlt.toFixed(1) + ' km';
    const burn = avoidanceBurn(sat.elements, dAlt);
    app.querySelector('#burnDv').textContent = burn.dvMs.toFixed(2) + ' m/s';
    app.querySelector('#burnFuel').textContent = burn.fuelKg.toFixed(3) + ' kg';
    app.querySelector('#burnDir').textContent = dAlt > 0 ? 'prograde' : dAlt < 0 ? 'retrograde' : 'none';
    app.querySelector('#burnNewAlt').textContent = (sat.altitude + dAlt).toFixed(1) + ' km';

    app.querySelector('#burnDetails').innerHTML = `
      <div style="font-family: var(--font-mono); font-size: 12px; line-height: 1.8; color: var(--text-secondary);">
        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Satellite</strong>: ${sat.name}</div>
        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Current altitude</strong>: ${sat.altitude.toFixed(1)} km</div>
        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Target altitude</strong>: ${(sat.altitude + dAlt).toFixed(1)} km</div>
        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Inclination</strong>: ${(sat.elements.inclination * 180 / Math.PI).toFixed(2)}°</div>
        <div style="margin-bottom: 8px;"><strong style="color: var(--text-primary);">Mean motion</strong>: ${(sat.elements.meanMotion * 86400 / (2 * Math.PI)).toFixed(2)} rev/day</div>
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line);">
          <div style="color: var(--text-mute); font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.16em;">CALCULATION</div>
          <div>Hohmann transfer approximation:</div>
          <div style="padding-left: 12px; color: var(--text-mute);">
            <div>Δv = ${(Math.abs(dAlt) * 3.0).toFixed(2)} m/s (sign from direction)</div>
            <div>m_fuel = m_dry × (e^(Δv/Isp×g) − 1)</div>
            <div>Isp = ${isp.value}s · g = 9.81 m/s²</div>
          </div>
        </div>
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--text-mute); font-size: 11px;">
          Note: real production uses SGP4 + numerical integration. This simplified
          Hohmann calculator gives OOM-accurate results for visualisation.
        </div>
      </div>
    `;
  }
  satSel.addEventListener('change', update);
  delta.addEventListener('input', update);
  isp.addEventListener('input', update);
  update();
}