# OrbitOps — System Guide

This document explains, in plain language, everything built in OrbitOps so far: what it is, how the pieces fit together, how each backend module works, what the tests actually prove, and how to run and verify it yourself. It is written so the owner can understand the system deeply, check every claim against real files, and explain it confidently in a technical interview.

Every claim below is based on reading the actual source files in this repository (paths given in backticks). Nothing here is aspirational — planned-but-unbuilt work is called out explicitly in section 9.

---

## 1. What OrbitOps is

OrbitOps is an **open-source (MIT-licensed) browser-based "mission control" app for satellite operations**, paired with a **human-in-the-loop (HITL — a person must approve before anything happens) multi-agent AI backend**. The browser app (a 3D cockpit, dashboards, and flight-planning tools) runs entirely client-side with real orbital mechanics and works with zero setup ("demo mode"). The backend (Node.js + TypeScript) is a separate, optional service that adds a real API: it lets an AI reasoning pipeline propose actions (like a collision-avoidance maneuver), but every proposal sits in a "pending" state until a human operator approves, rejects, or modifies it — and every step is written into a tamper-evident audit log (a chain of records where changing any past entry breaks a cryptographic check, so tampering is provable).

The differentiator, verified against competitors in `docs/V2-PLAN.md`: existing open-source mission-control tools (NASA OpenMCT, Yamcs, OpenC3 COSMOS) have no AI copilot, and existing AI-ops products (Cognitive Space, Neuraspace, Kayhan Space) are closed-source SaaS. OrbitOps is positioned as the first open-source, auditable, human-in-the-loop AI copilot for this space.

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

**"Demo mode always works; connected mode is opt-in."** This is a binding product rule (`docs/V2-PLAN.md`, principle 4): the browser app must keep working with no backend at all — it ships its own deterministic orbital math, a bundled offline satellite catalog, and scripted AI demo scenarios. The backend, when present, is an additive layer the browser can optionally talk to over HTTP/WebSocket for real persistence, a real (non-scripted) agent run, and a real audit trail. Breaking the frontend to add backend features is explicitly disallowed.

---

## 3. The backend, piece by piece

The backend is a single Node.js + TypeScript service built on **Fastify** (a fast HTTP framework with built-in schema validation and logging). It is built in small, reviewed, tested vertical "slices" — each one is a git commit (see the Definition of Done in section 6).

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

**Multi-process safety (advisory-lock serialization) — why it matters:** appending requires reading "what's the last sequence number and hash for this tenant," then writing the next one. If two requests do this at the same moment (two backend processes, or two pooled database connections), they could both read the same "last" row and both try to insert the same next sequence number — corrupting or forking the chain. This is fixed at the database level, not just in application code: `#appendOne()` wraps the read-then-write in a SQL transaction that starts with `SELECT pg_advisory_xact_lock(hashtext($1))` keyed by `customerId`. A **Postgres advisory lock** is a lock the database grants on request (not tied to any table) — this one is a *transaction-scoped* lock, held only until the transaction ends, so a second transaction for the same tenant blocks until the first fully commits or rolls back. This makes the chain safe even when the whole app is scaled to multiple processes talking to the same Postgres — which local single-process tools like an in-memory queue could never guarantee. `test/audit.test.ts` includes *"concurrent appends do not fork the chain"*, and per the git history and `docs/V2-PLAN.md` this was additionally verified live with 15 concurrent appends against a real Postgres 16 connection pool (all 201, chain still valid).

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

