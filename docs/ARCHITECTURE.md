# Architecture

OrbitOps is a vertically-integrated system. Every layer of the stack lives in this
repository. This document explains how the pieces fit together.

---

## High-level view

```
                       ┌─────────────────────────────────────┐
                       │          Customer Browser           │
                       │                                      │
                       │   ┌────────────┐  ┌────────────┐   │
                       │   │ Landing    │  │ Cockpit    │   │
                       │   │ (marketing)│  │ (3D ops)   │   │
                       │   └─────┬──────┘  └─────┬──────┘   │
                       │         │                │          │
                       │         └─────┬──────────┘          │
                       │               │                    │
                       │               ▼                    │
                       │        ┌──────────────┐             │
                       │        │  AI Agent    │             │
                       │        │  (in browser)│             │
                       │        └──────────────┘             │
                       └─────────────────┬───────────────────┘
                                         │ WebSocket (when backend available)
                                         │ or: in-browser simulation
                       ┌─────────────────▼───────────────────┐
                       │   OrbitOps Backend — ONE Fastify     │
                       │   service (Node + TypeScript)        │
                       │                                      │
                       │   auth (API key / WS ticket)         │
                       │     → proposals · telemetry · audit  │
                       │     → events (WS) · LangGraph agent  │
                       │                                      │
                       │   HMAC-signed, append-only audit log │
                       │   DB: pglite (dev) → Postgres (prod) │
                       └─────────────────┬───────────────────┘
                                         ▲
                                         │ SGP4 propagation · TLE / OMM ingest
                       ┌─────────────────┴───────────────────┐
                       │   External data: CelesTrak (live);   │
                       │   Space-Track / LeoLabs / 18 SDS     │
                       │   (optional / planned feeds)         │
                       └───────────────────────────────────────┘
```

---

## Components

### 1. Marketing site (`src/pages/home.js`, `src/pages/pricing.js`)

A single-page marketing site with embedded product demo. Vanilla JS + CSS, no
framework, no build step. Loads in <1 second on a cold cache. Hosts the same
3D engine as the cockpit so the demo is real, not a video.

Sections:
1. Hero — 3D Earth + tagline + CTA
2. Problem — operator pain quantified
3. Solution — OrbitOps in 4 pillars
4. Product — embedded live cockpit
5. AI Agent — explainable reasoning demo
6. HITL — architecture diagram
7. Market — TAM / SAM / SOM
8. Roadmap — 12 months
9. Investors — CTA + one-pager download

### 2. Cockpit (`src/ui/cockpit-immersive.js`)

The operator's primary interface. Three.js scene with:
- Realistic Earth (procedural + optional imagery)
- The real CelesTrak catalogue (11,000+ objects; a performant subset rendered at a time)
- Orbit paths (computed via SGP4-lite)
- Click-to-select satellite → detail panel
- Time scrubber (play forward, backward, 10× speed)
- Mission filter (only show my constellation)
- Alert ticker (anomalies, conjunctions)

The cockpit can run in three modes:
1. **Demo mode** — fully synthetic, runs in browser
2. **Connected mode** — WebSocket to backend, real telemetry
3. **Replay mode** — playback from a recorded session

### 3. AI Agent (`src/core/llm-agents.js`)

The reasoning loop. Lives in two places:
- In-browser (demo mode) — fully deterministic, no LLM, hardcoded scenarios
- Backend (production) — calls an LLM API for reasoning, with the agent loop
  providing the structure

The agent loop has five steps (ReAct pattern):
1. **Observe** — read telemetry, alerts, operator inputs
2. **Think** — generate candidate interpretations
3. **Score** — rank candidates by expected severity × likelihood
4. **Propose** — emit the top-ranked proposal with reasoning chain
5. **Wait** — hand to human for approval

In production, step 2 is augmented by an LLM. The reasoning chain is the source of
truth, not the LLM's "final answer".

### 4. Telemetry pipeline (`src/core/telemetry.js`)

