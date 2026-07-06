import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/db/migrate.js';
import type { Db } from '../src/db/index.js';

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
    async close() {
      await client.close();
    },
  };
  await migrate(db);
  return db;
}
