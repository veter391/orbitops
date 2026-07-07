# OrbitOps — System Guide

This document explains, in plain language, everything built in OrbitOps so far: what it is, how the pieces fit together, how each backend module works, what the tests actually prove, and how to run and verify it yourself. It is written so the owner can understand the system deeply, check every claim against real files, and explain it confidently in a technical interview.

Every claim below is based on reading the actual source files in this repository (paths given in backticks). Nothing here is aspirational — planned-but-unbuilt work is called out explicitly in section 10.

---

## 1. What OrbitOps is

OrbitOps is an **open-source (MIT-licensed) browser-based "mission control" app for satellite operations**, paired with a **human-in-the-loop (HITL — a person must approve before anything happens) multi-agent AI backend**. The browser app (a 3D cockpit, dashboards, and flight-planning tools) runs entirely client-side with real orbital mechanics and works with zero setup ("demo mode"). The backend (Node.js + TypeScript) is a separate, optional service that adds a real API: it lets an AI reasoning pipeline propose actions (like a collision-avoidance maneuver), but every proposal sits in a "pending" state until a human operator approves, rejects, or modifies it — and every step is written into a tamper-evident audit log (a chain of records where changing any past entry breaks a cryptographic check, so tampering is provable).

The differentiator, verified against real competitors: existing open-source mission-control tools (NASA OpenMCT, Yamcs, OpenC3 COSMOS) have no AI copilot, and existing AI-ops products (Cognitive Space, Neuraspace, Kayhan Space) are closed-source SaaS. OrbitOps is positioned as the first open-source, auditable, human-in-the-loop AI copilot for this space.

---

## 2. The big picture

```
                     ┌───────────────────────────────────────────┐
                     │        BROWSER (mission-control OS)        │
                     │   vanilla JS, zero build, works standalone │
                     │   — "demo mode" needs no backend at all    │
                     └───────────────────┬─────────────────────────┘
                                         │ opt-in "connected mode"
                                         │ (HTTP + WebSocket)
                                         ▼
                     ┌───────────────────────────────────────────┐
                     │        BACKEND API (Fastify, Node+TS)      │
                     │  backend/src/server.ts, index.ts           │
                     │  auth (API key / WS ticket) → services      │
                     └───────────────────┬─────────────────────────┘
                                         │
         ┌────────────┬─────────────┬───┴──────────┬──────────────┬───────────────┐
         ▼            ▼             ▼               ▼              ▼               ▼
      auth/       proposals/    telemetry/       audit/         events/        agent/ + agents/
   API key→op   pending→        batch ingest,   hash-chain +   in-process     LangGraph multi-
   →tenant      approve/reject  downsampling,   HMAC, tamper-  pub/sub →      agent graph:
                /modify,        retention        evident        WebSocket      supervisor →
                atomic SQL                                      fan-out        specialist →
                guards                                                        planner → critic
                                                                                → drafter →
                                                                                pending proposal
         └────────────┴─────────────┴───────────────┴──────────────┴───────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────────┐
                     │              DATABASE (Db interface)       │
                     │  dev: pglite (real Postgres SQL, in-       │
                     │       process, no install)                  │
                     │  prod: Postgres via pg.Pool (same SQL,      │
                     │       same interface)                       │
                     └───────────────────────────────────────────┘
```

**"Demo mode always works; connected mode is opt-in."** This is a binding product rule of the project: the browser app must keep working with no backend at all — it ships its own deterministic orbital math, a bundled offline satellite catalog, and scripted AI demo scenarios. The backend, when present, is an additive layer the browser can optionally talk to over HTTP/WebSocket for real persistence, a real (non-scripted) agent run, and a real audit trail. Breaking the frontend to add backend features is explicitly disallowed.

---

## 3. The backend, piece by piece

The backend is a single Node.js + TypeScript service built on **Fastify** (a fast HTTP framework with built-in schema validation and logging). It is built in small, reviewed, tested vertical "slices" — each one is a git commit (see the Definition of Done in section 7).

### 3.1 Config & environment guards — `backend/src/config.ts`

All runtime settings come from environment variables, validated once at startup with **zod** (a schema/validation library — it checks the shape and constraints of data, e.g. "this must be a positive integer"). Defaults are safe for local development (e.g., `PORT=8790`, `AUDIT_HMAC_KEY=dev-insecure-key-change-me`), so `npm install && npm run dev` works with zero setup.

Critically, if `NODE_ENV=production` and `AUDIT_HMAC_KEY` is still the well-known dev default, or shorter than 32 characters, **the process throws and refuses to boot**. This exists because the audit chain (section 3.3) is only as trustworthy as this secret key — if it stayed at the public default in production, anyone who read the open-source code could forge an audit entry that looks valid.

### 3.2 Auth: API key → operator → customer — `backend/src/auth/index.ts`, `backend/src/auth/ticket.ts`

Every `/v1/*` route requires authentication. The flow:

1. The client sends `x-api-key: <key>` in a header.
2. `hashApiKey()` computes `sha256(key)` — keys are **never stored in plaintext**, only their hash, in the `operators` table.
3. `principalByApiKey()` looks the hash up and resolves a **Principal**: `{ operatorId, operatorName, customerId }`. An operator belongs to exactly one customer (tenant).
4. That identity is pinned onto the request (`req.customerId`, `req.operatorId`, `req.operatorName`) via a Fastify `onRequest` hook, so every downstream handler and every log line for that request automatically carries the tenant/operator context.

**Why WebSocket needs a different mechanism (tickets):** browsers cannot set custom headers on a WebSocket handshake, so a header-based API key can't be used there. If the key were instead accepted as a query parameter (`?apiKey=...`), it would end up in server logs, browser history, and `Referer` headers — a real leak. Instead (`backend/src/auth/ticket.ts`):

