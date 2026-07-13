# OrbitOps backend

Node + TypeScript monolith (Fastify) implementing the server side of OrbitOps:
audit log, proposals, telemetry, a live event stream, multi-tenant isolation,
and the AI agent loop. Decoupled from the browser app — the static frontend runs
fully in demo mode without it.

Built in vertical slices; see [../docs/SYSTEM-GUIDE.md](../docs/SYSTEM-GUIDE.md) for the full, file-by-file walkthrough.

## Run it

```bash
cd backend
npm install
npm run migrate   # apply SQL migrations to the local database
npm run dev       # start on http://127.0.0.1:8790 (tsx watch)
npm test          # node:test suite (in-memory database, no setup)
npm run typecheck # tsc --noEmit
```

No Docker, cloud, or accounts required. The database is
[pglite](https://github.com/electric-sql/pglite) — real Postgres SQL running
in-process, persisted under `backend/.data/` (gitignored). Production swaps in a
managed Postgres + TimescaleDB behind the same `db` abstraction.

## Auth

Every `/v1/*` route needs an API key: header `x-api-key: <key>`, or `?apiKey=<key>`
for the WebSocket (browsers can't set WS headers). Migration 003 seeds a demo
tenant with key **`demo-key`**. `/health` is public.

```bash
curl -H "x-api-key: demo-key" http://127.0.0.1:8790/v1/proposals
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness + database check (public) |
| POST | `/v1/agent/run` | Run the agent loop → a pending, audited proposal |
| GET/POST | `/v1/proposals` | List / create proposals |
| GET | `/v1/proposals/:id` | Fetch one |
| POST | `/v1/proposals/:id/{approve,reject,modify}` | Operator decision (guarded) |
| POST/GET | `/v1/telemetry` | Ingest batch / query (range, `bucketSeconds` downsampling) |
| GET | `/v1/telemetry/latest` | Newest reading per metric |
| GET/POST | `/v1/audit` | Recent entries / append |
| GET | `/v1/audit/verify` | Re-verify the tenant's hash chain |
| GET | `/v1/audit/export?format=json\|csv` | Export the decision pack |
| WS | `/v1/stream` | Live telemetry + proposal events (`?satelliteId=` filter) |

## Configuration

Environment variables (all optional; sane local defaults in `src/config.ts`).
Notable: `AUDIT_HMAC_KEY` signs the audit chain (change outside local), and
`OPENROUTER_API_KEY` optionally enables LLM augmentation of the agent (unset =
fully deterministic, offline). Similarity memory is off unless `AGENT_SEMANTIC_MEMORY=true`.

**Secrets via files.** For orchestrators that mount secrets as files (Docker
`--secret`, Kubernetes `Secret` volumes, Cloudflare), set `<NAME>_FILE` to the
path instead of putting the value in an env string that leaks into process
listings and `docker inspect`. Supported for `AUDIT_HMAC_KEY`, `OPENROUTER_API_KEY`,
and `DATABASE_URL` — e.g. `AUDIT_HMAC_KEY_FILE=/run/secrets/audit_hmac_key`. The
file wins over the inline var; an empty file is refused (fail closed).
