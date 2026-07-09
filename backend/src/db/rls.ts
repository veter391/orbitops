import type { Db, DbTx } from './index.js';
import { currentTenant } from './tenant-context.js';

/**
 * Row-Level Security wiring. The policies live in migration 010 (inert until
 * enabled); this module turns them on in production and binds the per-request
 * tenant to the Postgres session variable the policies read.
 *
 * The security-critical pieces (enableRls + the SET-LOCAL scoping) are unit
 * tested against real Postgres (pglite) in test/rls.test.ts, independent of the
 * DB_RLS boot flag, so the isolation guarantee is proven, not asserted.
 *
 * DEPLOY REQUIREMENT: Postgres SUPERUSERS bypass RLS entirely (even with FORCE).
 * So RLS only protects anything when the app connects as a NON-superuser role
 * that owns no more than it needs. In prod, point DATABASE_URL at a dedicated
 * app role (not `postgres`) and set DB_RLS=on. See docs/INFRA.md.
 */

/** Tenant-DATA tables guarded by RLS. Fixed allow-list — never interpolated from input. */
export const RLS_TABLES = ['proposals', 'telemetry', 'audit_log', 'proposal_situations'] as const;

const SET_TENANT = `SELECT set_config('app.current_customer', $1, true)`;

/** Enable + FORCE Row-Level Security on every guarded table. Idempotent. */
export async function enableRls(db: Db): Promise<void> {
  for (const table of RLS_TABLES) {
    // FORCE so the table owner (the app's own role) is subject to the policies
    // too — otherwise an owner connection would silently bypass isolation.
    await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await db.exec(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }
}

/**
 * Run `fn` in a transaction scoped to `customerId`: `set_config(..., true)` sets
 * the session variable LOCAL to the transaction, so RLS policies see this tenant
 * and only this tenant for the duration, and it is cleared on commit/rollback.
 */
export async function withTenant<T>(db: Db, customerId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(SET_TENANT, [customerId]);
    return fn(tx);
  });
}

/**
 * Wrap a base Db so every query made inside a request's tenant context runs with
 * the tenant session variable set (inside a one-shot transaction). Queries with
 * NO ambient tenant (system/pre-auth work) pass straight through — those never
 * touch the RLS-guarded tables. Applied only when DB_RLS is on, so the default
 * path keeps the base adapter's behavior and cost.
 *
 * Semantics/cost when active: each `query()` becomes its own BEGIN/SET LOCAL/
 * COMMIT (a deliberate per-request cost, not accidental N+1). Two separate
 * `query()` calls are therefore each their own transaction — exactly as they are
 * under autocommit today, so nothing that needs atomicity regresses; code that
 * needs it already uses `transaction()`, which here runs the whole callback in
 * ONE transaction with the tenant set once.
 */
export function rlsScopedDb(base: Db): Db {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const tenant = currentTenant();
      if (!tenant) return base.query<T>(sql, params);
      return base.transaction(async (tx) => {
        await tx.query(SET_TENANT, [tenant]);
        return tx.query<T>(sql, params);
      });
    },
    exec(sql: string) {
      return base.exec(sql);
    },
    async transaction<T>(fn: (tx: DbTx) => Promise<T>) {
      const tenant = currentTenant();
      return base.transaction(async (tx) => {
        if (tenant) await tx.query(SET_TENANT, [tenant]);
        return fn(tx);
      });
    },
    close() {
      return base.close();
    },
  };
}
