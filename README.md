# OrbitOps

> **An open-source mission-control cockpit for satellite constellations — real orbital mechanics in the browser, AI that proposes, humans who approve.**

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![No build step](https://img.shields.io/badge/build-none-blue.svg)](#quick-start)

OrbitOps is a vanilla-JS, zero-build web app: a 3D cockpit over a real satellite catalog, a human-in-the-loop AI reasoning console, a hash-chained audit log, and a set of live flight tools. Everything below is labelled by what it actually is — real math, real data, or a clearly marked demo.

![OrbitOps home — hero and mission overview](docs/screenshots/home.jpg)

| | |
|---|---|
| ![Cockpit — 3D constellation view with live orbital catalog](docs/screenshots/cockpit.jpg) | ![Dashboard — fleet KPIs, fuel budgets, anomaly feed](docs/screenshots/dashboard.jpg) |

---

## What is real vs. what is simulated

We publish this table because a demo that blurs the line is a demo you can't trust.

| Component | Status | Detail |
|---|---|---|
| Satellite catalog | **Real** | Live TLEs from CelesTrak (Starlink, OneWeb, stations) with a bundled offline snapshot — **11,000+ real catalogued objects**. 2-hour cache, per CelesTrak's own refresh cadence. |
| Orbit propagation | **Real** | SGP4 in the browser (vendored satellite.js) for the catalog; classical Kepler propagation (Newton–Raphson) for the demo constellation and tools. |
| Orbital math in tools | **Real** | Closest-approach search, ground tracks, Hohmann/Tsiolkovsky burn sizing — computed live, with every simplification (no drag, no J2, fixed exhaust velocity) stated in the UI. |
| Backend API | **Real** | Node + TypeScript (Fastify) service: authenticated REST + WebSocket, per-tenant isolation, real Postgres in prod (in-process pglite for zero-setup dev). Runs standalone; the browser app is an additive layer on top. See [docs/SYSTEM-GUIDE.md](docs/SYSTEM-GUIDE.md). |
| Audit log | **Real** | Append-only, tamper-evident hash chain. The browser signs with SHA-256; the backend upgrades it to keyed **HMAC** with multi-process-safe serialization, plus `verify` and JSON/CSV export. |
| Telemetry | **Real (your fleet) · simulated only in the keyless demo** | The backend **ingests and serves your constellation's real telemetry** (`POST /v1/telemetry`, time-bucket downsampling, retention). No public API exposes a spacecraft's internal battery/thermal/comms health, so the keyless browser demo clearly labels those streams as simulated **until you connect your own feed**. |
| Multi-agent AI copilot | **Real · your OpenRouter key only for the optional LLM step** | A LangGraph multi-agent pipeline (supervisor → conjunction screener / anomaly triager → maneuver planner → compliance critic → drafter) files a *pending* proposal that a human approves. All scoring and planning is deterministic and runs with **no key**; the LLM adds an advisory note only when you supply an OpenRouter key — and never changes the decision. |
| AI scenarios (browser demo) | **Demo** | The 5 in-browser scenario chains are scripted demonstrations over deterministically computed numbers. The real, non-scripted reasoning pipeline is the backend copilot above. |
| Anomaly accuracy figures | **Not published** | There is no pilot fleet, so there are no precision/lead-time numbers. We won't invent them. |

---

## Quick start

Install and run your own copy — one command, any OS (needs Node.js):

```bash
npx create-orbitops@latest my-ops && cd my-ops && npm start
```

Open the URL it prints. That's the whole install — no build, no signup, no keys.
The npx installer ships with the open-source release.

**Run from source (contributors):**

```bash
git clone https://github.com/veter391/orbitops && cd orbitops && npx serve .
```

Open `http://localhost:8080`. No build step, no signup, no environment variables, no API keys required. Optional: add an OpenRouter key in the Agent page settings to switch the reasoning console from simulated to live LLM output.

---

## Architecture

```
                        browser (everything runs here)
 ┌──────────────────────────────────────────────────────────────────┐
 │  index.html → src/main.js → src/router.js (hash SPA)             │
 │                                                                  │
 │  pages/            core/                       data sources      │
 │  ├─ home           ├─ sgp4.js ──────────────── CelesTrak TLEs    │
 │  ├─ cockpit ────── ├─ live-constellation.js    (live + snapshot) │
 │  ├─ agent  ─────── ├─ orbit-propagator.js (Kepler)               │
 │  ├─ dashboard      ├─ maneuver-planner.js (Tsiolkovsky)          │
 │  ├─ tools  ─────── ├─ anomaly-detector.js (Welford)              │
 │  ├─ pricing        ├─ telemetry.js (demo feed; real via backend) │
 │  └─ docs           ├─ audit-log.js (SHA-256 hash chain)          │
 │                    ├─ model-routing.js ──┐                       │
 │                    ├─ llm-agents.js ─────┼── OpenRouter (BYOK,   │
 │                    └─ openrouter-client ─┘   optional)           │
 │                                                                  │
 │  ui/ (cockpit 3D, agent panel, ambient, toast)  styles/ (CSS)    │
 └──────────────────────────────────────────────────────────────────┘
   the browser app runs standalone (demo mode) via static hosting;
   the open-source backend (backend/) is an optional, additive layer
```

Vanilla JS ES modules, Three.js vendored locally, no framework, no bundler. The browser app works with zero backend; when you run the **open-source Node + TypeScript backend** (`backend/`) it adds a real authenticated API, real telemetry ingest, a tamper-evident audit chain, and the multi-agent AI copilot. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SYSTEM-GUIDE.md](docs/SYSTEM-GUIDE.md) for the deep dive.

