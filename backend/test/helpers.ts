import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/db/migrate.js';
import { hashApiKey } from '../src/auth/index.js';
import type { Db } from '../src/db/index.js';

/** The demo tenant seeded by migration 003. */
export const DEMO_ID = '00000000-0000-0000-0000-0000000000d0';
export const DEMO_KEY = 'demo-key';

/** An isolated in-memory database (no disk, no shared state) with the schema applied. */
export async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db: Db = {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return (await client.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
    async transaction(fn) {
      return client.transaction(async (tx) => {
        return fn({
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
            return (await tx.query<R>(sql, params)).rows;
          },
          async exec(sql: string) {
            await tx.exec(sql);
          },
        });
      });
    },
    async close() {
      await client.close();
    },
  };
  await migrate(db);
  return db;
}

/** Create an extra tenant (with a default operator holding `apiKey`) and return its id. */
export async function createCustomer(db: Db, name: string, apiKey: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    'INSERT INTO customers (name, api_key_hash) VALUES ($1, $2) RETURNING id',
    [name, hashApiKey(apiKey + ':customer')],
  );
  const customerId = rows[0]!.id;
  await db.query(
    'INSERT INTO operators (customer_id, name, api_key_hash) VALUES ($1, $2, $3)',
    [customerId, `${name} operator`, hashApiKey(apiKey)],
  );
  return customerId;
}

/** The demo tenant's default operator id (seeded by migration 004). */
export async function demoOperatorId(db: Db): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM operators WHERE customer_id = $1', [
    DEMO_ID,
  ]);
  return rows[0]!.id;
}
