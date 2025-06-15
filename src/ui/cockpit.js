/**
 * Cockpit — the operator console.
 *
 * Layout (CSS grid):
 *   ┌─────────┬─────────────────────┬──────────────┐
 *   │ LEFT    │     3D STAGE         │   RIGHT      │
 *   │ sats    │     (Three.js)      │   scenarios  │
 *   ├─────────┴─────────────────────┴──────────────┤
 *   │ TICKER (alerts log)                          │
 *   └─────────────────────────────────────────────┘
 *
 * @module ui/cockpit
 */

'use strict';

import { SATELLITES, SATELLITE_BY_ID, MISSION_COLORS } from '../data/satellites.js';
import { propagate } from '../core/orbit-propagator.js';
import { detectAll, trainAll } from '../core/anomaly-detector.js';
import { generate } from '../core/telemetry.js';
import { agent, SCENARIOS } from '../scenarios/index.js';
import { mountAgentPanel } from './agent-panel.js';
import { audit } from '../core/audit-log.js';
import { formatNumber, formatDuration, sleep } from '../utils.js';

const EARTH_RADIUS = 6371;
const SCENE_SCALE = 1 / 1500;

export async function mountCockpit(host, THREE) {
  // Train anomaly detector baseline once
  trainAll();

  // Record in audit log
  await audit.append('system', 'cockpit.mounted', {
    satellites: SATELLITES.length,
    timestamp: new Date().toISOString(),
  });

  host.innerHTML = `
    <div class="demo">
      <div class="demo__chrome">
        <div class="demo__dots">
          <div class="demo__dot"></div>
          <div class="demo__dot"></div>
          <div class="demo__dot"></div>
        </div>
        <div class="demo__title">orbitops://cockpit · orbit-one · live</div>
        <div class="demo__live"><span class="demo__live-dot"></span>LIVE · ALL SYSTEMS</div>
      </div>

      <div class="demo__viewport">
        <aside class="demo__panel">
          <div class="demo__panel-section">
            <h3>Constellation · 50 sats</h3>
            <div class="sat-list" id="satList"></div>
          </div>
          <div class="demo__panel-section">
            <h3>Live Telemetry · <span id="selectedSatName" style="color: var(--signal-cyan);">${SATELLITES[0].name}</span></h3>
            <div id="telemetryPanel" class="telemetry"></div>
          </div>
        </aside>

        <div class="demo__stage" id="stage">
          <div class="stage-overlay stage-overlay--top-left">
            <div class="stage-overlay__label">FRAME</div>
            <div class="stage-overlay__value" id="stageFrame">T+00:00</div>
          </div>
          <div class="stage-overlay stage-overlay--top-right">
            <div class="stage-overlay__label">CONSTELLATION HEALTH</div>
            <div class="stage-overlay__bar">
              <div class="stage-overlay__bar-fill" id="healthBar" style="width: 100%; background: var(--signal-lime);"></div>
            </div>
            <div class="stage-overlay__value" id="healthValue">100%</div>
          </div>
          <div class="stage-overlay stage-overlay--bottom-left">
            <div class="stage-overlay__label">3D MODE</div>
            <div class="stage-overlay__value">DRAG · SCROLL · CLICK SAT</div>
          </div>
          <div class="stage-overlay stage-overlay--bottom-right">
            <div class="stage-overlay__label">AUDIT CHAIN</div>
            <div class="stage-overlay__value" id="auditChainLen">0 entries · hash verified</div>
          </div>
        </div>

        <aside class="demo__panel">
          <div class="demo__panel-section">
            <h3>AI Agent · 5 scenarios</h3>
            <div class="scenario-list" id="scenarioList"></div>
          </div>
          <div class="demo__panel-section">
            <h3>Recent Proposals</h3>
            <div id="proposalList" class="proposal-list"></div>
          </div>
          <div class="demo__panel-section">
            <h3>Live Audit Trail <span style="color: var(--signal-cyan);">●</span></h3>
            <div id="auditFeed" class="audit-feed"></div>
          </div>
        </aside>

        <div class="demo__ticker">
          <span style="color: var(--signal-cyan);">›</span>
          <div class="ticker-entries" id="tickerEntries"></div>
        </div>
      </div>

      <div class="demo-controls">
        <button class="demo-controls__btn" id="playBtn" title="Play">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="demo-controls__btn" id="pauseBtn" title="Pause">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
        </button>
        <div class="demo-controls__divider"></div>
        <button class="demo-controls__btn" id="speedBtn" title="Speed">
          <span style="font-family: var(--font-mono); font-size: 10px; font-weight: 700;">1×</span>
        </button>
        <div class="demo-controls__divider"></div>
        <button class="demo-controls__btn" id="resetBtn" title="Reset time">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
        <div class="demo-controls__divider"></div>
        <button class="demo-controls__btn" id="viewBtn" title="Toggle 2D/3D">
          <span style="font-family: var(--font-mono); font-size: 10px; font-weight: 700;">3D</span>
        </button>
      </div>
    </div>

    <div class="modal-backdrop" id="proposalModal">
      <div class="modal" id="proposalModalCard"></div>
    </div>
  `;

  // ================== Three.js ==================
  const stage = host.querySelector('#stage');
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 3, 9);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  // Lighting — moody & cinematic
  scene.add(new THREE.AmbientLight(0x445566, 0.5));
  const sun = new THREE.DirectionalLight(0xffeedd, 1.3);
  sun.position.set(8, 4, 6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x00d4ff, 0.4);
  rim.position.set(-6, -2, -8);
  scene.add(rim);
  const accent = new THREE.PointLight(0x8b5cf6, 1.0, 50);
  accent.position.set(0, 8, 4);
  scene.add(accent);

  // Earth with continents + city lights
  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({
    color: 0x0a3355,
    emissive: 0x061525,
    roughness: 0.7,
    metalness: 0.15,
  });
  const colors = [];
  const positions = earthGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const lat = Math.atan2(y, Math.sqrt(x * x + z * z));
    const lon = Math.atan2(z, x);
    const n =
      Math.sin(lat * 5) * Math.cos(lon * 5) +
      Math.sin(lat * 3 + 1) * Math.cos(lon * 4 - 2) * 0.5 +
      Math.sin(lat * 11 + lon * 7) * 0.3;
    const isLand = n > 0.15;
    let c = isLand ? new THREE.Color(0x1a4f3a) : new THREE.Color(0x0a3355);
    // city lights at scattered points on land
    if (isLand && Math.sin(lat * 17 + lon * 13) > 0.85) {
      c.setHex(0xffaa44).multiplyScalar(0.6);
    } else if (isLand && Math.sin(lat * 23 + lon * 19) > 0.92) {
      c.setHex(0xff8833).multiplyScalar(0.4);
    }
    colors.push(c.r, c.g, c.b);
  }
  earthGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  earthMat.vertexColors = true;
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // Subtle latitude/longitude grid
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
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x1a3a5a, transparent: true, opacity: 0.25 });
    gridGroup.add(new THREE.Line(geo, mat));
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
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x1a3a5a, transparent: true, opacity: 0.25 });
    gridGroup.add(new THREE.Line(geo, mat));
  }
  scene.add(gridGroup);

  // Atmosphere glow
  const atmosphereMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
        gl_FragColor = vec4(0.0, 0.55, 0.9, 1.0) * intensity;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * SCENE_SCALE * 1.06, 64, 48),
    atmosphereMat
  );
  scene.add(atmosphere);

  // Stars
  const starsGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(2000 * 3);
  const starSizes = new Float32Array(2000);
  for (let i = 0; i < 2000; i++) {
    const r = 100;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
    starSizes[i] = 0.05 + Math.random() * 0.2;
  }
  starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starsGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
  const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 });
  scene.add(new THREE.Points(starsGeo, starsMat));

  // Satellites — InstancedMesh for performance
  const satGeo = new THREE.SphereGeometry(0.06, 10, 10);
  const satMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const satInstanced = new THREE.InstancedMesh(satGeo, satMat, SATELLITES.length);
  satInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const dummyColor = new THREE.Color();

  // Glow sprite texture (procedural radial gradient)
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 64;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);

  // Glow billboards — one per sat, larger, additive blending
  // Use Points + custom shader for efficient instanced glowing points
  const glowGeometry = new THREE.BufferGeometry();
  const glowPositions = new Float32Array(SATELLITES.length * 3);
  const glowColors = new Float32Array(SATELLITES.length * 3);
  for (let i = 0; i < SATELLITES.length; i++) {
    glowColors[i * 3] = 1;
    glowColors[i * 3 + 1] = 1;
    glowColors[i * 3 + 2] = 1;
  }
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));

  const glowMaterial = new THREE.PointsMaterial({
    size: 0.35,
    map: glowTexture,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
  scene.add(glowPoints);

  // Sat halo for selected — larger glowing ring
  const haloGeo = new THREE.RingGeometry(0.12, 0.18, 32);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  scene.add(halo);

  // Orbit trails
  const orbitLines = [];
  for (let i = 0; i < SATELLITES.length; i++) {
    const sat = SATELLITES[i];
    const color = MISSION_COLORS[sat.mission] || MISSION_COLORS.default;
    const points = [];
    for (let j = 0; j <= 96; j++) {
      const t = (j / 96) * (2 * Math.PI / sat.elements.meanMotion);
      const pos = propagate(sat.elements, t);
      points.push(new THREE.Vector3(
        pos.x * SCENE_SCALE,
        pos.z * SCENE_SCALE,
        -pos.y * SCENE_SCALE
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: parseInt(color.replace('#', '0x')),
      transparent: true,
      opacity: 0.15,
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    orbitLines.push(line);
  }

  // Mission-coloured Earth coverage arcs (selected sat's footprint)
  const footprintGeo = new THREE.BufferGeometry();
  const footprintMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.4 });
  const footprint = new THREE.LineLoop(footprintGeo, footprintMat);
  footprint.visible = false;
  scene.add(footprint);

  // ================== State ==================
  let simTime = 0;
  let speed = 1;
  let playing = true;
  let lastTs = performance.now();
  let selectedSat = SATELLITES[0];
  let cameraMode = 'free'; // 'free' or 'focus'

  // Orbit controls (manual — small footprint, no extra deps)
  let isDragging = false;
  let lastMouse = { x: 0, y: 0 };
  let cameraAngle = { theta: 0.3, phi: 0.25 };
  let cameraDist = 9;

  function updateCamera() {
    const x = cameraDist * Math.cos(cameraAngle.phi) * Math.sin(cameraAngle.theta);
    const y = cameraDist * Math.sin(cameraAngle.phi);
    const z = cameraDist * Math.cos(cameraAngle.phi) * Math.cos(cameraAngle.theta);
    if (cameraMode === 'free') {
      camera.position.set(x, y, z);
    } else {
      // focus on selected sat
      const pos = propagate(selectedSat.elements, simTime);
      camera.position.set(
        pos.x * SCENE_SCALE * 4 + x * 0.3,
        pos.z * SCENE_SCALE * 4 + y * 0.3,
        -pos.y * SCENE_SCALE * 4 + z * 0.3
      );
    }
    camera.lookAt(0, 0, 0);
  }

  stage.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    cameraAngle.theta -= dx * 0.005;
    cameraAngle.phi = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, cameraAngle.phi + dy * 0.005));
    lastMouse = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    cameraDist = Math.max(5, Math.min(30, cameraDist + e.deltaY * 0.01));
  }, { passive: false });

  // Click on stage to focus a sat (raycast)
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  stage.addEventListener('click', (e) => {
    if (Math.abs(e.clientX - lastMouse.x) > 5) return; // it was a drag
    const r = stage.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(satInstanced);
    if (hits.length > 0) {
      const idx = hits[0].instanceId;
      selectedSat = SATELLITES[idx];
      host.querySelectorAll('.sat-item').forEach((x) => x.classList.toggle('is-active', x.dataset.sat === selectedSat.id));
      const nameEl = host.querySelector('#selectedSatName');
      if (nameEl) nameEl.textContent = selectedSat.name;
      // scroll sat list to selected
      const el = host.querySelector(`.sat-item[data-sat="${selectedSat.id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  // ================== UI ==================
  // Sat list
  const satListEl = host.querySelector('#satList');
  SATELLITES.forEach((s) => {
    const item = document.createElement('button');
    item.className = 'sat-item';
    item.dataset.sat = s.id;
    const color = MISSION_COLORS[s.mission] || MISSION_COLORS.default;
    item.innerHTML = `
      <div class="sat-item__dot" style="background: ${color}; box-shadow: 0 0 6px ${color};"></div>
      <div class="sat-item__info">
        <div class="sat-item__name">${s.name}</div>
        <div class="sat-item__status">${s.customer} · ${s.mission.toUpperCase()}</div>
      </div>
      <div class="sat-item__meta">${s.altitude}<span style="color: var(--text-mute);">km</span></div>
    `;
    item.addEventListener('click', () => {
      selectedSat = s;
      host.querySelectorAll('.sat-item').forEach((x) => x.classList.toggle('is-active', x.dataset.sat === s.id));
      const nameEl = host.querySelector('#selectedSatName');
      if (nameEl) nameEl.textContent = s.name;
    });
    satListEl.appendChild(item);
  });
  satListEl.querySelector('.sat-item').classList.add('is-active');

  // Scenario list
  const scenarioListEl = host.querySelector('#scenarioList');
  SCENARIOS.forEach((s) => {
    const btn = document.createElement('button');
    btn.className = 'scenario-btn';
    btn.innerHTML = `
      <div class="scenario-btn__head">
        <span class="scenario-btn__icon">${s.icon}</span>
        <div>
          <div class="scenario-btn__name">${s.title}</div>
          <div class="scenario-btn__desc">${s.description}</div>
        </div>
      </div>
    `;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = '<div class="scenario-btn__head"><span class="scenario-btn__icon">⏳</span><div><div class="scenario-btn__name">Reasoning…</div><div class="scenario-btn__desc">Analysing telemetry, scoring options</div></div></div>';
      try {
        const proposal = await agent.runScenario(s.id, { satelliteId: selectedSat.id, timeSec: simTime });
        showProposalModal(proposal);
      } catch (e) {
        console.error(e);
      }
      btn.disabled = false;
      btn.innerHTML = orig;
    });
    scenarioListEl.appendChild(btn);
  });

  // Controls
  host.querySelector('#playBtn').addEventListener('click', () => { playing = true; });
  host.querySelector('#pauseBtn').addEventListener('click', () => { playing = false; });
  const speedBtn = host.querySelector('#speedBtn');
  const speeds = [0.5, 1, 2, 5, 10];
  let speedIdx = 1;
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    speed = speeds[speedIdx];
    speedBtn.querySelector('span').textContent = speed + '×';
  });
  host.querySelector('#resetBtn').addEventListener('click', () => { simTime = 0; });
  const viewBtn = host.querySelector('#viewBtn');
  viewBtn.addEventListener('click', () => {
    cameraMode = cameraMode === 'free' ? 'focus' : 'free';
    viewBtn.querySelector('span').textContent = cameraMode === 'free' ? '3D' : 'FOCUS';
  });

  // Modal
  const modal = host.querySelector('#proposalModal');
  const modalCard = host.querySelector('#proposalModalCard');
  const proposalList = host.querySelector('#proposalList');

  function showProposalModal(proposal) {
    mountAgentPanel(modalCard, proposal, {
      onApprove: async () => {
        await agent.approve(proposal.id, 'demo-operator');
        modal.classList.remove('is-show');
        refreshProposalList();
        refreshAuditFeed();
      },
      onReject: async (reason) => {
        await agent.reject(proposal.id, 'demo-operator', reason);
        modal.classList.remove('is-show');
        refreshProposalList();
        refreshAuditFeed();
      },
      onModify: async (mods) => {
        await agent.modifyAndApprove(proposal.id, 'demo-operator', mods);
        modal.classList.remove('is-show');
        refreshProposalList();
        refreshAuditFeed();
      },
      onClose: () => modal.classList.remove('is-show'),
    });
    modal.classList.add('is-show');
    refreshAuditFeed();
  }

  function refreshProposalList() {
    const recent = agent.recentProposals(5);
    proposalList.innerHTML = '';
    if (recent.length === 0) {
      proposalList.innerHTML = '<div class="proposal-empty">No proposals yet. Click an AI scenario above.</div>';
      return;
    }
    recent.forEach((p) => {
      const div = document.createElement('button');
      div.className = `proposal-row proposal-row--${p.status}`;
      const statusColor =
        p.status === 'approved' ? 'var(--signal-lime)' :
        p.status === 'rejected' ? 'var(--signal-rose)' :
        p.status === 'modified' ? 'var(--signal-amber)' : 'var(--signal-cyan)';
      div.innerHTML = `
        <div class="proposal-row__title">${p.title}</div>
        <div class="proposal-row__meta">
          <span style="color: ${statusColor};">${p.status.toUpperCase()}</span>
          <span style="color: var(--text-mute);">·</span>
          <span style="color: ${statusColor};">${(p.confidence * 100).toFixed(0)}% conf</span>
        </div>
      `;
      div.addEventListener('click', () => showProposalModal(p));
      proposalList.appendChild(div);
    });
  }
  refreshProposalList();

  // Audit feed
  const auditFeedEl = host.querySelector('#auditFeed');
  const auditChainLenEl = host.querySelector('#auditChainLen');
  function refreshAuditFeed() {
    const entries = audit.all().slice(-8).reverse();
    auditFeedEl.innerHTML = entries.map((e) => `
      <div class="audit-entry">
        <div class="audit-entry__seq">#${String(e.seq).padStart(3, '0')}</div>
        <div class="audit-entry__body">
          <div class="audit-entry__actor">${e.actor}</div>
          <div class="audit-entry__action">${e.action}</div>
          <div class="audit-entry__hash">${e.hash.slice(0, 16)}…</div>
        </div>
      </div>
    `).join('');
    auditChainLenEl.textContent = `${audit.entries.length} entries · hash verified`;
  }
  refreshAuditFeed();

  // Ticker
  const tickerEl = host.querySelector('#tickerEntries');
  const stageFrameEl = host.querySelector('#stageFrame');
  const healthBarEl = host.querySelector('#healthBar');
  const healthValueEl = host.querySelector('#healthValue');

  function formatSimTime(s) {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `T+${String(min).padStart(3, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function updateTicker() {
    stageFrameEl.textContent = formatSimTime(simTime);
    const anomalies = detectAll(simTime);
    const crit = anomalies.filter((a) => a.severity === 'critical').length;
    const warn = anomalies.filter((a) => a.severity === 'warn').length;
    const health = Math.max(0, 100 - crit * 10 - warn * 3);
    healthBarEl.style.width = health + '%';
    healthBarEl.style.background = health > 80 ? 'var(--signal-lime)' : health > 50 ? 'var(--signal-amber)' : 'var(--signal-rose)';
    healthValueEl.textContent = `${health}%`;

    const items = [];
    items.push(`<span style="color: var(--signal-cyan);">▶ ${formatSimTime(simTime)}</span>`);
    items.push(`<span style="color: var(--signal-lime);">● ${SATELLITES.length} sats tracked</span>`);
    items.push(`<span style="color: var(--signal-cyan);">● ${anomalies.length} signals monitored</span>`);
    if (crit > 0) items.push(`<span style="color: var(--signal-rose);">● ${crit} critical</span>`);
    if (warn > 0) items.push(`<span style="color: var(--signal-amber);">● ${warn} warn</span>`);
    tickerEl.innerHTML = items.join(' ');
  }

  // Telemetry panel
  const tlmPanel = host.querySelector('#telemetryPanel');
  function updateTelemetryPanel() {
    const tlm = generate(selectedSat, simTime);
    const items = [];
    for (const [subsystem, metrics] of Object.entries(tlm)) {
      items.push(`<div class="telemetry__group"><div class="telemetry__head">${subsystem}</div>`);
      for (const [metric, data] of Object.entries(metrics)) {
        const color = data.quality === 'critical' ? 'var(--signal-rose)' :
                      data.quality === 'warn' ? 'var(--signal-amber)' : 'var(--signal-lime)';
        items.push(`<div class="telemetry__row"><span class="telemetry__key">${metric}</span><span class="telemetry__val" style="color: ${color};">${data.value.toFixed(2)}${data.unit ? ' ' + data.unit : ''}</span></div>`);
      }
      items.push('</div>');
    }
    tlmPanel.innerHTML = items.join('');
  }

  // ================== Animation loop ==================
  function tick(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (playing) simTime += dt * speed;

    updateCamera();

    for (let i = 0; i < SATELLITES.length; i++) {
      const sat = SATELLITES[i];
      const pos = propagate(sat.elements, simTime);
      const x = pos.x * SCENE_SCALE;
      const y = pos.z * SCENE_SCALE;
      const z = -pos.y * SCENE_SCALE;

      dummy.position.set(x, y, z);
      const scale = sat === selectedSat ? 3.5 : 1.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      satInstanced.setMatrixAt(i, dummy.matrix);
      dummyColor.set(MISSION_COLORS[sat.mission] || MISSION_COLORS.default);
      satInstanced.setColorAt(i, dummyColor);

      // Update glow points
      glowPositions[i * 3] = x;
      glowPositions[i * 3 + 1] = y;
      glowPositions[i * 3 + 2] = z;
      const c = new THREE.Color(MISSION_COLORS[sat.mission] || MISSION_COLORS.default);
      glowColors[i * 3] = c.r;
      glowColors[i * 3 + 1] = c.g;
      glowColors[i * 3 + 2] = c.b;
    }
    glowGeometry.attributes.position.needsUpdate = true;
    glowGeometry.attributes.color.needsUpdate = true;
    satInstanced.instanceMatrix.needsUpdate = true;
    if (satInstanced.instanceColor) satInstanced.instanceColor.needsUpdate = true;

    // Selected sat halo
    const selPos = propagate(selectedSat.elements, simTime);
    halo.position.set(selPos.x * SCENE_SCALE, selPos.z * SCENE_SCALE, -selPos.y * SCENE_SCALE);
    halo.lookAt(camera.position);
    halo.scale.setScalar(1 + Math.sin(simTime * 2) * 0.2);

    earth.rotation.y += dt * 0.015;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  // 2Hz UI refresh
  let lastUI = 0;
  function uiTick() {
    const now = performance.now();
    if (now - lastUI > 500) {
      updateTicker();
      updateTelemetryPanel();
      lastUI = now;
    }
    requestAnimationFrame(uiTick);
  }

  uiTick();
  requestAnimationFrame(tick);
}