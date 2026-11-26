// Backs up the database to <data folder>/backups before an import changes anything.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';

/** Finds a PostgreSQL program (newest version installed), or falls back to the PATH. */
export function pgProgram(name: string) {
  const root = 'C:\\Program Files\\PostgreSQL';
  const found = existsSync(root)
    ? readdirSync(root).map((v) => join(root, v, 'bin', `${name}.exe`)).filter((p) => existsSync(p)).sort().pop()
    : undefined;
  return found ?? name;
}

/** Writes a full backup (pg_dump custom format) and returns its path. Throws if it fails. */
export function backup(label: string): string {
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `beaman_console_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_before-${label}.dump`);
  const r = spawnSync(pgProgram('pg_dump'), ['--format=custom', `--file=${out}`, `--dbname=${config.databaseUrl}`], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0 || !existsSync(out) || statSync(out).size === 0) throw new Error('The backup failed, so nothing was imported.');
  return out;
}
