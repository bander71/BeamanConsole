// Imports a Harvest time report (CSV) into Beaman Console. Rules: src/harvestImport.ts.
//
//   npm run import:harvest -- "C:\path\harvest_time_report.csv"           dry run: shows what would happen, saves nothing
//   npm run import:harvest -- "C:\path\harvest_time_report.csv" --apply   backs up the database, then imports
//
// Running it again with the same file imports nothing new.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../src/db.ts';
import { importHarvest, type HarvestReport, type HarvestRow } from '../src/harvestImport.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: npm run import:harvest -- <harvest_time_report.csv> [--apply]');
  process.exit(1);
}

// ---- read the CSV ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const [header, ...data] = parseCsv(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const col = (name: string) => {
  const i = header!.findIndex((h) => h.trim() === name);
  if (i < 0) throw new Error(`The file has no "${name}" column. Is this a Harvest detailed time report?`);
  return i;
};
const c = { date: col('Date'), client: col('Client'), project: col('Project'), task: col('Task'), notes: col('Notes'),
  hours: col('Hours'), invoiced: col('Invoiced?'), rate: col('Billable Rate') };
const isoDate = (s: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim()) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Unexpected date: ${s}`);
  return m[1]!.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
};
const rows: HarvestRow[] = data
  .filter((r) => r.some((x) => x.trim()))
  .map((r) => ({
    date: isoDate(r[c.date]!), client: r[c.client]!.trim(), project: r[c.project]!.trim(), task: r[c.task]!.trim(), notes: (r[c.notes] ?? '').trim(),
    hours: Number(r[c.hours]), invoiced: /^yes$/i.test((r[c.invoiced] ?? '').trim()), billableRate: Number(r[c.rate]) || 0,
  }))
  .filter((r) => r.hours > 0);

// ---- back up the database first ----
function backup(): string {
  const pgRoot = 'C:\\Program Files\\PostgreSQL';
  const bin = existsSync(pgRoot)
    ? readdirSync(pgRoot).map((v) => join(pgRoot, v, 'bin', 'pg_dump.exe')).filter((p) => existsSync(p)).sort().pop()
    : undefined;
  const pgDump = bin ?? 'pg_dump';
  const dir = join(process.env.LOCALAPPDATA ?? '.', 'BeamanConsole', 'backups');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `beaman_console_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_before-harvest.dump`);
  const r = spawnSync(pgDump, ['--format=custom', `--file=${out}`, `--dbname=${process.env.DATABASE_URL}`], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0 || !existsSync(out) || statSync(out).size === 0) throw new Error('The backup failed, so nothing was imported.');
  return out;
}

// ---- run ----
const print = (r: HarvestReport) => {
  console.log(`\n${r.applied ? 'IMPORTED' : 'DRY RUN (nothing saved)'}: ${r.rows} Harvest entries, ${r.hours} h`);
  console.log(`  imported: ${r.imported.rows} entries, ${r.imported.hours} h, as ${r.imported.timeEntries} timesheet days (${r.imported.billedOutside} already billed in Harvest)`);
  for (const s of r.skipped) console.log(`  skipped: ${s.rows} entries, ${s.hours} h: ${s.reason}`);
  console.log(`  new timesheets: ${r.created.timesheets}`);
  if (r.created.accounts.length) console.log(`  new accounts: ${r.created.accounts.join(', ')}`);
  if (r.created.projects.length) console.log(`  new projects: ${r.created.projects.join(', ')}`);
  if (r.created.tasks.length) console.log(`  new tasks (${r.created.tasks.length}): ${r.created.tasks.join('; ')}`);
  console.log('  hours by task:');
  for (const t of r.byTask) console.log(`    ${t.task}: ${t.hours} h (${t.rows} entries)`);
};

const client = await pool.connect();
try {
  if (apply) console.log(`Backed up the database to ${backup()}`);
  await client.query('BEGIN');
  const report = await importHarvest(client, rows, apply);
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  print(report);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\nNothing was imported: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
