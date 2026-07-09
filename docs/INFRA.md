# Infrastructure & Scale (Track I)

How OrbitOps hardens and scales from the single-node open-source build to a
multi-tenant hosted tier. Some of this is **already in the code** (behind flags);
the rest is **deploy-time** and depends on the target host / vendor, so it is
specified here precisely rather than stubbed in code that can't be exercised
until those choices are made.

Status legend: **[in code]** shipped, flag-gated · **[deploy]** turnkey once the
host is chosen · **[business]** process, not code.

---

## 1. Row-Level Security — tenant isolation at the DB [in code]

Application code already scopes every query with `WHERE customer_id = $1` (100%
coverage). RLS is the **second rubicon**: if a query ever forgets the predicate,
Postgres itself refuses to return another tenant's rows.

- Policies: [`010_rls.sql`](../backend/src/db/migrations/010_rls.sql) — a
  `tenant_isolation` policy on the four tenant-DATA tables (`proposals`,
  `telemetry`, `audit_log`, `proposal_situations`). Created but inert until enabled.
- Enable + tenant binding: [`rls.ts`](../backend/src/db/rls.ts) — `enableRls()`
  (idempotent, run at boot when `DB_RLS=on`) and `rlsScopedDb()`, which sets
  `app.current_customer` (via `SET LOCAL`) per request from the
  [tenant context](../backend/src/db/tenant-context.ts) the auth hook pins.
- Proof: [`rls.test.ts`](../backend/test/rls.test.ts) — cross-tenant reads return
  the caller's rows only, an unset context fails closed (zero rows), and the
  `WITH CHECK` policy refuses inserting another tenant's row.

**Deploy requirement (critical): connect as a non-superuser role.** Postgres
superusers *bypass RLS entirely*, even with `FORCE`. So RLS protects nothing if
the app connects as `postgres`. On the managed database:

```sql
-- One-time, as the DB owner/superuser:
CREATE ROLE orbitops_app LOGIN PASSWORD '<from-secret-manager>' NOSUPERUSER;
GRANT CONNECT ON DATABASE orbitops TO orbitops_app;
GRANT USAGE ON SCHEMA public TO orbitops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orbitops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orbitops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orbitops_app;
```

Run **migrations as the owner** (DDL + the customer_id backfill), then point the
running app's `DATABASE_URL` at `orbitops_app` and set `DB_RLS=on`. Dev/pglite is
a single superuser connection, so leave `DB_RLS` off there (it would be a no-op
anyway).

---

## 2. Managed Postgres / TimescaleDB [deploy]

The `Db` abstraction ([`db/index.ts`](../backend/src/db/index.ts)) already
switches to a pooled `pg.Pool` when `DATABASE_URL` is set, so moving off pglite is
config, not code.

- **Provider:** any managed Postgres (Neon, Supabase, RDS, Cloud SQL, Timescale
  Cloud). Pick one; set `DATABASE_URL` (or `DATABASE_URL_FILE`) to the
  `orbitops_app` role.
- **TimescaleDB for telemetry:** the `telemetry` table is the only high-volume,
  time-series table. On a Timescale-capable instance, promote it to a hypertable
  and replace the boot-time retention purge
  ([`index.ts`](../backend/src/index.ts) `TELEMETRY_RETENTION_DAYS`) with a native
  policy:
  ```sql
  SELECT create_hypertable('telemetry', 'ts', migrate_data => true);
  SELECT add_retention_policy('telemetry', INTERVAL '90 days');
  ```
  Nothing above the `Db` interface changes.
- **Pooling:** for serverless/edge runtimes, front the pool with PgBouncer (or the
  provider's pooler) in *transaction* mode — compatible with our per-request
  `SET LOCAL` tenant binding because it stays within one transaction.

---

## 3. Redis pub/sub — multi-instance events [deploy]

The [`EventBus`](../backend/src/events/index.ts) is in-process: events emitted on
one node are invisible to WebSocket clients connected to another. Single-instance
is correct today; horizontal scale needs a shared broker.

The publish/subscribe surface (`emit<K>` / `on<K>`) is deliberately transport-
agnostic, so the drop-in is a Redis-backed implementation of that same surface —
**no change to callers** (`proposals`, `telemetry`, `routes/stream`):

- Publish → `PUBLISH orbitops:events <json>`; each node subscribes and re-emits
  locally to its own WebSocket subscribers.
- Keep the existing per-connection `customerId` filter in
  [`stream.ts`](../backend/src/routes/stream.ts) — tenancy stays enforced at fan-out.
- Gate on a `REDIS_URL` env (absent → in-process, as today).

Left as a deploy step rather than a stub because it can't be meaningfully tested
without a broker, and the seam it plugs into already exists.

---

## 4. Secrets management [in code + deploy]

- **File-backed secrets [in code]:** `AUDIT_HMAC_KEY`, `OPENROUTER_API_KEY`, and
  `DATABASE_URL` accept a `<NAME>_FILE` path (Docker/K8s/Cloudflare secret mounts)
  instead of an inline env string — see
  [`resolveSecretsFromFiles`](../backend/src/config.ts). The file wins over inline;
  an empty file fails closed.
- **Audit key policy [in code]:** production refuses to boot with the dev-default
  or a weak (<32 char) `AUDIT_HMAC_KEY` ([`config.ts`](../backend/src/config.ts)).
- **[deploy]** Store `AUDIT_HMAC_KEY`, the DB password, and `OPENROUTER_API_KEY`
  in the platform secret manager (Cloudflare secrets, AWS/GCP Secret Manager, K8s
  `Secret`), mounted as files or env. Rotate `AUDIT_HMAC_KEY` only with a documented
  re-anchor of the hash chain (the chain is per-key).

---

## 5. SSO / RBAC — hosted tier [deploy / business]

Today: per-operator API keys with a per-request principal
([`auth/index.ts`](../backend/src/auth/index.ts)) and a single choke point where
`req.customerId` / `req.operatorId` are pinned — the natural place to attach both
below.

- **SSO (OIDC):** validate the IdP's JWT in the auth hook and resolve it to an
  operator/customer, in place of (or alongside) the api-key lookup. Provider-gated
  (Okta / Entra / Google Workspace / Auth0) — the token-verification path is small
  and drops into the existing hook; the choice of IdP is the customer's.
- **RBAC:** add `operators.role` (`viewer` | `operator` | `admin`) and a
  `requireRole()` preHandler that reads `req.operatorRole`. The **role → permission
  matrix is a product decision** (e.g. viewers read-only; only operators approve
  proposals; only admins manage operators), so it is specified with the customer at
  onboarding rather than hard-coded here. The enforcement point (the auth hook +
  a preHandler guard) is one small, well-defined addition once that matrix is set.

---

## 6. CI / quality gates [in code]

[`backend-ci.yml`](../.github/workflows/backend-ci.yml) runs, on every push/PR
touching `backend/**`: `lint` (ESLint) → `typecheck` (`tsc --noEmit`) → `test`
(unit) → `evals` (agent-quality suite). A lint, type, unit, or agent-quality
regression blocks merge.

---

## 7. SOC 2 [business]

Not code. The technical controls SOC 2 leans on already exist and map cleanly:
tamper-evident audit chain (HMAC), least-privilege DB role (§1), secret management
(§4), encrypted transport (TLS at the edge), and change control (CI gates §6, PR
review). SOC 2 itself is the audit + policy process (access reviews, vendor
management, incident response) run with an auditor when the business pursues it.
