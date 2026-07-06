import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../src/audit/index.js';
import { freshDb, createCustomer, DEMO_ID } from './helpers.js';

test('a tenant-scoped row cannot reference a non-existent customer (FK enforced)', async () => {
  const db = await freshDb();
  await assert.rejects(
    db.query(
      `INSERT INTO proposals (customer_id, satellite_id, reasoning_chain, proposed_action)
       VALUES ($1, 'x', '[]'::jsonb, '{}'::jsonb)`,
      ['00000000-0000-0000-0000-0000deadbeef'],
    ),
    /foreign key|violates|constraint/i,
  );
  await db.close();
});

test('deleting a customer cascades to its proposals, telemetry, and audit', async () => {
  const db = await freshDb();
  const other = await createCustomer(db, 'acme', 'acme-key');
  const audit = new AuditLog(db);

  await db.query(
    `INSERT INTO proposals (customer_id, reasoning_chain, proposed_action)
     VALUES ($1, '[]'::jsonb, '{}'::jsonb)`,
    [other],
  );
  await db.query(
    `INSERT INTO telemetry (customer_id, satellite_id, subsystem, metric, value)
     VALUES ($1, 's', 'p', 'm', 1.0)`,
    [other],
  );
  await audit.append(other, 'user:x', 'test', {});
  await audit.append(DEMO_ID, 'user:y', 'keep', {}); // a different tenant's row survives

  await db.query('DELETE FROM customers WHERE id = $1', [other]);

  const count = async (table: string) =>
    Number(
      (await db.query<{ n: string | number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE customer_id = $1`, [other]))[0]!
        .n,
    );
  assert.equal(await count('proposals'), 0);
  assert.equal(await count('telemetry'), 0);
  assert.equal(await count('audit_log'), 0);
  assert.equal(await audit.count(DEMO_ID), 1); // other tenant untouched
  await db.close();
});
