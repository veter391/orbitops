# OrbitOps · v0.1

> **AI co-pilot for commercial satellite constellation operators.**
> Real-time monitoring · predictive anomaly detection · AI reasoning with humans always in command.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![No dependencies](https://img.shields.io/badge/dependencies-zero-blue.svg)](#stack)
[![Mobile ready](https://img.shields.io/badge/mobile-ready-orange.svg)](#responsive)

Built for mega-constellations (Starlink-class, Kuiper, OneWeb) with a SpaceX-inspired engineering philosophy: **vertical integration, simplicity, speed of iteration, dogfooding**.

---

## What this is

OrbitOps is a single-page web app that demonstrates how the AI co-pilot works. Every screen in this repo is a real, working artifact — not a marketing mockup.

| Surface | What it does |
|---|---|
| **[Cockpit](public/#/cockpit)** | Live 3D mission control. 50 satellites on real NASA Blue Marble Earth, animated constellations, mission health, per-subsystem telemetry, AI scenarios. Drag to orbit. |
| **[Agent](public/#/agent)** | Live AI reasoning console. Pick a scenario, watch the 5-step chain run in real-time (OBSERVE → THINK → SCORE → PROPOSE → WAIT), approve/reject/modify the proposal. Hash-chained audit log. |
| **[Dashboard](public/#/dashboard)** | Fleet KPIs, anomaly trend charts, fuel budget per satellite (80%–88% realistic variation), recent events feed, coverage map. |
| **[Tools](public/#/tools)** | Three Kepler physics mini-tools — orbit calculator, conjunction checker, burn planner. Same code as production. |
| **[Pricing](public/#/pricing)** | $1,500–$2,500 per satellite / month. MIT-licensed core. |
| **[Docs](public/#/docs)** | Install · quick start · architecture · core modules. |

---

## Stack

- **Zero runtime dependencies.** No React, Vue, jQuery.
- Vanilla JS · Three.js (bundled locally) · GSAP · Lenis
- SHA-256 hash-chained audit log (Welford stats, Kepler propagation, Tsiolkovsky burns)
- 8,500 lines of source. ~600KB JS bundle. Loads in <1s on a fresh browser.

---

## Responsive

Optimised for **mobile, tablet, and desktop**:
- Burger menu nav below 880px
- 2-column and 1-column fallbacks for KPI grids, fuel lists, audit logs
- Touch targets ≥ 44px on every interactive element
- Cockpit, tools orbit calc, and modals collapse cleanly
- Toast, kpi-tooltip, and modals sized for narrow viewports
- Stats counters stack vertically below 480px
- Burger animation (X transformation on open)

Tested at 390×844 (iPhone 14), 768×1024 (iPad), 1440×900 (desktop).

---

## Quick start

```bash
# Serve the static files
npx serve public
# or
python3 -m http.server 8000 --directory public

# Open
open http://localhost:8000
```

No build step. No environment variables. No API keys. The 3D Earth, AI reasoning, and audit chain all run in the browser.

---

## Project structure

```
orbitops/
├── index.html                  ← entry point, import map, inline critical CSS
├── src/
│   ├── main.js                 ← boot, top nav, router init, page registry
│   ├── router.js               ← hash-based SPA router, scroll restore
│   ├── utils.js                ← Emitter, formatters, math helpers
│   ├── core/
│   │   ├── orbit-propagator.js  ← Kepler (Newton-Raphson), ECI→ECEF, closest approach
│   │   ├── telemetry.js          ← mulberry32 seeded, mission-specific baselines
│   │   ├── anomaly-detector.js   ← Welford online statistics
│   │   ├── maneuver-planner.js   ← Hohmann transfer, Tsiolkovsky rocket eq
│   │   └── audit-log.js          ← SHA-256 hash-chained append-only log
│   ├── data/
│   │   └── satellites.js         ← 50 sats across 6 mission types (comms/eo/iot/weather/pnt/bb)
│   ├── scenarios/
│   │   └── index.js              ← 5 AI scenarios with full reasoning chains
│   ├── ui/
│   │   ├── cockpit-immersive.js  ← 3D cockpit with Three.js + Lenis + GSAP
│   │   ├── agent-panel.js        ← proposal modal with structured data tables
│   │   └── toast.js              ← toast notifications
│   ├── pages/
│   │   ├── home.js               ← cinematic hero, scroll storytelling
│   │   ├── cockpit.js            ← full-screen 3D cockpit mount
│   │   ├── agent.js              ← live reasoning demo console
│   │   ├── dashboard.js          ← fleet KPIs, fuel, anomaly feed
│   │   ├── tools.js              ← Kepler physics mini-tools
│   │   ├── pricing.js            ← per-satellite pricing tiers
│   │   └── docs.js               ← documentation pages
│   └── styles/
│       ├── tokens.css            ← design system primitives
│       ├── base.css              ← reset, typography, utilities
│       ├── components.css        ← buttons, cards, inputs, badges
│       ├── pages.css             ← all page-specific styles (3000 lines)
│       └── chrome.css            ← nav, side-nav, footer, mobile burger
├── public/
│   ├── vendor/
│   │   ├── three.module.js        ← Three.js r160 (1.27 MB)
│   │   ├── gsap/                  ← GSAP + ScrollTrigger
│   │   └── lenis/                 ← Lenis smooth scroll
│   ├── img/
│   │   ├── 3d/earth-day.jpg       ← NASA Blue Marble (2048×1024)
│   │   ├── hero-cinematic-opt.jpg ← cinematic hero backdrop
│   │   └── bg-*-opt.jpg           ← per-page atmospheric backgrounds
│   ├── logos/                     ← brand SVG + PNG
│   └── audio/hero-theme.mp3
├── ARCHITECTURE.md              ← system architecture, data flow
├── MISSION.md                   ← the operator problem we solve
├── PHILOSOPHY.md                ← SpaceX-inspired engineering principles
├── POSITIONING.md               ← vs Cognitive Space, market position
├── ROADMAP.md                   ← v0.1 → v1.0
├── SECURITY.md                  ← HITL guarantees, audit integrity
├── BRAND.md                     ← visual identity
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
└── LICENSE                      ← MIT
```

---

## Brand & visual system

- **Palette**: Single accent (`--accent #6FA8FF`, SpaceX-like cool deep blue), used with restraint. Status colors only where meaningful (`--ok`, `--warn`, `--alert`). Mission colors only for satellite categories.
- **Typography**: Inter (sans), Space Grotesk (display), JetBrains Mono (data)
- **No glow shadows.** No neon. Restraint over noise.

See `BRAND.md` for full tokens.

---

## What makes OrbitOps different from Cognitive Space ($4M Series A, Oct 2025)

| | Cognitive Space | OrbitOps |
|---|---|---|
| **Mission focus** | EO / SAR only | Comms, EO, IoT, weather, PNT, broadband |
| **Customer focus** | Government, defense | Commercial mega-constellations |
| **Architecture** | Closed SaaS | MIT-licensed core + managed service |
| **HITL model** | Mixed (some autonomous) | Strictly human-in-the-loop, every action approved |
| **Audit trail** | Internal | SHA-256 hash-chained, exportable JSON |
| **Time to first proposal** | Days (account setup) | Seconds (in-browser demo) |
| **Acquisition target** | Lockheed / Palantir | SpaceX / Kongsberg / Raytheon |

See `POSITIONING.md` for the full competitive breakdown.

---

## Engineering principles

1. **Vertical integration** — UI, core, data all in one repo. No service boundaries until we need them.
2. **Speed of iteration** — Zero build step. Edit a file, refresh browser.
3. **Dogfooding** — Every screen in this repo is the actual interface. No separate "marketing site".
4. **HITL by design** — AI proposes, human disposes. No autonomous actions. No exceptions.
5. **Audit-grade** — Every state change is hash-chained. The log is the source of truth.
6. **Physics, not vibes** — Real Kepler propagation, real Tsiolkovsky, real Welford. The numbers mean something.

See `PHILOSOPHY.md` for the long-form rationale.

---

## License

MIT. See [LICENSE](LICENSE). You own everything you fork.

---

Built in Munich. Target acquisition: SpaceX.
