import pg from 'pg';
import type { Db, DbTx } from './index.js';

/**
 * Production database backend: a pooled connection to a managed Postgres,
 * exposed through the same `Db` abstraction as the local pglite backend. Used
 * when DATABASE_URL is set (see getDb). The audit log's per-tenant advisory lock
 * (pg_advisory_xact_lock) becomes load-bearing here — with multiple pooled
 * connections / processes, Postgres serializes concurrent audit appends.
 *
 * Note: exercised against a real Postgres at deploy; local dev/tests use pglite.
 */
export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql: string) {
      // Simple-query protocol (no params) allows multi-statement migration files.
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: DbTx) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: DbTx = {
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
          async exec(sql: string) {
            // Simple-query protocol (no params) on the SAME pinned client, so
            // multi-statement migration SQL runs inside this transaction.
            await client.query(sql);
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
