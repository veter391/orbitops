import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context. The auth layer pins the authenticated customer id
 * here once per request; the RLS-aware Db adapter (rls.ts) reads it to set the
 * Postgres session variable that Row-Level Security policies check. Using
 * AsyncLocalStorage means nothing in between has to thread a customerId through
 * — the value follows the async call chain of the request automatically.
 */
const tenantStore = new AsyncLocalStorage<string | undefined>();

/** Run `fn` with `customerId` as the ambient tenant (callback form). */
export function runWithTenant<T>(customerId: string, fn: () => T): T {
  return tenantStore.run(customerId, fn);
}

/**
 * Pin `customerId` as the ambient tenant for the rest of the current async
 * context (hook form — used from a Fastify onRequest hook, where there is no
 * single callback wrapping the whole request).
 */
export function enterTenant(customerId: string): void {
  tenantStore.enterWith(customerId);
}

/**
 * Reset the ambient tenant to "none" for the current context. `enterWith` mutates
 * the active context in place and does NOT auto-restore, so the auth hook calls
 * this UNCONDITIONALLY at the very top of every request — otherwise a request that
 * never authenticates (a public route, a 401) could inherit a previous
 * authenticated request's tenant off a reused continuation. Cleared → no tenant →
 * RLS fails closed (zero rows).
 */
export function clearTenant(): void {
  tenantStore.enterWith(undefined);
}

/** The ambient tenant, or undefined outside any request (system/pre-auth work). */
export function currentTenant(): string | undefined {
  return tenantStore.getStore();
}
