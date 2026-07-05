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
| Audit log | **Real** | SHA-256 hash-chained, append-only (SubtleCrypto). Tamper with one entry and the chain breaks visibly. |
| Telemetry | **Simulated** | No free source provides per-satellite health telemetry. Battery/thermal/comms streams are seeded simulations, labelled as such in the UI. |
| AI scenarios | **Demo** | The 5 scenario reasoning chains are scripted demonstrations over deterministically computed numbers. With your own OpenRouter key, three live LLM agents reason over that same verified data — but the scenarios themselves remain demos, not live operations. |
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
 │  ├─ pricing        ├─ telemetry.js (simulated, labelled)         │
 │  └─ docs           ├─ audit-log.js (SHA-256 hash chain)          │
 │                    ├─ model-routing.js ──┐                       │
 │                    ├─ llm-agents.js ─────┼── OpenRouter (BYOK,   │
 │                    └─ openrouter-client ─┘   optional)           │
 │                                                                  │
 │  ui/ (cockpit 3D, agent panel, ambient, toast)  styles/ (CSS)    │
 └──────────────────────────────────────────────────────────────────┘
        static hosting is the whole deployment — no backend exists
```

Vanilla JS ES modules, Three.js vendored locally, no framework, no bundler. See [ARCHITECTURE.md](ARCHITECTURE.md) for the deep dive.

---

## AI: bring your own key

The reasoning console runs a three-agent pipeline — **Analyst → Strategist → Safety Reviewer** — over numbers that deterministic flight-dynamics code has already computed. The LLMs interpret; they never invent telemetry or delta-v figures. Nothing executes without human approval.

- **BYOK**: your OpenRouter key, stored only in your browser's localStorage, sent only to openrouter.ai.
- **Model routing**: each task gets an ordered fallback chain of models — see [`src/core/model-routing.js`](src/core/model-routing.js). Three profiles: `free` (verified free-tier models, works today, the default), `balanced` and `frontier` (empty by design — operators fill in their org-approved paid models; we don't guess model IDs for you).
- **Graceful degradation**: if a model is saturated the chain falls through; if everything fails the UI keeps the deterministic output. A public demo must never hard-fail on shared free infrastructure.

---

## Roadmap — all of this is PLANNED, none of it exists yet

- **Go backend** for real telemetry ingest (WebSocket in, commanding path out)
- **Streaming LLM output** in the agent console
- **Managed service** (the tiers on the pricing page are indicative and clearly labelled PLANNED)
- LeoLabs / 18 SDS integration, SOC 2 — see [ROADMAP.md](ROADMAP.md)

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
