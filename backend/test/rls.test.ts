import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, createCustomer, DEMO_ID } from './helpers.js';
import { enableRls, withTenant, rlsScopedDb, RLS_TABLES } from '../src/db/rls.js';
import { runWithTenant, enterTenant, clearTenant, currentTenant } from '../src/db/tenant-context.js';
import type { Db, DbTx } from '../src/db/index.js';

test('tenant context: clearTenant resets so a later request never inherits a prior tenant', () => {
  enterTenant('tenant-A');
  assert.equal(currentTenant(), 'tenant-A');
  // The auth hook calls clearTenant() first on every request. After it, an
  // unauthenticated request sees no tenant (RLS fails closed), not tenant-A.
  clearTenant();
  assert.equal(currentTenant(), undefined);
});

test('tenant context: runWithTenant is scoped and does not leak out', () => {
  clearTenant();
  const inside = runWithTenant('tenant-B', () => currentTenant());
  assert.equal(inside, 'tenant-B');
  assert.equal(currentTenant(), undefined, 'the tenant does not persist after the callback');
});

test('rlsScopedDb sets the tenant and the query in ONE transaction (same connection), else passes through', async () => {
  const calls: string[] = [];
  // A fake base Db that records the call sequence — proves the wrapper's contract
  // (SET LOCAL and the query share one transaction/connection) without needing a
  // real pg.Pool, so a future pg.ts refactor that broke connection identity would
  // be caught here too.
  const fakeBase: Db = {
    async query<T = Record<string, unknown>>(sql: string) {
      calls.push(`q:${sql}`);
      return [] as T[];
    },
    async exec() {},
    async transaction<T>(fn: (tx: DbTx) => Promise<T>) {
      calls.push('BEGIN');
      const tx: DbTx = {
        async query<R = Record<string, unknown>>(sql: string, params?: unknown[]) {
          calls.push(`tx:${sql}${params ? `|${JSON.stringify(params)}` : ''}`);
          return [] as R[];
        },
      };
      const r = await fn(tx);
      calls.push('COMMIT');
      return r;
    },
    async close() {},
  };

  const scoped = rlsScopedDb(fakeBase);
  await runWithTenant('cust-Z', () => scoped.query('SELECT 1'));
  assert.deepEqual(calls, [
    'BEGIN',
    `tx:SELECT set_config('app.current_customer', $1, true)|["cust-Z"]`,
    'tx:SELECT 1|[]',
    'COMMIT',
  ]);

  clearTenant();
  calls.length = 0;
  await scoped.query('SELECT 2');
  assert.deepEqual(calls, ['q:SELECT 2'], 'no tenant → straight passthrough, no transaction');
});

// RLS is bypassed by Postgres SUPERUSERS, and pglite connects as one — exactly as
// a naive prod deploy would. To test (and to be safe in prod) the app must run as
// a NON-superuser role. This mirrors that: create `app_user`, grant it the table
// DML, and SET ROLE to it for the rest of the session so policies actually apply.
async function useAppRole(db: Db): Promise<void> {
  await enableRls(db);
  await db.exec(`CREATE ROLE app_user NOSUPERUSER`);
  await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${RLS_TABLES.join(', ')} TO app_user`);
  await db.exec(`SET ROLE app_user`);
}

async function seedProposal(db: Db, customerId: string, sat: string): Promise<void> {
  await withTenant(db, customerId, (tx) =>
    tx.query(`INSERT INTO proposals (customer_id, satellite_id, proposed_action) VALUES ($1, $2, '{}'::jsonb)`, [
      customerId,
      sat,
    ]),
  );
}

test('enableRls is idempotent (safe to run on every boot)', async () => {
  const db = await freshDb();
  try {
    await enableRls(db);
    await enableRls(db); // must not throw the second time
  } finally {
    await db.close();
  }
});

test('RLS policy blocks cross-tenant reads even without a WHERE clause', async () => {
  const db = await freshDb();
  try {
    const other = await createCustomer(db, 'other-co', 'other-key'); // as superuser, before SET ROLE
    await useAppRole(db);
    await seedProposal(db, DEMO_ID, 'SAT-A');
    await seedProposal(db, other, 'SAT-B');

    // Deliberately UNSCOPED (no WHERE customer_id) — RLS must still hide the other
    // tenant. Each tenant context sees exactly its own row.
    const asDemo = await withTenant(db, DEMO_ID, (tx) => tx.query(`SELECT satellite_id FROM proposals`));
    assert.equal(asDemo.length, 1);
    assert.equal((asDemo[0] as { satellite_id: string }).satellite_id, 'SAT-A');

    const asOther = await withTenant(db, other, (tx) => tx.query(`SELECT satellite_id FROM proposals`));
    assert.equal(asOther.length, 1);
    assert.equal((asOther[0] as { satellite_id: string }).satellite_id, 'SAT-B');
  } finally {
    await db.close();
  }
});

test('with RLS on and NO tenant context, guarded tables return zero rows (fail closed)', async () => {
  const db = await freshDb();
  try {
    await createCustomer(db, 'seed-co', 'seed-key');
    await useAppRole(db);
    await seedProposal(db, DEMO_ID, 'SAT-A');
    // No session variable set → current_setting(...,true) is NULL → matches nothing.
    const rows = await db.query(`SELECT satellite_id FROM proposals`);
    assert.equal(rows.length, 0);
  } finally {
    await db.close();
  }
});

test('the WITH CHECK policy refuses inserting another tenant’s row', async () => {
  const db = await freshDb();
  try {
    const other = await createCustomer(db, 'other-co', 'other-key');
    await useAppRole(db);
    // In DEMO's context, try to insert a row owned by `other` → policy rejects.
    await assert.rejects(
      withTenant(db, DEMO_ID, (tx) =>
        tx.query(`INSERT INTO proposals (customer_id, satellite_id, proposed_action) VALUES ($1, 'X', '{}'::jsonb)`, [
          other,
        ]),
      ),
      /row-level security|policy/i,
    );
  } finally {
    await db.close();
  }
});

test('rlsScopedDb binds the ambient tenant so plain queries are isolated end-to-end', async () => {
  const db = await freshDb();
  try {
    const other = await createCustomer(db, 'other-co', 'other-key');
    await useAppRole(db);
    await seedProposal(db, DEMO_ID, 'SAT-A');
    await seedProposal(db, other, 'SAT-B');

    const scoped = rlsScopedDb(db);
    // Inside a tenant context, a bare scoped.query() only sees that tenant.
    const demoRows = await runWithTenant(DEMO_ID, () => scoped.query(`SELECT satellite_id FROM proposals`));
    assert.equal(demoRows.length, 1);
    assert.equal((demoRows[0] as { satellite_id: string }).satellite_id, 'SAT-A');

    const otherRows = await runWithTenant(other, () => scoped.query(`SELECT satellite_id FROM proposals`));
    assert.equal(otherRows.length, 1);
    assert.equal((otherRows[0] as { satellite_id: string }).satellite_id, 'SAT-B');
  } finally {
    await db.close();
  }
});
