// Imports expenses from the spreadsheet Brad kept before the ledger existed.
//
//   npm run import:ledger -- "C:\path\expenses.tsv"           dry run: shows what would happen, saves nothing
//   npm run import:ledger -- "C:\path\expenses.tsv" --apply   backs up the database, then imports
//
// The file is tab-separated (copy the rows out of Excel) with the columns
// DESCRIPTION, DATE (m/d/yyyy), AMOUNT (-$1,234.56) and CATEGORY ("EXPENSE - MEALS AND ENTERTAINMENT").
//
// INCOME rows are skipped: those checks are already in the app as payments on the
// imported Harvest invoices, and adding them to the ledger would count them twice.
// Running it again imports nothing new (each row gets a legacy_id).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pool } from '../src/db.ts';
import { backup } from './backup.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const source = args.find((a) => !a.startsWith('--'));
if (!source || !existsSync(source)) {
  console.error('Usage: npm run import:ledger -- <expenses.tsv> [--apply]');
  process.exit(1);
}

const CONTRACTOR = 'Onel Jiminez'; // the only 1099 subcontractor in the sheet

/** The app's category for a spreadsheet row. Most follow the sheet's category; a few are by description. */
function categoryFor(sheet: string, desc: string): string {
  const d = desc.toLowerCase();
  switch (sheet) {
    case 'BANK CHARGES AND INTEREST': return 'Bank & payment fees';
    case 'INSURANCE': return 'Insurance';
    case 'LICENSES AND DUES': return 'Software & subscriptions';
    case 'MEALS AND ENTERTAINMENT': return 'Meals';
    case 'OFFICE EXPENSE': return d.includes('interest') ? 'Bank & payment fees' : 'Office & supplies';
    case 'OTHER':
      if (d.includes('tax')) return 'Income tax payments';
      if (/\blate?\s+fee\b/.test(d)) return 'Bank & payment fees';
      return 'Other expense';
    case 'PROFESSIONAL FEES': return d.includes('secretary of state') ? 'Taxes & licenses' : 'Professional fees';
    case 'SALES': return 'Equipment';
    case 'SOFTWARE SUBSCRIPTIONS': return 'Software & subscriptions';
    case 'SUBCONTRACTORS': return 'Contractors (1099)';
    case 'WAGES AND BENEFITS': return 'Wages & payroll';
    default: throw new Error(`No category for "${sheet}" (${desc})`);
  }
}

interface Row { line: number; desc: string; date: string; amount: number; sheetCategory: string; category: string; legacyId: string }

const rows: Row[] = [];
const skipped: string[] = [];
const seen = new Map<string, number>();
const lines = readFileSync(source, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
lines.forEach((text, i) => {
  if (!text.trim() || /^DESCRIPTION\t/i.test(text)) return;
  const [rawDesc = '', rawDate = '', rawAmount = '', rawCat = ''] = text.split('\t');
  const desc = rawDesc.replace(/\s+/g, ' ').trim();
  const m = rawDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) throw new Error(`Line ${i + 1}: can't read the date "${rawDate}"`);
  const [, mo = '', day = '', year = ''] = m;
  const date = `${year}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const amount = Math.abs(Number(rawAmount.replace(/[$,\s]/g, '')));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Line ${i + 1}: can't read the amount "${rawAmount}"`);
  const [kind = '', ...rest] = rawCat.trim().split(/\s+-\s+/);
  if (kind.toUpperCase() === 'INCOME') { skipped.push(`${date}  ${amount.toFixed(2).padStart(10)}  ${desc}`); return; }
  if (kind.toUpperCase() !== 'EXPENSE') throw new Error(`Line ${i + 1}: unknown category "${rawCat}"`);
  const sheetCategory = rest.join(' - ').toUpperCase();
  // Identical rows (same date, amount and description) are numbered so each is kept once.
  const key = `${date}|${amount.toFixed(2)}|${desc.toLowerCase()}`;
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  const legacyId = `expense-sheet:${createHash('sha1').update(`${key}|${n}`).digest('hex').slice(0, 16)}`;
  rows.push({ line: i + 1, desc, date, amount, sheetCategory, category: categoryFor(sheetCategory, desc), legacyId });
});

const { rows: [onel] } = await pool.query('SELECT id FROM resources WHERE lower(name) = lower($1)', [CONTRACTOR]);
if (rows.some((r) => r.category === 'Contractors (1099)') && !onel) throw new Error(`No resource named ${CONTRACTOR}`);
const { rows: existing } = await pool.query('SELECT legacy_id FROM ledger_entries WHERE legacy_id = ANY($1)', [rows.map((r) => r.legacyId)]);
const already = new Set(existing.map((r) => r.legacy_id as string));
const todo = rows.filter((r) => !already.has(r.legacyId));

const totals = new Map<string, { n: number; sum: number }>();
for (const r of todo) {
  const t = totals.get(r.category) ?? { n: 0, sum: 0 };
  t.n++; t.sum += r.amount;
  totals.set(r.category, t);
}
console.log(`${rows.length} expense rows: ${todo.length} new, ${already.size} already imported. ${skipped.length} income rows skipped.\n`);
for (const [cat, t] of [...totals].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${cat.padEnd(26)} ${String(t.n).padStart(3)}  ${t.sum.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).padStart(12)}`);
}
const total = todo.reduce((s, r) => s + r.amount, 0);
console.log(`  ${'Total'.padEnd(26)} ${String(todo.length).padStart(3)}  ${total.toLocaleString('en-US', { style: 'currency', currency: 'USD' }).padStart(12)}\n`);
const dups = [...seen].filter(([, n]) => n > 1);
if (dups.length) console.log(`Identical rows, each imported: ${dups.map(([k, n]) => `${k.replaceAll('|', ' ')} (x${n})`).join('; ')}\n`);

if (!apply) {
  console.log('Dry run: nothing saved. Add --apply to import.');
  await pool.end();
  process.exit(0);
}
if (!todo.length) { console.log('Nothing to import.'); await pool.end(); process.exit(0); }

console.log(`Backed up to ${backup('ledger-import')}`);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const r of todo) {
    await client.query(
      `INSERT INTO ledger_entries (legacy_id, entry_date, type, category, amount, payee, resource_id, method, memo)
       VALUES ($1, $2, 'expense', $3, $4, $5, $6, 'Other', $7)`,
      [r.legacyId, r.date, r.category, r.amount, r.desc,
        r.category === 'Contractors (1099)' ? onel.id : null,
        `From the 2026 expense spreadsheet (${r.sheetCategory.toLowerCase()})`]);
  }
  await client.query('COMMIT');
  console.log(`Imported ${todo.length} expenses.`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
