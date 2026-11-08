// Applies db/migrations/*.sql in name order, each in its own transaction,
// and records them in schema_migrations so each runs only once.
//
//   npm run migrate

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db/migrations');

export async function migrate(log: (msg: string) => void = console.log): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Stop two migrators from running at once.
    await client.query('SELECT pg_advisory_lock(727274)');

    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(file);
      log(`Applied ${file}`);
    }
    if (!applied.length) log('Database is up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

if (import.meta.main) {
  try {
    await migrate();
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
