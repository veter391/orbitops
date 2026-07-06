import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDb, type Db } from './index.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Apply every pending SQL migration in filename order, each in its own
 * transaction, recording applied names in `_migrations`. Idempotent: already
 * applied files are skipped, so it is safe to run on every boot.
 * @returns the migration filenames applied this run.
 */
export async function migrate(db?: Db): Promise<string[]> {
  const d = db ?? (await getDb());
  await d.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     );`,
  );

  const done = new Set(
    (await d.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await d.exec('BEGIN');
    try {
      await d.exec(sql);
      await d.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await d.exec('COMMIT');
      applied.push(file);
    } catch (err) {
      await d.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return applied;
}

// Run directly: `npm run migrate`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