An **idempotency key** lets a client safely retry a `POST` (e.g., after a network timeout where it's unclear if the first request succeeded) without creating a duplicate. The client sends an `Idempotency-Key` header; `idempotent()` checks the `idempotency_keys` table (`customer_id, key` as primary key, migration `006_idempotency.sql`) for a previously stored response. If found, it returns the exact same `{status, body}` instead of re-running the operation; if not, it runs the operation once and stores the result. Wired onto exactly three routes — `POST /v1/proposals`, `POST /v1/telemetry`, and `POST /v1/agent/run` (the *creation* endpoints, where a retry would otherwise duplicate data). The decision routes (`approve`/`reject`/`modify`) don't need idempotency keys: their atomic `WHERE status = 'pending'` guard already makes any retry a harmless no-op that returns the current state. The code comment is honest about a limit: this dedupes *sequential* retries, not truly concurrent simultaneous requests with the same key (that would need a lock, not just a lookup-then-insert).

### 3.9 Security middleware, error shape, CORS — `backend/src/server.ts`

Registered on every request, in this order: `@fastify/helmet` (sets defensive HTTP response headers, e.g. against clickjacking/MIME-sniffing), `@fastify/cors` (Cross-Origin Resource Sharing — controls which websites are allowed to call this API from a browser; empty `CORS_ORIGINS` means same-origin only, no cross-origin calls allowed at all), and `@fastify/rate-limit` (caps requests per IP per time window — `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`, defaults 300/minute — to blunt brute-force and denial-of-service attempts). `bodyLimit` (default 1 MiB) rejects oversized request bodies with a clean 413 rather than letting the process exhaust memory. A global `setErrorHandler` guarantees every error response has the same shape (`{ error: string }`), maps any unexpected error to a generic `internal error` message, and never leaks stack traces or SQL text to the client — details go to the server log instead, tagged by severity.

### 3.10 Correlation IDs + OpenTelemetry — `backend/src/observability.ts`, `backend/src/server.ts`

Every request gets a **correlation ID** (aka request ID): either the inbound `X-Request-Id` header (if a reasonable length) or a freshly generated UUID, attached to `req.id`, echoed back in the response header, and included on every log line for that request (further enriched with `customerId`/`operatorId` once auth resolves — section 3.2). This lets someone trace one request's full story across every log line it touched, and lets a client quote the ID back when reporting an incident.

**OpenTelemetry** (an industry-standard tracing library — it records "spans," which are timed, named units of work, e.g. "this database call took 12ms") is wired up but **env-gated**: `initTracing()` only starts the SDK and exports spans if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it, `@opentelemetry/api`'s tracer is a documented no-op, so `withSpan()` costs essentially nothing and the whole service runs fully offline by default. Spans are recorded around `audit.append`, `telemetry.ingest`, and `agent.graph.run` — the exact path from an AI suggestion to a signed audit entry — so a real deployment can trace that path end-to-end in a tool like Jaeger.

### 3.11 OpenAPI docs — `backend/src/server.ts`

`@fastify/swagger` generates an **OpenAPI spec** (a standard machine-readable description of an HTTP API — its routes, parameters, and auth) automatically, served at `GET /openapi.json`; `@fastify/swagger-ui` serves an interactive human-browsable version at `/docs`. The spec documents the `x-api-key` header as the security scheme. Both are public routes (no auth needed to *view* the docs) — the underlying `/v1/*` routes still require the real key.

---

## 4. The multi-agent AI core (B1)

This is the newest and most distinctive part of the backend: a real multi-agent system built with **LangGraph.js** (`@langchain/langgraph`) — a library for building "graphs" of steps (nodes) an AI pipeline moves through, with built-in support for pausing/resuming and inspecting state at each step. Files: `backend/src/agents/rules.ts` (the deterministic safety core), `backend/src/agents/graph.ts` (the graph), `backend/src/agent/index.ts` (a thin public facade), `backend/src/agent/llm.ts` (the optional LLM call).

### 4.1 The graph, node by node

Entry point: `POST /v1/agent/run` with a `satelliteId` and a list of `signals` (e.g., `{ kind: 'conjunction', severity: 0.8 }`). The graph (`buildAgentGraph()` in `graph.ts`) runs these nodes in order:

| Node | Role | What it does |
|---|---|---|
| **supervisor** | Router | Looks at the *kinds* of incoming signals and picks a route: `conjunctionScreener` if any signal is a `conjunction` kind, `anomalyTriager` if any is a known anomaly kind (battery/thermal/attitude/comms), else `investigate` (fallback). |
| **conjunctionScreener** / **anomalyTriager** / **investigate** | Specialists (share one function body, different framing text) | Score every incoming signal against a rulebook (`scoreCandidates()` in `rules.ts`) — `score = baseSeverity × likelihood` — and pick the top-scoring hypothesis. |
| **maneuverPlanner** | Planner | Turns the winning hypothesis's rule (e.g., "predicted close approach" → `{ type: 'maneuver', profile: 'avoidance_burn' }`) into a concrete planned action for that satellite. |
| **complianceChecker** | Critic | Checks the planned action's `type` against `KNOWN_ACTIONS` (a fixed allow-list: `maneuver`, `load_shed`, `thermal_mitigation`, `attitude_correction`, `link_handoff`, `investigate`). Unrecognized action types are downgraded to `investigate` rather than being proposed as-is. This is also the one node that optionally calls an LLM (see 4.2). |
| **proposalDrafter** | Writer | Produces the human-readable "recommend action: X, awaiting operator approval" line for the reasoning chain. |
| **persist** | Gate | Calls `proposals.create()` — the *only* place anything is actually written to the database, and it always writes status `pending`. |

Every node also appends a `ChainStep` (`{ phase, agent, text }`) describing what it did in plain language — this becomes the proposal's `reasoningChain`, visible to the human operator as the "why" behind a suggestion. The graph is deliberately compiled **without** a checkpointer: every run is single-shot (start → end, never resumed), so keeping per-run state snapshots in memory would only accumulate forever under load. A durable Postgres checkpointer arrives with B3's human-in-the-loop `interrupt`, where pausing and resuming mid-graph genuinely needs saved state.

**Reasoning-chain phases**, in order: `OBSERVE` (supervisor notes what came in and where it's routing) → `THINK` (specialist lists candidate hypotheses) → `SCORE` (specialist's top pick and its score) → `PLAN` (planner's concrete action) → `CHECK` (critic's compliance verdict) → optionally `AI` (the LLM's advisory note, if enabled) → `PROPOSE` (drafter's final recommendation).

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

---

## 5. The database

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

## 6. How to run and verify everything yourself

```bash
cd backend
npm install         # install dependencies
npm run migrate     # apply the 6 SQL migrations to the local database (pglite, no setup)
npm run dev          # start on http://127.0.0.1:8790 (tsx watch — auto-restarts on save)
npm test             # run the full node:test suite (in-memory pglite, no external setup)
npm run typecheck    # tsc --noEmit — verifies types with zero compiled output
```

### The 45 tests, grouped by file

| File | What it proves | Tests |
|---|---|---|
| `test/agent.test.ts` | Multi-agent graph routing, approval lifecycle, auth requirement | 5 |
| `test/audit.test.ts` | Hash-chain integrity, concurrent-append safety, tamper detection, per-tenant chains, export | 5 |
| `test/health.test.ts` | Liveness endpoint, migration idempotency | 2 |
| `test/idempotency.test.ts` | Retried POSTs don't duplicate; no key = no dedup | 3 |
| `test/observability.test.ts` | Request-id correlation, OTel no-op safety, retention purge correctness | 3 |
| `test/pagination.test.ts` | Cursor pagination covers all rows without overlap | 2 |
| `test/proposals.test.ts` | Auth requirement, approve/reject/modify, atomic no-op guards, tenant isolation, 404s, identity-from-auth, validation | 9 |
| `test/schema.test.ts` | FK enforcement, cascade delete | 2 |
| `test/security.test.ts` | Helmet/rate-limit headers, body-size limit, OpenAPI spec served, middleware doesn't break auth/validation | 4 |
| `test/stream.test.ts` | WebSocket event fan-out, tenant/satellite filtering, ticket auth | 4 |
| `test/telemetry.test.ts` | Ingest, raw query, bucket downsampling, latest-per-metric, tenant isolation, validation | 6 |
| **Total** | | **45** |

### curl examples (demo tenant, key `demo-key`)

```bash
# Create a proposal via the AI agent
curl -s -X POST http://127.0.0.1:8790/v1/agent/run \
  -H "x-api-key: demo-key" -H "content-type: application/json" \
  -d '{"satelliteId":"sat-1","signals":[{"kind":"conjunction","severity":0.8}]}'

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

Per `docs/V2-PLAN.md` (§6, Track A) and the git history (commit `2eb62f7`, "Track A hardening complete — live-verified on real Postgres + Docker"), the hardening work was verified live, not just "expected to work at deploy":

- All six migrations applied to a real **Postgres 16** instance running in Docker.
- The server, and separately the Docker image (`backend/Dockerfile`), were both run with `NODE_ENV=production` against that real Postgres — health check OK, API returned 200s, zero error logs.
- **15 concurrent audit appends** were sent over a real pooled Postgres connection (`backend/src/db/pg.ts`) — all 15 returned 201 Created, and `verify()` still reported the chain valid, proving the advisory-lock serialization (section 3.4) actually holds across real concurrent database connections, not just in a single in-process test.
- A negative test: booting with `NODE_ENV=production` and the default/weak `AUDIT_HMAC_KEY` was confirmed to fail startup (the guard in `config.ts`, section 3.1, actually fires).
- All 44 (at the time; now 45 with the B1 agent-graph slice) `node:test` cases were green.

The CI workflow (`.github/workflows/backend-ci.yml`) runs `npm ci`, `npm run typecheck`, and `npm test` on every push/PR touching `backend/**`.

---

## 7. Security model in plain words

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

## 8. Interview talking points

- **Hardest problem: multi-process-safe audit serialization.** A hash chain needs a strict "read last row, compute next hash, write" sequence; naive code forks the chain the moment two processes run. Solved with a `pg_advisory_xact_lock` keyed by tenant — a database-native lock, not an application-level queue, so it holds even across multiple server processes sharing one Postgres. Proven with 15 real concurrent appends against a live pooled connection, not just unit tests.
- **Tamper-evident audit log, explained simply:** each entry's hash depends on the previous entry's hash *and* a server-only secret (HMAC), so changing history requires both rewriting every subsequent hash *and* knowing the secret — and `verify()` can point to exactly which entry broke.
- **Tenant isolation, defense in depth:** enforced twice — every query filters by `customer_id` (application layer), and the database itself enforces a foreign key (schema layer) — so a bug in one layer doesn't silently break isolation.
- **Human-in-the-loop by construction, not policy:** the AI agent graph's only side effect is creating a `pending` proposal; there is no code path from "the agent decided X" to "X happened" without a separate, authenticated human action.
- **Trade-off: pglite vs. Docker Postgres.** Development uses pglite (real Postgres SQL running in-process, no install) so `git clone && npm install && npm run dev` works instantly; production swaps in a pooled real Postgres behind the exact same `Db` interface — same SQL, same code, just a different object built by `getDb()`.
- **Trade-off: DIY vs. a heavier agent framework.** LangGraph.js provides the graph/state/checkpointing plumbing, but the LLM client itself is a small hand-written fetch wrapper (`agent/llm.ts`) rather than a heavier SDK — every line is auditable, and it's actively designed to fail safe (timeout + catch-all → `null`) rather than fail loud.
- **Trade-off: no Redis in v1.** The event bus and rate limiting are in-process/single-instance by design for now; documented as a deliberate scope line in `docs/V2-PLAN.md`, revisited only if real scale demands it — avoids a stateful dependency before it's needed.
- **Why WebSocket auth needed a separate mechanism:** browsers can't set custom headers during a WS handshake, so a header-only scheme (the norm for REST) doesn't reach the socket — solved with a short-lived signed ticket fetched over a normal authenticated HTTP call first.
- **Why the critic (complianceChecker) exists separately from the planner:** it lets a second, independent check (currently a fixed allow-list, extensible to real compliance rules) veto or downgrade a plan before a human ever sees it, and it's the single, contained place an LLM is allowed to add commentary — keeping the blast radius of "the LLM said something wrong" to an advisory note, never a decision.
- **Why telemetry never touches the audit log:** the audit chain is for accountable decisions (who did what, when); mixing in high-volume sensor noise would both dilute its signal and hash-chain millions of rows for no accountability benefit.
- **One-line "why X" answers:** *Why zod?* — schema validation at every input boundary with TypeScript types generated from the same schema. *Why Fastify?* — built-in JSON-schema validation and structured logging, fast enough not to be a bottleneck. *Why LangGraph over a custom loop?* — durable, inspectable state machine with first-class human-in-the-loop pause/resume semantics, not just a prompt loop.

---

## 9. What's next

Per `docs/V2-PLAN.md` section 6 ("Execution — tracks, slices, team review"), Track A (hardening) and B1 (agent-graph scaffolding) are done; the rest of the roadmap:

- **B2** — Add the real Supervisor + deterministic ConjunctionScreener/AnomalyTriager domain logic (today's rulebook is a first pass; B2 deepens the actual orbital/anomaly math behind it).
- **B3** — ManeuverPlanner + ComplianceChecker as a true generator-critic pair, plus a native LangGraph HITL `interrupt` (pause mid-graph for approval, then resume with the same state) instead of always finishing the graph and waiting for an external approve call.
- **B4** — Long-term agent memory using pgvector (a vector-search extension for Postgres) on pglite/Postgres, so the supervisor and specialists can recall prior operator decisions.
- **B5** — An evals harness (automated test cases with known-correct answers) gating CI on agent output quality and on the invariant "never auto-executes an irreversible action."
- **Track C** — Real conjunction-data-message (CDM) ingest, probability-of-collision math, and an explainable maneuver decision-support UI (evidence, contrastive reasoning, uncertainty, reversible preview).
- **Track D** — Frontend "connected mode" wiring: a conjunction triage queue, an explainable-decision panel, and an audit-export UX in the browser app — additive, never breaking demo mode.
