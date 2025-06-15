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
                       │          OrbitOps Backend            │
                       │                                          │
                       │   ┌──────────┐   ┌─────────────────┐ │
                       │   │ Ingest   │──▶│ Telemetry Store  │ │
                       │   │ Worker   │   │ (TimescaleDB)    │ │
                       │   └──────────┘   └────────┬────────┘ │
                       │                            │          │
                       │                            ▼          │
                       │                     ┌─────────────┐  │
                       │                     │ AI Agent    │  │
                       │                     │ Service     │  │
                       │                     └──────┬──────┘  │
                       │                            │          │
                       │                            ▼          │
                       │                     ┌─────────────┐  │
                       │                     │ Audit Log   │  │
                       │                     │ (signed,    │  │
                       │                     │  append-only)│ │
                       │                     └─────────────┘  │
                       │                                          │
                       └──────────────────────────────────────────┘
                                         ▲
                                         │ SGP4 propagation
                                         │ TLE updates
                       ┌─────────────────┴───────────────────┐
                       │   External: CelesTrak, Space-Track,  │
                       │   LeoLabs, 18 SDS, customer ground   │
                       └───────────────────────────────────────┘
```

---

## Components

### 1. Marketing site (`src/ui/landing.js`)

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

### 2. Cockpit (`src/ui/cockpit.js`)

The operator's primary interface. Three.js scene with:
- Realistic Earth (procedural + optional imagery)
- 50+ simulated satellites (real TLEs from CelesTrak)
- Orbit paths (computed via SGP4-lite)
- Click-to-select satellite → detail panel
- Time scrubber (play forward, backward, 10× speed)
- Mission filter (only show my constellation)
- Alert ticker (anomalies, conjunctions)

The cockpit can run in three modes:
1. **Demo mode** — fully synthetic, runs in browser
2. **Connected mode** — WebSocket to backend, real telemetry
3. **Replay mode** — playback from a recorded session

### 3. AI Agent (`src/core/ai-agent.js`)

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

We considered microservices and rejected them. The reasons:

1. **Three of us cannot operate a microservices platform** — we would spend 30% of
   our time debugging the deployment
2. **Network hops add latency** — the agent loop needs to be fast
3. **Single-tenant data planes are easier to reason about** as a monolith
4. **The current bottleneck is product-market fit, not scale**

We will revisit at 50 customers or 10M events/day, whichever comes first.

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

See [SECURITY.md](SECURITY.md) for the full threat model.

In short:
- Single-tenant data plane per customer
- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- AI agent runs in a sandbox with no outbound network
- Every AI proposal carries an HMAC signature
- Customers can verify their audit log offline
- SOC 2 Type II target by month 9

---

## Observability

OpenTelemetry traces from ingest to AI proposal to operator approval. Metrics:
- `telemetry.events.ingested` (counter)
- `ai.proposals.generated` (counter, labelled by kind)
- `ai.proposals.approved` / `rejected` / `modified` (counter)
- `cockpit.frame_time` (histogram, p50 / p95 / p99)
- `audit.log.entries` (counter)
- `demo.constellation.uptime` (gauge)

Logs go to Grafana Loki. Traces go to Grafana Tempo. Dashboards in Grafana.

We instrument the cockpit in production to learn which features operators actually
use. If a button is never clicked in three months, we cut it.

---

## Deployment topology

For each customer:
- One isolated Postgres database (managed: Neon or Supabase)
- One OrbitOps backend process (single binary, k8s pod)
- One Redis instance for ephemeral state
- One TimescaleDB instance (managed, shared across customers with strict RLS)
- One Object Storage bucket for raw telemetry archives

Network: customer ground systems connect via private link (AWS Direct Connect
or GCP Partner Interconnect). Public internet is never in the path for telemetry.

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