Ingests telemetry from customer ground stations. Two paths:
- **Push**: customer's ground system POSTs batches to `/v1/telemetry`
- **Pull**: customer's ground system exposes an endpoint we poll

Backend normalises, validates, and writes to TimescaleDB with hypertables for
efficient time-range queries. Anomaly detection runs as a continuous aggregate on
the hypertables.

### 5. Orbit propagator (`src/core/orbit-propagator.js`)

A simplified SGP4 implementation in pure JS (~400 lines). Runs in the browser for
the demo, in the backend for real conjunction analysis. Source-of-truth is
CelesTrak's TLE catalog, refreshed every 4 hours.

### 6. Anomaly detector (`src/core/anomaly-detector.js`)

Statistical + ML detector over the telemetry stream. Three classes of anomaly:
1. **Point** — single reading out of distribution
2. **Contextual** — reading is OK globally but bad in this context (e.g. eclipse)
3. **Collective** — sequence of readings individually OK but pattern is anomalous
   (e.g. gradual battery degradation)

### 7. Maneuver planner (`src/core/maneuver-planner.js`)

Given a conjunction (predicted close approach below threshold) or station-keeping
request, computes the optimal burn:
- Hohmann transfer for altitude changes
- Phasing for plane changes
- Combined burns for delta-V minimisation
- Fuel budget accounting
- Confidence interval on the burn
- Alternative strategies ranked by fuel / time / risk

### 8. Audit log (`src/core/audit-log.js`)

Append-only, hash-chained log of every operator action, AI proposal, system event.
Each entry is signed with HMAC over (previous_hash || entry). Tamper-evident by
construction. Customers can export their audit log in JSON or CSV for regulatory
submission.

---

## Data model

```
satellites (
  id UUID,
  customer_id UUID,
  norad_id INT,
  name TEXT,
  bus TEXT,
  launch_date DATE,
  status TEXT, -- active | decommissioning | failed | lost
  mission TEXT,
  created_at TIMESTAMPTZ
)

telemetry (
  satellite_id UUID,
  ts TIMESTAMPTZ,
  subsystem TEXT,
  metric TEXT,
  value NUMERIC,
  unit TEXT,
  quality TEXT
) -- hypertable partitioned by ts

alerts (
  id UUID,
  satellite_id UUID,
  ts TIMESTAMPTZ,
  severity TEXT, -- info | warn | critical | emergency
  kind TEXT, -- anomaly | conjunction | degradation | maneuver_required
  payload JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
)

proposals (
  id UUID,
  satellite_id UUID,
  ts TIMESTAMPTZ,
  reasoning_chain JSONB,
  proposed_action JSONB,
  status TEXT, -- pending | approved | rejected | modified
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
)

audit_log (
  seq BIGSERIAL,
  ts TIMESTAMPTZ,
  actor TEXT, -- user:<id> | ai:<agent_id> | system
  action TEXT,
  payload JSONB,
  prev_hash BYTEA,
  hash BYTEA
)
```

---

## Why no microservices

We considered microservices and rejected them, for now. The reasons:

1. **A small project shouldn't run a microservices platform** — it would spend most of its time on deployment plumbing instead of the product
2. **Network hops add latency** — the agent loop should be fast
3. **A single service is easier to reason about, test, and audit** than a mesh
4. **The bottleneck is depth and correctness, not scale**

We'd only revisit this if real scale genuinely demanded it.

---

## Why no React / Vue / Svelte

We considered React and rejected it. The reasons:

1. **We ship a marketing site and a cockpit** — neither needs a component framework
2. **Bundle size matters** — landing page <100 KB gzipped
3. **Our team can read every line of vanilla JS** — no magic, no abstraction tax
4. **Three.js plays nicely with vanilla JS** — no DOM conflicts

If we end up building a complex internal tool, we may revisit. For the customer-
facing surface, vanilla JS is the right choice.

---

## Why a custom AI agent instead of an LLM wrapper

We are not building "GPT with system prompt". We are building an agent loop with:

