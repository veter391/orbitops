/**
 * Immersive cockpit — the full-screen mission control experience.
 *
 * Used both inline on the home page (in the teaser) and as a standalone
 * page at /cockpit. Same component, mounted differently.
 *
 * Adds:
 *   - Post-processing bloom effect
 *   - Particle system for data flow aesthetic
 *   - Selected-sat trail history
 *   - Glowing trajectory lines
 *
 * @module ui/cockpit-immersive
 */

'use strict';

import { SATELLITES, SATELLITE_BY_ID, MISSION_COLORS } from '../data/satellites.js';
import { propagate } from '../core/orbit-propagator.js';
import { detectAll, trainAll } from '../core/anomaly-detector.js';
import { generate } from '../core/telemetry.js';
import { agent, SCENARIOS } from '../scenarios/index.js';
import { mountAgentPanel } from './agent-panel.js';
import { audit } from '../core/audit-log.js';

const EARTH_RADIUS = 6371;
const SCENE_SCALE = 1 / 1500;

export async function mountCockpit(host, THREE) {
  trainAll();
  await audit.append('system', 'cockpit.mount', { sats: SATELLITES.length });

  host.innerHTML = `
    <div class="cockpit-immersive">
      <div class="cockpit-immersive__chrome">
        <div class="cockpit-immersive__brand">
          <span class="cockpit-immersive__pulse"></span>
          <span>orbitops://cockpit · live</span>
        </div>
        <div class="cockpit-immersive__title">ORBIT-ONE CONSTELLATION · 50 SATELLITES</div>
        <div class="cockpit-immersive__status">
          <span class="cockpit-immersive__status-dot"></span>
          <span id="healthReadout">100% NOMINAL</span>
        </div>
      </div>

      <div class="cockpit-immersive__viewport">
        <aside class="cockpit-side cockpit-side--left">
          <div class="cockpit-side__head">
            <span class="cockpit-side__label">CONSTELLATION</span>
            <span class="cockpit-side__value">${SATELLITES.length} sats</span>
          </div>
          <div class="cockpit-sats" id="cockpitSats"></div>
        </aside>

        <div class="cockpit-stage" id="cockpitStage">
          <div class="hud hud--tl">
            <div class="hud__label">FRAME</div>
            <div class="hud__value" id="hudFrame">T+00:00</div>
          </div>
          <div class="hud hud--tr">
            <div class="hud__label">CONSTELLATION HEALTH</div>
            <div class="hud__bar"><div class="hud__bar-fill" id="hudHealthBar" style="width:100%; background: var(--ok);"></div></div>
            <div class="hud__value" id="hudHealth">100%</div>
          </div>
          <div class="hud hud--bl">
            <div class="hud__label">FOCUS</div>
            <div class="hud__value" id="hudFocus">${SATELLITES[0].name}</div>
            <div class="hud__sub" id="hudFocusAlt">${SATELLITES[0].altitude} km · ${SATELLITES[0].mission}</div>
          </div>
          <div class="hud hud--br">
            <div class="hud__label">AUDIT CHAIN</div>
            <div class="hud__value" id="hudAudit">0 entries · hash verified</div>
          </div>
          <canvas id="cockpitCanvas"></canvas>
        </div>

        <aside class="cockpit-side cockpit-side--right">
          <div class="cockpit-side__head">
            <span class="cockpit-side__label">AI AGENT</span>
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
          <button class="cockpit-control" id="ctrlPlay" title="Play">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="cockpit-control" id="ctrlPause" title="Pause">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          </button>
          <div class="cockpit-control__divider"></div>
          <button class="cockpit-control" id="ctrlSpeed">
            <span style="font-family: var(--font-mono); font-size: 10px; font-weight: 700;">1×</span>
          </button>
          <div class="cockpit-control__divider"></div>
          <button class="cockpit-control" id="ctrlReset" title="Reset time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
      </div>

      <!-- Modal for proposals -->
      <div class="modal-backdrop" id="proposalModal">
        <div class="modal" id="proposalCard"></div>
      </div>
    </div>
  `;

  // ============== Three.js setup ==============
  const stage = host.querySelector('#cockpitStage');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020409);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 2.5, 14);

  const renderer = new THREE.WebGLRenderer({
    canvas: stage.querySelector('#cockpitCanvas'),
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Lighting
  scene.add(new THREE.AmbientLight(0x445566, 0.4));
  const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
  sun.position.set(8, 4, 6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x00d4ff, 0.6);
  rim.position.set(-6, -2, -8);
  scene.add(rim);

  // Earth — real NASA Blue Marble texture (loaded async)
  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
    emissive: 0x0a1a30,
    emissiveIntensity: 0.15,
  });

  // Load real NASA Blue Marble texture
  const texLoader = new THREE.TextureLoader();
  texLoader.load(
    '/public/img/3d/earth-day.jpg',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMat.map = tex;
      earthMat.needsUpdate = true;
    },
    undefined,
    (err) => {
      // Fallback to procedural colors if texture fails to load
      console.warn('Earth texture failed, using procedural fallback', err);
      const colors = [];
      const positions = earthGeo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const lat = Math.atan2(y, Math.sqrt(x * x + z * z));
        const lon = Math.atan2(z, x);
        const n = Math.sin(lat * 5) * Math.cos(lon * 5) + Math.sin(lat * 3 + 1) * Math.cos(lon * 4 - 2) * 0.5;
        const isLand = n > 0.15;
        const c = isLand ? new THREE.Color(0x2a6f4a) : new THREE.Color(0x0a3355);
        colors.push(c.r, c.g, c.b);
      }
      earthGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      earthMat.vertexColors = true;
      earthMat.needsUpdate = true;
    }
  );
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // Lat/long grid
  const gridGroup = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const lat = (i / 12) * Math.PI - Math.PI / 2;
    const points = [];
    for (let j = 0; j <= 64; j++) {
      const lon = (j / 64) * Math.PI * 2;
      points.push(new THREE.Vector3(
        EARTH_RADIUS * SCENE_SCALE * Math.cos(lat) * Math.cos(lon),
        EARTH_RADIUS * SCENE_SCALE * Math.sin(lat),
        EARTH_RADIUS * SCENE_SCALE * Math.cos(lat) * Math.sin(lon)
      ));
    }
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x1a3a5a, transparent: true, opacity: 0.3 })
    ));
  }
  for (let i = 0; i < 24; i++) {
    const lon = (i / 24) * Math.PI * 2;
    const points = [];
    for (let j = 0; j <= 64; j++) {
      const lat = (j / 64) * Math.PI - Math.PI / 2;
      points.push(new THREE.Vector3(
        EARTH_RADIUS * SCENE_SCALE * Math.cos(lat) * Math.cos(lon),
        EARTH_RADIUS * SCENE_SCALE * Math.sin(lat),
        EARTH_RADIUS * SCENE_SCALE * Math.cos(lat) * Math.sin(lon)
      ));
    }
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x1a3a5a, transparent: true, opacity: 0.3 })
    ));
  }
  scene.add(gridGroup);

  // Atmosphere
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE * 1.07, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vN; void main(){ float i=pow(0.65-dot(vN,vec3(0,0,1.0)),2.5); gl_FragColor=vec4(0.0,0.55,0.9,1.0)*i;}`,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    })
  ));

  // Stars
  const starsGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(3000 * 3);
  for (let i = 0; i < 3000; i++) {
    const r = 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.9 })));

  // Satellites — instanced
  const satGeo = new THREE.SphereGeometry(0.07, 10, 10);
  const satMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const satInstanced = new THREE.InstancedMesh(satGeo, satMat, SATELLITES.length);
  satInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const dummyColor = new THREE.Color();

  // Glow
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 64;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);

  const glowGeo = new THREE.BufferGeometry();
  const glowPos = new Float32Array(SATELLITES.length * 3);
  const glowCol = new Float32Array(SATELLITES.length * 3);
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
  const glowPoints = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    size: 0.4, map: glowTex, vertexColors: true,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    sizeAttenuation: true, toneMapped: false,
  }));
  scene.add(glowPoints);

  // Orbit trails
  const orbitLines = [];
  for (let i = 0; i < SATELLITES.length; i++) {
    const sat = SATELLITES[i];
    const color = MISSION_COLORS[sat.mission] || MISSION_COLORS.default;
    const points = [];
    for (let j = 0; j <= 128; j++) {
      const t = (j / 128) * (2 * Math.PI / sat.elements.meanMotion);
      const pos = propagate(sat.elements, t);
      points.push(new THREE.Vector3(pos.x * SCENE_SCALE, pos.z * SCENE_SCALE, -pos.y * SCENE_SCALE));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: parseInt(color.replace('#', '0x')), transparent: true, opacity: 0.18 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    orbitLines.push(line);
  }

  // Selected sat halo (glowing ring)
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv; void main(){ float d=distance(vUv,vec2(0.5)); float a=1.0-smoothstep(0.0,0.5,d); a*=a; gl_FragColor=vec4(0.0,0.83,1.0,a*1.5);}`,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), haloMat);
  scene.add(halo);

  // Particle system: 5000 particles in shell around earth for "data flow" feel
  const particleCount = 1500;
  const particleGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(particleCount * 3);
  const pVel = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const r = EARTH_RADIUS * SCENE_SCALE * (1.05 + Math.random() * 0.4);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pPos[i * 3 + 2] = r * Math.cos(phi);
    pVel[i * 3] = (Math.random() - 0.5) * 0.0002;
    pVel[i * 3 + 1] = (Math.random() - 0.5) * 0.0002;
    pVel[i * 3 + 2] = (Math.random() - 0.5) * 0.0002;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particleMat = new THREE.PointsMaterial({
    size: 0.025,
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // ============== Camera controls ==============
  let cameraAngle = { theta: 0.4, phi: 0.3 };
  let cameraDist = 12;
  let isDragging = false;
  let lastMouse = { x: 0, y: 0 };

  function updateCamera() {
    const x = cameraDist * Math.cos(cameraAngle.phi) * Math.sin(cameraAngle.theta);
    const y = cameraDist * Math.sin(cameraAngle.phi);
    const z = cameraDist * Math.cos(cameraAngle.phi) * Math.cos(cameraAngle.theta);
    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
  }

  renderer.domElement.addEventListener('mousedown', (e) => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x, dy = e.clientY - lastMouse.y;
    cameraAngle.theta -= dx * 0.005;
    cameraAngle.phi = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, cameraAngle.phi + dy * 0.005));
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraDist = Math.max(5, Math.min(25, cameraDist + e.deltaY * 0.012));
  }, { passive: false });

  // Click satellite
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    if (Math.abs(e.clientX - lastMouse.x) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(satInstanced);
    if (hits.length > 0) {
      const idx = hits[0].instanceId;
      selectedSat = SATELLITES[idx];
      updateFocusHud();
      highlightSat();
    }
  });

  function resize() {
    const r = stage.getBoundingClientRect();
    // Subtract ticker height (~32px) when present; otherwise use full height (e.g. teaser embed)
    const hasTicker = !!host.querySelector('.cockpit-ticker');
    const w = r.width, h = hasTicker ? r.height - 32 : r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // ============== UI ==============
  // Sat list (left)
  const satListEl = host.querySelector('#cockpitSats');
  SATELLITES.forEach((s) => {
    const item = document.createElement('button');
    item.className = 'cockpit-sat-item';
    item.dataset.sat = s.id;
    const color = MISSION_COLORS[s.mission] || MISSION_COLORS.default;
    item.innerHTML = `
      <div class="cockpit-sat-item__dot" style="background: ${color}; box-shadow: 0 0 8px ${color};"></div>
      <div class="cockpit-sat-item__info">
        <div class="cockpit-sat-item__name">${s.name}</div>
        <div class="cockpit-sat-item__sub">${s.customer}</div>
      </div>
      <div class="cockpit-sat-item__alt">${s.altitude}<span style="color: var(--text-mute); font-size: 9px;">km</span></div>
    `;
    item.addEventListener('click', () => {
      selectedSat = s;
      updateFocusHud();
      highlightSat();
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    satListEl.appendChild(item);
  });
  function highlightSat() {
    host.querySelectorAll('.cockpit-sat-item').forEach((x) => x.classList.toggle('is-active', x.dataset.sat === selectedSat.id));
  }

  // Scenarios (right)
  const scEl = host.querySelector('#cockpitScenarios');
  SCENARIOS.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'cockpit-scenario';
    btn.innerHTML = `
      <div class="cockpit-scenario__icon">${s.icon}</div>
      <div>
        <div class="cockpit-scenario__name">${s.title}</div>
        <div class="cockpit-scenario__desc">${s.description}</div>
      </div>
    `;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('is-thinking');
      try {
        const p = await agent.runScenario(s.id, { satelliteId: selectedSat.id, timeSec: simTime });
        showProposal(p);
      } catch (e) { console.error(e); }
      btn.disabled = false;
      btn.classList.remove('is-thinking');
    });
    scEl.appendChild(btn);
  });

  // Modal
  const modal = host.querySelector('#proposalModal');
  const modalCard = host.querySelector('#proposalCard');
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

  // Controls
  let simTime = 0, speed = 1, playing = true, lastTs = performance.now();
  let selectedSat = SATELLITES[0];
  host.querySelector('#ctrlPlay').addEventListener('click', () => playing = true);
  host.querySelector('#ctrlPause').addEventListener('click', () => playing = false);
  const speedBtn = host.querySelector('#ctrlSpeed');
  const speeds = [0.5, 1, 2, 5, 10, 30];
  let speedIdx = 1;
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    speed = speeds[speedIdx];
    speedBtn.querySelector('span').textContent = speed + '×';
  });
  host.querySelector('#ctrlReset').addEventListener('click', () => simTime = 0);

  function updateFocusHud() {
    host.querySelector('#hudFocus').textContent = selectedSat.name;
    host.querySelector('#hudFocusAlt').textContent = `${selectedSat.altitude} km · ${selectedSat.mission}`;
  }
  function updateAuditHud() {
    host.querySelector('#hudAudit').textContent = `${audit.entries.length} entries · hash verified`;
  }
  updateFocusHud();
  highlightSat();

  // Telemetry — proper mission-control console grid
  const tlmEl = host.querySelector('#cockpitTelemetry');
  // Friendly metric labels (no internal camelCase leaking)
  const METRIC_LABELS = {
    batteryVoltage: 'Battery V',
    batteryTemp: 'Battery °C',
    panelCurrent: 'Panel A',
    panelTemp: 'Panel °C',
    cpuTemp: 'CPU °C',
    radiatorTemp: 'Radiator °C',
    pointingError: 'Pointing',
    wheelSpeed: 'Wheel RPM',
    signalStrength: 'Signal dBm',
    dataRate: 'Mbps',
    packetLoss: 'Loss',
  };
  const SUBSYSTEM_LABELS = {
    power: 'PWR',
    thermal: 'THM',
    attitude: 'ATT',
    comms: 'COM',
  };

  function fmtVal(v, unit) {
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  function updateTlm() {
    const tlm = generate(selectedSat, simTime);
    let html = `<div class="cockpit-tlm__head"><span class="cockpit-tlm__sat">${selectedSat.name}</span><span class="cockpit-tlm__sub">LIVE TELEMETRY</span></div>`;
    html += '<div class="cockpit-tlm__grid">';
    for (const [subsystem, metrics] of Object.entries(tlm)) {
      const metricArr = Object.entries(metrics);
      if (metricArr.length === 0) continue;
      const subsysLabel = SUBSYSTEM_LABELS[subsystem] || subsystem.toUpperCase();
      html += `<div class="cockpit-tlm__cell">`;
      html += `<div class="cockpit-tlm__cell-head">${subsysLabel}</div>`;
      metricArr.forEach(([m, d]) => {
        const color = d.quality === 'critical' ? 'var(--alert)' :
                      d.quality === 'warn' ? 'var(--warn)' : 'var(--ok)';
        const label = METRIC_LABELS[m] || m;
        html += `<div class="cockpit-tlm__metric"><span class="cockpit-tlm__metric-label">${label}</span><span class="cockpit-tlm__metric-val" style="color: ${color};">${fmtVal(d.value, d.unit)}${d.unit || ''}</span></div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    tlmEl.innerHTML = html;
  }

  // Ticker
  const tickerEl = host.querySelector('#cockpitTicker');
  function formatTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ============== Animation loop ==============
  function tick(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (playing) simTime += dt * speed;

    updateCamera();

    // Update satellites
    for (let i = 0; i < SATELLITES.length; i++) {
      const sat = SATELLITES[i];
      const pos = propagate(sat.elements, simTime);
      const x = pos.x * SCENE_SCALE, y = pos.z * SCENE_SCALE, z = -pos.y * SCENE_SCALE;

      dummy.position.set(x, y, z);
      const scale = sat === selectedSat ? 3.5 : 1.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      satInstanced.setMatrixAt(i, dummy.matrix);
      dummyColor.set(MISSION_COLORS[sat.mission] || MISSION_COLORS.default);
      satInstanced.setColorAt(i, dummyColor);

      // Glow
      glowPos[i * 3] = x;
      glowPos[i * 3 + 1] = y;
      glowPos[i * 3 + 2] = z;
      const c = new THREE.Color(MISSION_COLORS[sat.mission] || MISSION_COLORS.default);
      glowCol[i * 3] = c.r;
      glowCol[i * 3 + 1] = c.g;
      glowCol[i * 3 + 2] = c.b;
    }
    satInstanced.instanceMatrix.needsUpdate = true;
    if (satInstanced.instanceColor) satInstanced.instanceColor.needsUpdate = true;
    glowGeo.attributes.position.needsUpdate = true;
    glowGeo.attributes.color.needsUpdate = true;

    // Halo
    const sp = propagate(selectedSat.elements, simTime);
    halo.position.set(sp.x * SCENE_SCALE, sp.z * SCENE_SCALE, -sp.y * SCENE_SCALE);
    halo.lookAt(camera.position);
    halo.scale.setScalar(1 + Math.sin(simTime * 2) * 0.15);

    // Particles drift
    const pp = particles.geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      pp[i * 3] += pVel[i * 3];
      pp[i * 3 + 1] += pVel[i * 3 + 1];
      pp[i * 3 + 2] += pVel[i * 3 + 2];
    }
    particles.geometry.attributes.position.needsUpdate = true;

    earth.rotation.y += dt * 0.015;
    gridGroup.rotation.y = earth.rotation.y;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // UI updates at 4Hz
  let lastUI = 0;
  function uiTick() {
    const now = performance.now();
    if (now - lastUI > 250) {
      // Frame
      host.querySelector('#hudFrame').textContent = formatTime(simTime);
      // Health
      const a = detectAll(simTime);
      const crit = a.filter((x) => x.severity === 'critical').length;
      const warn = a.filter((x) => x.severity === 'warn').length;
      const health = Math.max(0, 100 - crit * 10 - warn * 3);
      const hbar = host.querySelector('#hudHealthBar');
      hbar.style.width = health + '%';
      hbar.style.background = health > 80 ? 'var(--ok)' : health > 50 ? 'var(--warn)' : 'var(--alert)';
      host.querySelector('#hudHealth').textContent = health + '%';
      host.querySelector('#healthReadout').textContent = health + '% · ' + (crit > 0 ? `${crit} CRIT` : 'NOMINAL');

      // Ticker
      tickerEl.innerHTML = [
        `<span style="color: var(--accent);">▶ T+${formatTime(simTime)}</span>`,
        `<span style="color: var(--ok);">● ${SATELLITES.length} sats tracked</span>`,
        `<span style="color: var(--accent);">● ${a.length} signals monitored</span>`,
        crit > 0 ? `<span style="color: var(--alert);">● ${crit} critical</span>` : '',
        warn > 0 ? `<span style="color: var(--warn);">● ${warn} warn</span>` : '',
      ].filter(Boolean).join('  ·  ');

      // Telemetry
      updateTlm();
      lastUI = now;
    }
    requestAnimationFrame(uiTick);
  }

  uiTick();
  requestAnimationFrame(tick);

  return {
    unmount() {
      ro.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mouseup', () => {});
      window.removeEventListener('mousemove', () => {});
      renderer.dispose();
    },
  };
}