---

## AI: bring your own key

The reasoning console runs a three-agent pipeline — **Analyst → Strategist → Safety Reviewer** — over numbers that deterministic flight-dynamics code has already computed. The LLMs interpret; they never invent telemetry or delta-v figures. Nothing executes without human approval.

- **BYOK**: your OpenRouter key, stored only in your browser's localStorage, sent only to openrouter.ai.
- **Model routing**: each task gets an ordered fallback chain of models — see [`src/core/model-routing.js`](src/core/model-routing.js). Three profiles: `free` (verified free-tier models, works today, the default), `balanced` and `frontier` (empty by design — operators fill in their org-approved paid models; we don't guess model IDs for you).
- **Graceful degradation**: if a model is saturated the chain falls through; if everything fails the UI keeps the deterministic output. A public demo must never hard-fail on shared free infrastructure.

---

## Roadmap

**Shipped (open source, tested):**
- **Node + TypeScript backend** — authenticated REST + WebSocket API, multi-tenant isolation, HMAC-signed tamper-evident audit, real telemetry ingest, and a LangGraph multi-agent human-in-the-loop copilot. Verified live on real Postgres; see [docs/SYSTEM-GUIDE.md](docs/SYSTEM-GUIDE.md).

**Planned (labelled PLANNED in the UI until shipped):**
- Browser **connected mode** — the cockpit wired to the backend for live telemetry and real (non-scripted) agent runs
- **Streaming LLM output** in the agent console
- Deeper conjunction screening: CCSDS **CDM** ingest + probability-of-collision decision support
- **Managed service** (the tiers on the pricing page are indicative and clearly labelled PLANNED)
- LeoLabs / 18 SDS integration, SOC 2

---

## Built in the open — no fake numbers

The rules this project holds itself to:

1. **No invented metrics.** No accuracy percentages without a pilot fleet, no "trusted by" logos, no testimonials that didn't happen.
2. **Everything unshipped is labelled PLANNED** — in the UI, in the docs, in this README.
3. **Real math or clearly marked demo.** Every simplification in the tools is stated next to the result it affects.
4. **Humans always in command.** The AI proposes; a person approves. Every decision lands in the hash-chained audit log.
5. **The demo is the product.** No separate marketing site with prettier, less honest screenshots.

---

## License

MIT — see [LICENSE](LICENSE). The core is free forever: clone it, self-host it, fork it, own it.
