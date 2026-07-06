import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';
import { createPgDb } from './pg.js';

/**
 * Minimal database surface the rest of the app depends on. Keeping this narrow
 * means the engine underneath is swappable: pglite in local dev (real Postgres
 * SQL, in-process, no Docker/cloud/accounts), a pooled managed Postgres in prod.
 * Nothing above this line knows which one it is.
 */
/** A query surface inside a transaction (a subset of Db). */
export interface DbTx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Run `fn` in a single transaction; commit on resolve, roll back on throw. */
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let pglite: PGlite | null = null;
let singleton: Db | null = null;

/**
 * Lazily open (and reuse) the single database. Uses a managed Postgres pool when
 * DATABASE_URL is set (prod), otherwise local pglite (dev) — both behind the same
 * `Db` interface, so the rest of the app never knows which is underneath.
 */
export async function getDb(): Promise<Db> {
  if (singleton) return singleton;

  if (config.DATABASE_URL) {
    singleton = createPgDb(config.DATABASE_URL);
    return singleton;
  }

  // pglite's mkdir is not recursive, so ensure the parent path exists first.
  mkdirSync(config.DATA_DIR, { recursive: true });
  pglite = new PGlite(config.DATA_DIR);
  const client = pglite;
  singleton = {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return (await client.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
    async transaction<T>(fn: (tx: DbTx) => Promise<T>) {
      return client.transaction(async (tx) => {
        return fn({
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
            return (await tx.query<R>(sql, params)).rows;
          },
        });
      });
    },
    async close() {
      await client.close();
      pglite = null;
      singleton = null;
    },
  };
  return singleton;
}