- The client first calls `POST /v1/stream/ticket` with its normal `x-api-key` header.
- The server mints a **short-lived signed ticket** (60 seconds), HMAC-signed with the same `AUDIT_HMAC_KEY`, encoding `customerId` and an expiry timestamp.
- The client opens the WebSocket with `?ticket=...` instead of the real key. Even if that URL leaks into a log, the ticket is useless within a minute and only ever identifies a tenant — it can't be replayed to call other REST endpoints.
- `verifyTicket()` checks the signature with `timingSafeEqual` (a comparison that takes the same amount of time regardless of where the mismatch is, so an attacker can't guess the correct signature byte-by-byte by measuring response time) and checks the expiry.

The server's request logger also has a custom serializer (`backend/src/server.ts`) that strips the query string from every logged URL — defense in depth, so even a mistake elsewhere can't put a key in the logs.

### 3.3 Multi-tenancy — migrations 003, 004, 005

Every proposal, telemetry reading, and audit entry belongs to exactly one **customer** (tenant). This is enforced two ways:

- **Application layer:** every single database query in `proposals/`, `telemetry/`, and `audit/` includes `WHERE customer_id = $1` (or an equivalent join). A request for another tenant's proposal ID returns "not found" — indistinguishable from a truly missing ID, which is the correct isolation behavior (confirmed by `test/proposals.test.ts`: *"a tenant cannot see or act on another tenant's proposal"*).
- **Database layer:** migration `005_fk.sql` adds foreign-key constraints (`customer_id → customers(id)`) with `ON DELETE CASCADE` on `proposals`, `telemetry`, and `audit_log`. This means the database itself refuses to store a row for a tenant that doesn't exist, and deleting a customer cleanly removes all of that tenant's data (proven by `test/schema.test.ts`).

Migration `004_operators.sql` layered **per-operator identity** on top of per-tenant identity: originally one API key spoke for a whole tenant and the "who approved this" name was free text typed into the request body — meaning the audit log could record a fabricated name. Now, an API key resolves to a specific named operator (who belongs to a customer), and the approving/rejecting identity always comes from the authenticated principal (`req.operatorId`/`req.operatorName`), never from the request body. `test/proposals.test.ts` has an explicit test: *"a client-supplied operator in the body is ignored (identity comes from auth)."*

### 3.4 The audit log — hash chain + HMAC — `backend/src/audit/index.ts`, `backend/src/audit/hash.ts`

This is the trust core of the system. Every meaningful event (a proposal created, approved, rejected, modified; any manually appended entry) is written as one row in `audit_log`, and each row links to the previous one like a chain:

- Each entry stores `prevHash` (the hash of the entry before it) and its own `hash`.
- The hash is computed as `HMAC-SHA-256(AUDIT_HMAC_KEY, prevHash|seq|timestamp|actor|action|canonicalPayload)` — an **HMAC** (Hash-based Message Authentication Code) is a hash that also requires a secret key to reproduce, so an attacker who doesn't know `AUDIT_HMAC_KEY` cannot forge a valid-looking entry even if they can edit the database directly.
- `stableStringify()` in `hash.ts` serializes the JSON payload with keys sorted recursively, because Postgres's JSONB column type silently reorders object keys — without a canonical (fixed, predictable) serialization, the same logical payload could hash differently after a round trip through the database.
- **Tamper evidence in plain terms:** if anyone edits, deletes, or reorders a past row, then re-deriving that row's hash from its (now-changed) contents no longer matches the stored `hash`, and/or the next row's `prevHash` no longer matches — `verify()` walks the whole chain from the genesis pointer (64 zero hex digits) and returns exactly where it broke and why (`sequence gap`, `prevHash mismatch`, or `hash mismatch`). `test/audit.test.ts` proves tampering with a middle entry is detected.
- Hash comparison in `verify()` uses `timingSafeEqual` too, so the verify endpoint itself can't leak information via response-time differences.

**Multi-process safety (advisory-lock serialization) — why it matters:** appending requires reading "what's the last sequence number and hash for this tenant," then writing the next one. If two requests do this at the same moment (two backend processes, or two pooled database connections), they could both read the same "last" row and both try to insert the same next sequence number — corrupting or forking the chain. This is fixed at the database level, not just in application code: `#appendOne()` wraps the read-then-write in a SQL transaction that starts with `SELECT pg_advisory_xact_lock(hashtext($1))` keyed by `customerId`. A **Postgres advisory lock** is a lock the database grants on request (not tied to any table) — this one is a *transaction-scoped* lock, held only until the transaction ends, so a second transaction for the same tenant blocks until the first fully commits or rolls back. This makes the chain safe even when the whole app is scaled to multiple processes talking to the same Postgres — which local single-process tools like an in-memory queue could never guarantee. `test/audit.test.ts` includes *"concurrent appends do not fork the chain"*, and per the git history this was additionally verified live with 15 concurrent appends against a real Postgres 16 connection pool (all 201, chain still valid).

There is also an in-process queue (`#tail`, a promise chain) inside `AuditLog` that serializes appends within one Node.js process/connection before they even reach the database, and if any queued append throws, the failure is logged (`this.log?.error`) so it's visible in server logs rather than silently swallowed — the queue itself keeps running for the next append.

### 3.5 Proposals lifecycle — `backend/src/proposals/index.ts`

A **Proposal** is the unit of "the AI suggests, a human decides." Its `status` is one of `pending → approved | rejected | modified` (see the CHECK constraint in migration `001_init.sql`).

- **create()** inserts a new pending proposal and immediately appends a `proposal.created` audit entry attributed to `'ai:agent'`.
- **approve() / reject() / modify()** all funnel through one private helper, `#decide()`, which runs a single SQL statement like:
  ```sql
  UPDATE proposals SET status = 'approved', approved_by = $3, approved_at = now()
  WHERE id = $1 AND customer_id = $2 AND status = 'pending' RETURNING *
  ```
  The `AND status = 'pending'` clause is the safety guard: it's checked and applied **atomically** by the database itself, so if two requests try to approve/reject the same proposal at the same instant, only one `UPDATE` can match a still-pending row — the second one updates zero rows and is treated as a no-op that just returns the current (already-decided) state, rather than double-writing the audit log. `test/proposals.test.ts` proves this: *"double approve is a no-op and does not double-write the audit log"* and *"modify after approve is rejected by the terminal-state guard."*
- The deciding operator's identity (`op.id`, `op.name`) is passed as an explicit function parameter sourced from `req.operatorId`/`req.operatorName` (the authenticated principal) — never read from the request body — so the audit trail can't record a fabricated name (section 3.3).
- Every decision publishes a lightweight event onto the in-process `EventBus` for the live WebSocket stream (section 3.6).

### 3.6 Telemetry — `backend/src/telemetry/index.ts`

Telemetry is bulk sensor/health data (battery, thermal, comms, etc.), deliberately **not** written to the audit log — the audit chain records human/AI *decisions*, not raw sensor noise, which would otherwise dominate and dilute it.

- **Batch ingest**: `ingest()` accepts up to `MAX_BATCH = 5000` readings per request (capped so a single insert stays safely under Postgres's ~65,535 bind-parameter limit) and inserts them all in one multi-row `INSERT`.
- **Bucket downsampling**: `queryBucketed()` groups readings into fixed-width time windows (e.g., every 60 seconds) and aggregates each window (`avg`, `min`, `max`, or `last`). The bucket boundary math (`floor(extract(epoch from ts) / bucketSeconds) * bucketSeconds`) is written in plain, portable SQL so it behaves the same on local pglite and on a real TimescaleDB hypertable in production (TimescaleDB is a Postgres extension specialized for time-series data — see `002_telemetry.sql`'s comment). `bucketSeconds` itself is validated as a positive integer before being inlined into SQL — since it's a checked number, not user text, this cannot be a SQL injection vector.
- **Latest-per-metric**: `latestPerMetric()` uses `SELECT DISTINCT ON (metric) ... ORDER BY metric, ts DESC` to fetch the single newest reading per metric for a satellite — the numbers a dashboard "snapshot" view needs.
- **Retention**: `purgeOlderThan(days)` deletes telemetry rows older than N days. Wired up in `backend/src/index.ts`: if `TELEMETRY_RETENTION_DAYS > 0`, it purges once on boot and then every hour; `0` (the default) means keep forever. `test/observability.test.ts` proves the purge only removes rows older than the cutoff, not everything.

### 3.7 Events + WebSocket stream — `backend/src/events/index.ts`, `backend/src/routes/stream.ts`

`EventBus` is a small typed wrapper around Node's built-in `EventEmitter` — an in-process publish/subscribe mechanism (a component "publishes" an event by name; any number of "subscribers" can listen for it). `Proposals` and `Telemetry` publish `proposal` and `telemetry` events; `/v1/stream` is a WebSocket route that subscribes to both and forwards them to the connected browser in real time, optionally filtered to one `?satelliteId=`. Every forwarded event is checked against `e.customerId !== customerId` first — a strict per-tenant filter, so one tenant's WebSocket connection can never see another tenant's telemetry or proposals, even though the bus itself is shared process-wide. The connect flow uses the short-lived ticket described in 3.2, not the raw API key.

The doc comment on `EventBus` notes explicitly that this in-process design is a deliberate v1 scope decision: a multi-node deployment would need to back it with something like Redis pub/sub, but the publish/subscribe interface used by the rest of the app would stay the same.

### 3.8 Idempotency keys — `backend/src/idempotency.ts`

An **idempotency key** lets a client safely retry a `POST` (e.g., after a network timeout where it's unclear if the first request succeeded) without creating a duplicate. The client sends an `Idempotency-Key` header; `idempotent()` checks the `idempotency_keys` table (`customer_id, key` as primary key, migration `006_idempotency.sql`) for a previously stored response. If found, it returns the exact same `{status, body}` instead of re-running the operation; if not, it runs the operation once and stores the result. Wired onto the four *creation* endpoints, where a retry would otherwise duplicate data — `POST /v1/proposals`, `POST /v1/telemetry`, `POST /v1/agent/run`, and `POST /v1/conjunctions/cdm`. The decision routes (`approve`/`reject`/`modify`) don't need idempotency keys: their atomic `WHERE status = 'pending'` guard already makes any retry a harmless no-op that returns the current state. The code comment is honest about a limit: this dedupes *sequential* retries, not truly concurrent simultaneous requests with the same key (that would need a lock, not just a lookup-then-insert).

### 3.9 Security middleware, error shape, CORS — `backend/src/server.ts`

Registered on every request, in this order: `@fastify/helmet` (sets defensive HTTP response headers, e.g. against clickjacking/MIME-sniffing), `@fastify/cors` (Cross-Origin Resource Sharing — controls which websites are allowed to call this API from a browser; empty `CORS_ORIGINS` means same-origin only, no cross-origin calls allowed at all), and `@fastify/rate-limit` (caps requests per IP per time window — `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`, defaults 300/minute — to blunt brute-force and denial-of-service attempts). `bodyLimit` (default 1 MiB) rejects oversized request bodies with a clean 413 rather than letting the process exhaust memory. A global `setErrorHandler` guarantees every error response has the same shape (`{ error: string }`), maps any unexpected error to a generic `internal error` message, and never leaks stack traces or SQL text to the client — details go to the server log instead, tagged by severity.

### 3.10 Correlation IDs + OpenTelemetry — `backend/src/observability.ts`, `backend/src/server.ts`

Every request gets a **correlation ID** (aka request ID): either the inbound `X-Request-Id` header (if a reasonable length) or a freshly generated UUID, attached to `req.id`, echoed back in the response header, and included on every log line for that request (further enriched with `customerId`/`operatorId` once auth resolves — section 3.2). This lets someone trace one request's full story across every log line it touched, and lets a client quote the ID back when reporting an incident.

**OpenTelemetry** (an industry-standard tracing library — it records "spans," which are timed, named units of work, e.g. "this database call took 12ms") is wired up but **env-gated**: `initTracing()` only starts the SDK and exports spans if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it, `@opentelemetry/api`'s tracer is a documented no-op, so `withSpan()` costs essentially nothing and the whole service runs fully offline by default. Spans are recorded around `audit.append`, `telemetry.ingest`, and `agent.graph.run` — the exact path from an AI suggestion to a signed audit entry — so a real deployment can trace that path end-to-end in a tool like Jaeger.

### 3.11 OpenAPI docs — `backend/src/server.ts`

`@fastify/swagger` generates an **OpenAPI spec** (a standard machine-readable description of an HTTP API — its routes, parameters, and auth) automatically, served at `GET /openapi.json`; `@fastify/swagger-ui` serves an interactive human-browsable version at `/docs`. The spec documents the `x-api-key` header as the security scheme. Both are public routes (no auth needed to *view* the docs) — the underlying `/v1/*` routes still require the real key.

---

## 4. The multi-agent AI core (B1–B4)

This is the newest and most distinctive part of the backend: a real multi-agent system built with **LangGraph.js** (`@langchain/langgraph`) — a library for building "graphs" of steps (nodes) an AI pipeline moves through, with built-in support for pausing/resuming and inspecting state at each step. Files: `backend/src/agents/rules.ts` (the deterministic safety core), `backend/src/agents/graph.ts` (the graph), `backend/src/agent/index.ts` (a thin public facade), `backend/src/agent/llm.ts` (the optional LLM call).

### 4.1 The graph, node by node

Entry point: `POST /v1/agent/run` with a `satelliteId` and a list of `signals` (e.g., `{ kind: 'conjunction', severity: 0.8 }`). The graph (`buildAgentGraph()` in `graph.ts`) runs these nodes in order:

| Node | Role | What it does |
|---|---|---|
| **supervisor** | Router | Looks at the *kinds* of incoming signals and picks a route: `conjunctionScreener` if any signal is a `conjunction` kind, `anomalyTriager` if any is a known anomaly kind (battery/thermal/attitude/comms), else `investigate` (fallback). |
| **memory** | Recall | Before the specialists run, recalls this satellite's recent prior proposals (`AgentMemory.recall()` over the `proposals` table) and emits a `RECALL` step — so the reasoning chain shows the agent is aware of what was decided before, not stateless. |
| **conjunctionScreener** | Specialist (real math) | Turns each conjunction's geometry into a real **probability of collision** via a first-order 2D-Gaussian model (`probabilityOfCollision()` in `agents/conjunction.ts`), bands it (clear/watch/warning/critical), and picks the top hypothesis. No LLM. |
| **anomalyTriager** | Specialist (real math) | Runs **modified z-score** outlier detection (median + MAD, `agents/anomaly.ts`) over the satellite's recent telemetry history to decide whether a metric is genuinely anomalous, and scores it. No LLM. |
| **investigate** | Specialist (fallback) | Generic review when no specialist matches; scores signals against the rulebook (`scoreCandidates()`). |
| **maneuverPlanner** | Planner | Turns the winning hypothesis into a concrete action. For a conjunction it sizes a real **avoidance burn** — along-track Δv and Tsiolkovsky propellant (`agents/maneuver.ts`) — for that satellite. |
| **complianceChecker** | Critic | Checks the planned action's `type` against `KNOWN_ACTIONS` (a fixed allow-list: `maneuver`, `load_shed`, `thermal_mitigation`, `attitude_correction`, `link_handoff`, `investigate`). Unrecognized action types are downgraded to `investigate` rather than being proposed as-is. This is also the one node that optionally calls an LLM (see 4.2). |
| **proposalDrafter** | Writer | Produces the human-readable "recommend action: X, awaiting operator approval" line for the reasoning chain. |
| **persist** | Gate | Calls `proposals.create()` — the *only* place anything is actually written to the database, and it always writes status `pending`. |

Every node also appends a `ChainStep` (`{ phase, agent, text }`) describing what it did in plain language — this becomes the proposal's `reasoningChain`, visible to the human operator as the "why" behind a suggestion. The graph is deliberately compiled **without** a checkpointer: every run is single-shot (start → end, never resumed), so keeping per-run state snapshots in memory would only accumulate forever under load. A durable Postgres checkpointer arrives with B3's human-in-the-loop `interrupt`, where pausing and resuming mid-graph genuinely needs saved state.

**Reasoning-chain phases**, in order: `OBSERVE` (supervisor notes what came in and where it's routing) → `RECALL` (memory node's note on prior decisions) → `THINK` (specialist lists candidate hypotheses) → `SCORE` (specialist's top pick and its score) → `PLAN` (planner's concrete action) → `CHECK` (critic's compliance verdict) → optionally `AI` (the LLM's advisory note, if enabled) → `PROPOSE` (drafter's final recommendation).

### 4.2 Why it's safe

- **Deterministic math only, for anything that decides.** All signal scoring (`scoreCandidates()`) and the rulebook (`RULES`, `KNOWN_ACTIONS`) in `rules.ts` are plain TypeScript data and arithmetic — no LLM call is anywhere near the decision of *what* to propose.
- **LLM is advisory only, and env-gated.** `llmAssess()` (`agent/llm.ts`) is only ever invoked from the `complianceChecker` node, and only to add a two-sentence advisory note (risk + one thing to double-check) onto the reasoning chain — it never changes `plan`, `criticOk`, or whether a proposal is created. `llmEnabled()` returns `false` with no `OPENROUTER_API_KEY` set, and the call itself has an 8-second timeout and a catch-all that returns `null` on any network/parse error — a flaky or absent LLM can never break a proposal or throw an exception into the graph.
- **Nothing executes without human approval.** The `persist` node always creates the proposal with status `pending` (enforced by `proposals.create()`, which always inserts through the same `create()` path used by the plain `/v1/proposals` REST endpoint). The only way a proposal changes status is a human calling `/v1/proposals/:id/approve|reject|modify`, authenticated as a real operator (section 3.5).
- **Every proposal is in the audit chain.** `proposals.create()` unconditionally calls `audit.append()` — an agent-produced proposal enters the same tamper-evident chain as everything else (section 3.4), attributed to `'ai:agent'`.

`test/agent.test.ts` proves: a conjunction signal routes through `conjunctionScreener → maneuverPlanner → complianceChecker → proposalDrafter`; an anomaly signal routes through the anomaly triager; an unknown signal kind falls back to `investigate`; an agent-created proposal flows into the ordinary approve lifecycle; and `/v1/agent/run` requires authentication like every other route.

### 4.3 AI-engineering best practices this demonstrates

- **Narrow, typed tool/data boundaries** — the rulebook and `KNOWN_ACTIONS` allow-list are the only vocabulary the planner can output; nothing free-form reaches "what action to take."
- **Human-in-the-loop by construction**, not by convention — the *only* code path that writes a non-pending status requires an authenticated operator call.
- **Graceful degradation** — the system's core function (screen, plan, propose) works with zero external dependencies (no API key, no network); the LLM only ever adds polish.
- **Auditable, deterministic control flow** — a LangGraph state graph (not a free-form agent loop) means the exact route taken (`path: string[]`) and every step's reasoning are recorded and inspectable per run, rather than living only in an opaque model conversation.
- **Separation of concerns** — routing/scoring/critic logic (`rules.ts`, `graph.ts`) is fully isolated from the optional LLM call (`llm.ts`), so the LLM dependency can be swapped or removed without touching the safety-relevant code.

### 4.4 The real domain math (B2–B4) — why this isn't a chatbot

The specialists and planner run **real, citeable physics/statistics**, not model guesses:

- **Probability of collision** (`agents/conjunction.ts`): first-order 2D-Gaussian encounter model, `Pc ≈ exp(−d²/2σ²)·(1 − exp(−R²/2σ²))` — the leading term of the standard Chan/Alfano series, accurate when the combined hard-body radius `R` ≪ position uncertainty `σ`. Banded to operator-style thresholds (`Pc ≥ 1e-3` critical, `1e-4` warning, `1e-5` watch).
- **Anomaly detection** (`agents/anomaly.ts`): modified z-score using the **median and MAD** (median absolute deviation), `z = 0.6745·(x − median)/MAD`, flagged at `|z| ≥ 3.5`. Robust to outliers in the baseline, unlike a mean/stddev z-score.
- **Avoidance-burn sizing** (`agents/maneuver.ts`): Clohessy–Wiltshire secular along-track model, `Δv ≈ Δs/(3·Δt)`, with propellant from the **Tsiolkovsky** rocket equation. Deterministic, with documented default satellite mass/Isp.
- **Agent memory** (`agents/memory.ts`, B4): before scoring, the `memory` node recalls this satellite's recent proposals from the database and injects a `RECALL` step, so decisions are made in the context of prior ones (offline, structured recall — a pgvector semantic layer is a future env-gated enhancement).

An **evals harness** (`test/agent-evals.test.ts`, run via `npm run evals`) runs fixture scenarios through the real graph and asserts routing, action type, Pc ranges, and — on every run — the safety invariant that **no scenario ever yields a non-pending proposal**. It is part of `npm test`, so CI is gated on it.

---

## 5. The conjunction domain & connected mode (Tracks C, D)

Two capabilities turn the backend from "an API" into an operator-facing system: ingesting the industry-standard collision message (Track C), and letting the browser app read the **live** backend instead of its in-browser simulation (Track D).

### 5.1 CDM ingestion — `backend/src/conjunction/cdm.ts`, `backend/src/routes/conjunctions.ts`

A **CDM (Conjunction Data Message)** is what satellite operators actually receive from the 18th/19th Space Defense Squadron, LeoLabs, and other space-situational-awareness providers when two objects are predicted to pass close. It is a flat **KVN** (Keyword=Value Notation) text format defined by CCSDS 508.0-B-1. No maintained permissive JS/TS CDM parser exists, so OrbitOps ships its own, dependency-free:

- **`parseCdm(text)`** splits the flat KVN into a structured message: header/relative-metadata plus a per-object key/value bag for OBJECT1 and OBJECT2. It routes strictly by the `OBJECT1`/`OBJECT2` tags (an unknown tag is discarded, never allowed to corrupt object1), strips `[unit]` suffixes and `COMMENT` lines.
- **`cdmToEncounter(cdm)`** maps the parsed message to the screener's geometry: miss distance (m→km), time-to-TCA (TCA − creation date), combined hard-body radius (per-object HBR, else a 20 m default), and a first-order combined position uncertainty `σ` from the RTN covariance of **both** objects (relative covariance `C1 + C2`; requires a full diagonal from each object, so partial/one-sided covariance never masquerades as fully-known).
- **`validateCdm(cdm)`** is the trust-boundary guard: the route calls the agent directly (there is no downstream schema), so a structurally invalid CDM (missing TCA / MISS_DISTANCE / an object designator) or a non-physical value (negative miss distance) returns **400**, rather than being silently scored into a spurious "critical" or a fail-open "clear" verdict.

The route **`POST /v1/conjunctions/cdm`** (authenticated + idempotent like every write) ingests a raw CDM, validates it, and runs the encounter through the same agent graph — so a real CDM arriving produces the same explainable, human-approval-gated proposal as any other signal.

### 5.2 The browser backend client — `src/core/backend-client.js`

The frontend ships as a zero-build vanilla-JS app that runs a full **deterministic simulation** in the browser (real orbital physics, SGP4, a client-side agent/audit/telemetry). "Connected mode" lets the same screens read a **live** backend instead. `backend-client.js` is a dependency-free ES-module client for the whole `/v1` API: proposals (list/get/approve/reject/modify), agent run, CDM screening, audit (recent/verify/export), telemetry, and the live WebSocket stream. Key properties:

- The API key is sent only as the **`x-api-key` header**, stored only in the browser's localStorage, and **never placed in a URL** (query strings leak via logs/history/Referer).
- The WebSocket uses the **ticket handshake**: `POST /v1/stream/ticket` (key in header) → short-lived HMAC ticket → open `ws://…/v1/stream?ticket=…`. The long-lived key never rides in the socket URL.
- Every failure throws a `BackendError` carrying the real HTTP status, so callers can degrade gracefully; a hard timeout via `AbortController` prevents hung requests.

### 5.3 Settings: choosing the data source — `src/pages/settings.js` §03

A new "Connected Backend" settings section lets an operator set the backend URL + API key, toggle **Simulation ↔ Connected**, and run a real **Test connection** (health, then an authenticated queue read) that reports the honest outcome — including a 401 on a bad key and a CORS/unreachable hint on a network failure. It is off by default; the app stays in the simulation until the operator explicitly connects (and both a URL and key are present, or it warns that simulation is still active).

### 5.4 Live triage on the Agent page — `src/pages/agent.js`

In connected mode, the Agent page surfaces the **live backend's triage queue** above the simulation console (additive — hidden and inert in the default demo). It lists real proposals, opens any one's full **reasoning chain** (the explainable panel) with its computed facts (Pc, Δv, propellant, miss distance), and approves or rejects it through the real HITL endpoints — then **re-verifies the tamper-evident audit chain** server-side after each write. The queue **updates live**: it subscribes to the backend event stream over the WebSocket and auto-refreshes when a new proposal lands (shown by a "· live" indicator), degrading to a manual Refresh if the socket can't open. All backend-provided data is HTML-escaped before rendering, so a compromised backend can't inject script into the operator's browser.

This is the "one OS" property: external inputs (a CDM) and live operations (the triage queue, the audit chain, streamed telemetry) live **inside** the existing screens, not in scattered tools.

---

## 6. The database

Six SQL migrations, applied in order by `backend/src/db/migrate.ts` (each runs once, inside its own transaction, tracked in a `_migrations` table — safe to run on every boot).

| # | File | What it adds |
|---|------|---|
| 001 | `001_init.sql` | `audit_log` (hash-chained entries) and `proposals` (AI suggestion + human decision) |
| 002 | `002_telemetry.sql` | `telemetry` (time-series sensor readings) + two indexes for the read paths |
| 003 | `003_multitenant.sql` | `customers` table; adds and backfills `customer_id` on all three prior tables; seeds the demo tenant; promotes the audit log's primary key to `(customer_id, seq)` so each tenant's chain restarts at 0 |
| 004 | `004_operators.sql` | `operators` table (per-operator identity, API key hashed per operator, belongs to a customer); backfills each customer's key as its "default operator" |
| 005 | `005_fk.sql` | Foreign-key constraints (`customer_id → customers.id`, cascade delete) on `proposals`, `telemetry`, `audit_log` |
| 006 | `006_idempotency.sql` | `idempotency_keys` table for safe POST retries |

### Table of tables

| Table | Stores | Key columns |
|---|---|---|
| `customers` | One row per tenant | `id`, `name`, `api_key_hash` (legacy/tenant-level key) |
| `operators` | One row per authenticated user/API key, scoped to a customer | `id`, `customer_id` (FK), `name`, `api_key_hash` |
| `proposals` | AI-suggested actions and their human decision | `id`, `customer_id` (FK), `satellite_id`, `reasoning_chain` (JSONB), `proposed_action` (JSONB), `status` (`pending`/`approved`/`rejected`/`modified`), `approved_by`, `approved_at` |
| `telemetry` | Raw sensor/health readings | `customer_id` (FK), `satellite_id`, `ts`, `subsystem`, `metric`, `value`, `quality` |
| `audit_log` | The tamper-evident event chain | `customer_id` + `seq` (composite PK), `ts`, `actor`, `action`, `payload` (JSONB), `prev_hash`, `hash` |
| `idempotency_keys` | Stored responses for retried POSTs | `customer_id` + `key` (composite PK), `status`, `body` (JSONB) |

`telemetry`'s comment notes that in production this table is meant to be promoted to a **TimescaleDB hypertable** (a Postgres extension that automatically partitions time-series tables for speed at scale) — the schema and every query already work unchanged on plain Postgres/pglite, so that promotion is additive, not a rewrite.

---

## 7. How to run and verify everything yourself

```bash
cd backend
npm install         # install dependencies
npm run migrate     # apply the 6 SQL migrations to the local database (pglite, no setup)
npm run dev          # start on http://127.0.0.1:8790 (tsx watch — auto-restarts on save)
npm test             # run the full node:test suite (in-memory pglite, no external setup)
npm run typecheck    # tsc --noEmit — verifies types with zero compiled output
```

### The 85 tests, grouped by file

| File | What it proves | Tests |
|---|---|---|
| `test/agent.test.ts` | Multi-agent graph routing (incl. the memory/RECALL node), approval lifecycle, auth requirement | 10 |
| `test/agent-evals.test.ts` | Fixture scenarios through the real graph: routing, action type, Pc ranges, determinism, and the always-pending safety invariant (CI-gated) | 9 |
| `test/conjunction.test.ts` | Probability-of-collision math and risk banding | 4 |
| `test/anomaly.test.ts` | Modified z-score (median/MAD) outlier detection | 5 |
| `test/maneuver.test.ts` | Avoidance-burn Δv + Tsiolkovsky propellant sizing | 4 |
| `test/cdm.test.ts` | CDM KVN parsing, unit mapping, one-sided-covariance guard, strict OBJECT routing, `validateCdm`, and the `/v1/conjunctions/cdm` route (incl. 400 on invalid/negative miss) | 12 |
| `test/audit.test.ts` | Hash-chain integrity, concurrent-append safety, tamper detection, per-tenant chains, export | 6 |
| `test/proposals.test.ts` | Auth requirement, approve/reject/modify, atomic no-op guards, tenant isolation, 404s, identity-from-auth, validation | 9 |
| `test/telemetry.test.ts` | Ingest, raw query, bucket downsampling, latest-per-metric, tenant isolation, validation | 6 |
| `test/stream.test.ts` | WebSocket event fan-out, tenant/satellite filtering, ticket auth | 4 |
| `test/security.test.ts` | Helmet/rate-limit headers, body-size limit, OpenAPI spec served, middleware doesn't break auth/validation | 4 |
| `test/idempotency.test.ts` | Retried POSTs don't duplicate; no key = no dedup | 3 |
| `test/observability.test.ts` | Request-id correlation, OTel no-op safety, retention purge correctness | 3 |
| `test/pagination.test.ts` | Cursor pagination covers all rows without overlap | 2 |
| `test/schema.test.ts` | FK enforcement, cascade delete | 2 |
| `test/health.test.ts` | Liveness endpoint, migration idempotency | 2 |
| **Total** | | **85** |

Run serial for a deterministic count: `node --import tsx --test --test-concurrency=1 test/*.test.ts` (parallel pglite instances can cause file-level flakiness that is not a regression). The frontend has its own gates: `npx tsc --noEmit` (the `// @ts-check` modules) and `npx eslint src/`.

### curl examples (demo tenant, key `demo-key`)

```bash
# Create a proposal via the AI agent
curl -s -X POST http://127.0.0.1:8790/v1/agent/run \
  -H "x-api-key: demo-key" -H "content-type: application/json" \
  -d '{"satelliteId":"sat-1","signals":[{"kind":"conjunction","severity":0.8}]}'

# Ingest a real CCSDS CDM (KVN) and get back the encounter + a pending proposal
curl -s -X POST http://127.0.0.1:8790/v1/conjunctions/cdm \
  -H "x-api-key: demo-key" -H "content-type: application/json" \
  -d '{"cdm":"CCSDS_CDM_VERS = 1.0\nCREATION_DATE = 2026-07-02T12:00:00.000\nTCA = 2026-07-02T15:00:00.000\nMISS_DISTANCE = 145 [m]\nOBJECT = OBJECT1\nOBJECT_DESIGNATOR = 25544\nCR_R = 10000 [m**2]\nCT_T = 40000 [m**2]\nOBJECT = OBJECT2\nOBJECT_DESIGNATOR = 33333\nCR_R = 10000 [m**2]\nCT_T = 40000 [m**2]\n"}'

# Approve it (replace :id with the proposal id from the response above)
curl -s -X POST http://127.0.0.1:8790/v1/proposals/:id/approve -H "x-api-key: demo-key"

# Verify the tamper-evident audit chain
curl -s http://127.0.0.1:8790/v1/audit/verify -H "x-api-key: demo-key"

# Export the full decision pack (JSON or CSV)
curl -s "http://127.0.0.1:8790/v1/audit/export?format=json" -H "x-api-key: demo-key"
curl -s "http://127.0.0.1:8790/v1/audit/export?format=csv" -H "x-api-key: demo-key"
```

### WebSocket ticket flow

```bash
# 1. Mint a short-lived ticket with the real API key (never put the key in the WS URL)
curl -s -X POST http://127.0.0.1:8790/v1/stream/ticket -H "x-api-key: demo-key"
# → { "ticket": "...", "expiresInMs": 60000 }

# 2. Connect the WebSocket with the ticket (any WS client), e.g.:
#    ws://127.0.0.1:8790/v1/stream?ticket=<ticket>&satelliteId=sat-1
```

### OpenAPI docs

Once the server is running: machine-readable spec at `http://127.0.0.1:8790/openapi.json`, interactive UI at `http://127.0.0.1:8790/docs`.

### Docker + real-Postgres verification

Per the git history (commit `2eb62f7`, "Track A hardening complete — live-verified on real Postgres + Docker"), the hardening work was verified live, not just "expected to work at deploy":

- All six migrations applied to a real **Postgres 16** instance running in Docker.
- The server, and separately the Docker image (`backend/Dockerfile`), were both run with `NODE_ENV=production` against that real Postgres — health check OK, API returned 200s, zero error logs.
- **15 concurrent audit appends** were sent over a real pooled Postgres connection (`backend/src/db/pg.ts`) — all 15 returned 201 Created, and `verify()` still reported the chain valid, proving the advisory-lock serialization (section 3.4) actually holds across real concurrent database connections, not just in a single in-process test.
- A negative test: booting with `NODE_ENV=production` and the default/weak `AUDIT_HMAC_KEY` was confirmed to fail startup (the guard in `config.ts`, section 3.1, actually fires).
- All 44 (at the time; now 45 with the B1 agent-graph slice) `node:test` cases were green.

The CI workflow (`.github/workflows/backend-ci.yml`) runs `npm ci`, `npm run typecheck`, and `npm test` on every push/PR touching `backend/**`.

---

## 8. Security model in plain words

| Protection | Attack it stops |
|---|---|
| API keys stored as `sha256` hash, never plaintext | A leaked database dump doesn't hand out usable credentials |
| API key only accepted via header (`x-api-key`), never a query string on normal routes | Keys leaking into server logs, browser history, or `Referer` headers |
| Short-lived signed WebSocket tickets (60s) instead of the real key in the WS URL | Even if a ticket leaks, it expires fast and can't be used to call other endpoints |
| `timingSafeEqual` for ticket and audit-hash comparisons | Timing attacks that guess a correct value byte-by-byte from response-time differences |
| Every query scoped by `customer_id`, plus DB-level foreign keys | One tenant reading or modifying another tenant's data |
| Operator identity always comes from the authenticated principal, never request body | A user typing someone else's name to fake an approval in the audit trail |
| Atomic `WHERE status = 'pending'` SQL guard on every decision | Two simultaneous approve/reject calls double-writing the audit log or corrupting state |
| Per-tenant Postgres advisory lock around audit appends | Two processes/connections both reading the same "last" audit row and forking the hash chain |
| HMAC-signed audit hashes with a required, validated production secret | Forged "valid-looking" audit entries by anyone without the secret key |
| `@fastify/helmet`, `@fastify/cors` (explicit allow-list), `@fastify/rate-limit` | Common HTTP header attacks, unwanted cross-origin calls, brute-force/DoS request floods |
| `bodyLimit` (1 MiB default) | Memory exhaustion from oversized request bodies |
| Global error handler with a fixed `{ error }` shape | Leaking stack traces, SQL text, or internal details to a client |
| LLM calls are env-gated, timeout-bound, and never change what gets executed | A missing/compromised/slow LLM provider breaking or hijacking the decision pipeline |
| Idempotency keys on POST endpoints | A client's network retry silently creating duplicate proposals or telemetry rows |

---

## 9. Interview talking points

- **Hardest problem: multi-process-safe audit serialization.** A hash chain needs a strict "read last row, compute next hash, write" sequence; naive code forks the chain the moment two processes run. Solved with a `pg_advisory_xact_lock` keyed by tenant — a database-native lock, not an application-level queue, so it holds even across multiple server processes sharing one Postgres. Proven with 15 real concurrent appends against a live pooled connection, not just unit tests.
- **Tamper-evident audit log, explained simply:** each entry's hash depends on the previous entry's hash *and* a server-only secret (HMAC), so changing history requires both rewriting every subsequent hash *and* knowing the secret — and `verify()` can point to exactly which entry broke.
- **Tenant isolation, defense in depth:** enforced twice — every query filters by `customer_id` (application layer), and the database itself enforces a foreign key (schema layer) — so a bug in one layer doesn't silently break isolation.
- **Human-in-the-loop by construction, not policy:** the AI agent graph's only side effect is creating a `pending` proposal; there is no code path from "the agent decided X" to "X happened" without a separate, authenticated human action.
- **Trade-off: pglite vs. Docker Postgres.** Development uses pglite (real Postgres SQL running in-process, no install) so `git clone && npm install && npm run dev` works instantly; production swaps in a pooled real Postgres behind the exact same `Db` interface — same SQL, same code, just a different object built by `getDb()`.
- **Trade-off: DIY vs. a heavier agent framework.** LangGraph.js provides the graph/state/checkpointing plumbing, but the LLM client itself is a small hand-written fetch wrapper (`agent/llm.ts`) rather than a heavier SDK — every line is auditable, and it's actively designed to fail safe (timeout + catch-all → `null`) rather than fail loud.
- **Trade-off: no Redis in v1.** The event bus and rate limiting are in-process/single-instance by design for now; a deliberate scope decision for v1, revisited only if real scale demands it — avoids a stateful dependency before it's needed.
- **Why WebSocket auth needed a separate mechanism:** browsers can't set custom headers during a WS handshake, so a header-only scheme (the norm for REST) doesn't reach the socket — solved with a short-lived signed ticket fetched over a normal authenticated HTTP call first.
- **Why the critic (complianceChecker) exists separately from the planner:** it lets a second, independent check (currently a fixed allow-list, extensible to real compliance rules) veto or downgrade a plan before a human ever sees it, and it's the single, contained place an LLM is allowed to add commentary — keeping the blast radius of "the LLM said something wrong" to an advisory note, never a decision.
- **Why telemetry never touches the audit log:** the audit chain is for accountable decisions (who did what, when); mixing in high-volume sensor noise would both dilute its signal and hash-chain millions of rows for no accountability benefit.
- **One-line "why X" answers:** *Why zod?* — schema validation at every input boundary with TypeScript types generated from the same schema. *Why Fastify?* — built-in JSON-schema validation and structured logging, fast enough not to be a bottleneck. *Why LangGraph over a custom loop?* — durable, inspectable state machine with first-class human-in-the-loop pause/resume semantics, not just a prompt loop.
- **"It's not a chatbot" — the strongest single point.** The decisions are real math (probability-of-collision, MAD anomaly detection, Clohessy–Wiltshire burn sizing), the LLM is advisory-only and env-gated, and every decision is deterministic and reproducible (an evals test asserts identical inputs → identical decision). Show the reasoning chain: OBSERVE → RECALL → THINK → SCORE → PLAN → CHECK → PROPOSE, each step in plain language.
- **Why I wrote a CDM parser from scratch:** a CDM (CCSDS 508.0-B-1) is the real message operators receive for a predicted conjunction; no maintained permissive JS/TS parser exists, and the parser is also a *trust boundary* — it validates and rejects malformed/non-physical input with a 400 rather than scoring garbage into a false verdict.
- **"One OS" — connected mode:** the same browser screens run a full deterministic simulation offline *or* read the live backend (real triage queue, audit chain, streamed telemetry over a WebSocket) — additive and flag-gated, so the public demo never breaks. All backend data is HTML-escaped, and the API key is never put in a URL (the WS uses a short-lived ticket).
- **How I found and fixed real bugs, not imaginary ones:** a team-review pass (independent code + security reviewers) surfaced confirmed issues — a one-sided-covariance correctness trap in the Pc math, a fail-open "clear" verdict on corrupt CDM input, and a browser event-listener leak — each fixed with a test or a live end-to-end verification, not a drive-by rewrite.

---

## 10. What's next

**Done so far:** Track A (hardening), Track B (the full multi-agent core — B1 graph, B2 real Pc + MAD anomaly math, B3 burn sizing + generator-critic, B4 agent memory, B5 evals + CI gate), Track C (CDM ingestion), and Track D (connected mode: browser client, settings, live triage, WebSocket streaming). A team code + security review of Tracks C–D found and fixed the confirmed issues; the security review found no vulnerabilities.

Remaining path toward a production deployment:

- **HITL `interrupt` in the graph** — a native LangGraph pause/resume (with the durable Postgres checkpointer) so the graph genuinely suspends mid-run awaiting approval, instead of finishing and waiting for a separate approve call. Requires the checkpointer that was deliberately deferred (section 4.1).
- **pgvector semantic memory (B4b)** — an env-gated vector-search layer so recall is semantic, not just structured over recent rows.
- **Live telemetry in the browser** — extend connected mode's WebSocket subscription to stream telemetry into the cockpit/dashboard (the client and the `telemetry` stream event already exist; this wires them to those screens).
- **Real TLE/ephemeris feeds** — wire the settings "Data Sources" section (CelesTrak is real; Space-Track/N2YO proxies are planned) to feed the live catalog.
- **Deployment & scale** — Cloudflare/edge or container deploy with managed Postgres (TimescaleDB hypertable for telemetry), a shared event bus/rate-limit store (Redis) if multi-instance, secrets management for `AUDIT_HMAC_KEY`, and CI wired to run `npm test` + `npm run evals` + `tsc` + `eslint` on every PR.
- **Operator UX polish** — CDM upload UI (paste/drag a `.cdm`), modify-proposal flow in the live triage panel, and an audit-export UX in connected mode.
