# Changelog

All notable changes to OrbitOps are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and we adhere to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Per-route SEO metadata at the edge** — the Worker rewrites title, description, canonical and og:*/twitter:* per route with HTMLRewriter from a single shared route-meta module, so crawlers and social scrapers see each page's real metadata instead of the home page's on every URL. Sitemap gains lastmod + the going-live page; a WebSite JSON-LD block joins the SoftwareApplication one.
- **End-to-end + accessibility gate in CI** — a Playwright suite (fully offline, bundled-snapshot path) drives every primary route in a real browser, and an axe-core WCAG 2.x A/AA scan fails the build on any serious/critical violation. New frontend-ci workflow runs typecheck, lint, unit tests and e2e on every frontend-touching push/PR.
- **Streaming LLM output in the reasoning console** — BYOK agent stages stream over SSE; the console renders each agent's narrative token-by-token (never raw JSON) with graceful fallback to the buffered path. The decision path is unchanged: validated complete JSON, model fallback chain, deterministic without a key.

### Fixed
- Two real accessibility bugs the new gate caught: the dashboard's scrollable satellite table was unreachable by keyboard; the CelesTrak source switch had no accessible name.
- The in-app "Planned services" docs article still described the backend as an unbuilt Go service — it is the shipped Node + TypeScript backend running live behind the public demo. The article now separates shipped from genuinely planned, and the Terms page discloses the ephemeral demo backend.

Remaining in **Phase 2 — Operator-grade experience & trust**: the high-contrast
operator "console mode" and cross-browser hardening.

## [0.1.0] — 2026-07-10 — "First Light"

The first public release. Covers **Phase 0 (browser mission-control foundation)** and
**Phase 1 (production backend & auditable multi-agent core)** of the roadmap — the whole
system runs live on a single Cloudflare deployment.

### Added — browser app (Phase 0)
- Zero-build, vanilla-JS mission-control app: 3D cockpit, dashboard, agent console, flight tools, docs.
- Real satellite catalog — 11,000+ catalogued objects from CelesTrak with an offline snapshot, propagated with SGP4 in the browser.
- Orbital tools: closest-approach search, ground tracks, Hohmann/Tsiolkovsky burn sizing, and a what-if maneuver sandbox screened against the live catalog.
- In-browser deterministic AI agent with 5 pre-built scenarios; hash-chained (SHA-256) audit log; honest real-vs-simulated labelling throughout.

### Added — backend & AI core (Phase 1)
- Node + TypeScript (Fastify) backend: authenticated REST + WebSocket, per-operator identity, per-tenant isolation with Postgres Row-Level Security.
- LangGraph multi-agent copilot: supervisor → conjunction screener / anomaly triager → maneuver planner → compliance critic → drafter → **pending** proposal, with an evals suite gating CI.
- NASA-validated full-covariance conjunction Pc (Foster-1992 / CARA), matched to NASA's reference to ~3×10⁻⁶; ranked avoidance-burn alternatives.
- CCSDS **CDM** and **OMM** ingest (dependency-free parsers); FCC 5-year deorbit-compliance engine (King-Hele).
- Tamper-evident **HMAC** audit hash chain with multi-process-safe serialization, `verify`, and one-click JSON/CSV evidence-pack export.
- Durable LangGraph checkpointer with native HITL interrupt/resume (survives a process restart) and four-eyes countersign.
- Bring-your-own-model LLM (any OpenAI-compatible endpoint) — advisory-only and env-gated; the deterministic core needs no key.

### Added — shipping (Phase 1)
- One-Cloudflare deployment: a single Worker serves the static app and fronts the Node backend in a Cloudflare Container. Live at https://orbitops.shypot.com.
- `create-orbitops` — zero-dependency npm scaffolder (`npm create orbitops`) for a one-command self-host build.
- Clean URLs (History-API routing + SPA fallback); auto-connected live demo with a flag-gated seed.

### Verified
- 161 backend tests + 15 frontend pure-math tests; `tsc --noEmit` and ESLint clean.
- Backend hardening live-verified on real Postgres 16 (Docker), including 15 concurrent audit appends holding the chain valid.
