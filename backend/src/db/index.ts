import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';

/**
 * Minimal database surface the rest of the app depends on. Keeping this narrow
 * means the engine underneath is swappable: pglite in local dev (real Postgres
 * SQL, in-process, no Docker/cloud/accounts), a pooled managed Postgres in prod.
 * Nothing above this line knows which one it is.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let instance: PGlite | null = null;

/** Lazily open (and reuse) the single local database instance. */
export async function getDb(): Promise<Db> {
  if (!instance) {
    // pglite's mkdir is not recursive, so ensure the parent path exists first.
    mkdirSync(config.DATA_DIR, { recursive: true });
    instance = new PGlite(config.DATA_DIR);
  }
  const client = instance;
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await client.query<T>(sql, params);
      return res.rows;
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
    async close() {
      await client.close();
      instance = null;
    },
  };
}
