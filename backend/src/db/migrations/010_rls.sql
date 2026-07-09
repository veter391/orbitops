-- Row-Level Security policies for the tenant-DATA tables (defense-in-depth).
--
-- Application code already scopes every query with `WHERE customer_id = $1`;
-- these policies are the SECOND rubicon: if a query ever forgets the predicate,
-- Postgres itself still refuses to return another tenant's rows. A policy reads
-- the current tenant from a session variable that the request layer sets per
-- connection (`app.current_customer`, via SET LOCAL) — see src/db/rls.ts.
--
-- IMPORTANT: this migration only CREATES the policies. It does NOT enable RLS on
-- the tables, so it is completely inert until `enableRls()` runs (prod, when
-- DB_RLS=on). That keeps dev/pglite and the whole test suite unchanged: a policy
-- with RLS disabled has no effect.
--
-- The tenant comes from `current_setting('app.current_customer', true)` (missing_ok
-- = no error when unset). Postgres registers a referenced custom GUC and, once it
-- has been set in a session, resets it to the EMPTY STRING (not NULL) — and
-- `''::uuid` would raise 22P02. So we wrap it in NULLIF(..., ''): unset OR empty
-- both become NULL, `customer_id = NULL` matches no rows, and the query fails
-- closed instead of erroring.
--
-- Scope: the four tables that serve tenant DATA to request handlers. operators
-- and idempotency_keys are internal/pre-auth (the api-key lookup runs before any
-- tenant is known) and are deliberately not covered here. graph_checkpoints are
-- isolated by their thread_id prefix (see 008/checkpointer.ts).

CREATE POLICY tenant_isolation ON proposals
  USING (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid)
  WITH CHECK (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid);

-- Telemetry also allows a MAINTENANCE carve-out on reads/deletes: the retention
-- purge (src/telemetry/index.ts) is a cross-tenant system DELETE that runs with
-- no request tenant context and would otherwise match zero rows under RLS. Only
-- the system maintenance path sets app.maintenance='on' (withMaintenance); no
-- request path can (requests set only app.current_customer). WITH CHECK stays
-- tenant-only — maintenance never inserts rows.
CREATE POLICY tenant_isolation ON telemetry
  USING (
    customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid
    OR current_setting('app.maintenance', true) = 'on'
  )
  WITH CHECK (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid);

CREATE POLICY tenant_isolation ON audit_log
  USING (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid)
  WITH CHECK (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid);

CREATE POLICY tenant_isolation ON proposal_situations
  USING (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid)
  WITH CHECK (customer_id = NULLIF(current_setting('app.current_customer', true), '')::uuid);