- Explicit state machine
- Deterministic tie-breaks
- Tool use (the agent calls real functions: `get_telemetry`, `propagate_orbit`,
  `score_conjunction`, `propose_maneuver`)
- Reasoning chain as first-class output (not just final answer)

The LLM is one tool the agent uses to generate hypotheses. The agent's reasoning
chain — the trace of what it tried, what it found, what it considered, why it
chose what it chose — is the actual product. That reasoning chain is what the
operator reads, what gets audited, what gets fed back to the model for the next
suggestion.

This is the difference between "ask GPT to monitor my satellites" and "give me
an operator teammate I can supervise".

---

## Security model

See [SECURITY.md](../.github/SECURITY.md) for the full threat model.

In short — what the code does today, and what the deployment provides:
- **Per-customer tenant isolation** — every query is scoped by `customer_id`, and
  an optional Postgres Row-Level Security layer enforces it at the database too
  (`DB_RLS`, see [INFRA.md](INFRA.md)).
- **Encrypted in transit** (TLS, terminated at the edge). **Encryption at rest** is
  provided by the managed database at deploy (RDS / Cloud SQL / Neon all do
  AES-256 at rest) — a deploy requirement, not app code.
- The **deterministic decision engine makes no outbound network calls**; the only
  outbound path is the *optional*, operator-configured LLM advisory call, which is
  disabled by default.
- **Every decision is recorded in a tamper-evident, HMAC-SHA-256 hash-chained
  audit log**; a customer can re-verify the whole chain offline.
- **SOC 2** is a business/process goal (access reviews, vendor management, incident
  response — see [INFRA.md §7](INFRA.md)), not a shipped code feature.

---

## Observability

Observability is wired but stays out of the way by default:

- **Correlation IDs** — every request gets an `X-Request-Id` (inbound or generated), echoed on the response and attached to every log line for that request (enriched with `customerId`/`operatorId` once auth resolves).
- **Safe structured logs** — the request logger redacts the query string, so an API key can never land in a log line.
- **OpenTelemetry, env-gated** — `initTracing()` only starts the SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise the tracer is a documented no-op that costs nothing, and the service runs fully offline. When enabled, spans wrap the path that matters: `audit.append`, `telemetry.ingest`, and `agent.graph.run`.

A real deployment can point the OTLP endpoint at any collector (Jaeger, Grafana, Honeycomb, …). No specific vendor is bundled or required.

---

## Deployment topology

**Open source / self-host.** The whole system is two things you own:
- the static frontend on any host (it runs standalone in demo mode with zero backend), and
- one Node + TypeScript service (the Fastify backend) — **pglite** for zero-setup dev, or **Postgres** via `DATABASE_URL` in production, behind the same `Db` interface either way.

**The public demo** ships both together as a single Cloudflare deployment: one Worker serves the static app and fronts the Node backend running in a Cloudflare Container (Durable-Object-backed), routing `/v1/*` + `/health` to it and `/api/ai` to an OpenRouter proxy. It runs a single instance with an ephemeral pglite database (reseeded on cold boot) — the right trade-off for a public demo, not a production data plane.

**Planned (hosted tier — not built).** Managed Postgres/TimescaleDB for durable multi-tenant data, a Redis-backed event bus for multi-instance scale, SSO/RBAC, and encryption-at-rest would be a future managed offering. The code seams already exist (the `Db` interface, a transport-agnostic event bus, `DB_RLS`) — see [INFRA.md](INFRA.md) — but none of it runs today.

---

## What we explicitly do not build (yet)

- Multi-customer shared ML model (we will, but only after we have per-customer
  data for 6+ months)
- A customer-facing audit log search UI (we export JSON, customer queries with
  their own tools)
- Anomaly root-cause analysis (we surface the anomaly + candidates, the operator
  diagnoses)
- Onboard AI (the agent lives in our backend, not on the satellite — for now)
- Integration with STK, FreeFlyer, or other professional tools (we have a
  simple API; customers build their own integrations)

This list will shrink over time. It is here so we know what we are not building
when we are tempted.