// Imports past Harvest invoices (PDFs, or a zip of them) as paid invoices. Rules: src/harvestInvoices.ts.
//
//   npm run import:harvest-invoices -- "C:\path\harvest_invoice_pack.zip"           dry run: shows what would happen, saves nothing
//   npm run import:harvest-invoices -- "C:\path\harvest_invoice_pack.zip" --apply   backs up the database, stores the PDFs, imports
//
// Needs pdftotext (it comes with Git for Windows). Running it again imports nothing new.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { config } from '../src/config.ts';
import { pool } from '../src/db.ts';
import { harvestNumber, importHarvestInvoices, parseInvoiceText, type ParsedInvoice } from '../src/harvestInvoices.ts';
import { backup } from './backup.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const source = args.find((a) => !a.startsWith('--'));
if (!source || !existsSync(source)) {
  console.error('Usage: npm run import:harvest-invoices -- <harvest_invoice_pack.zip or a folder of PDFs> [--apply]');
  process.exit(1);
}

// ---- the PDFs: a folder, or a zip unpacked into a new, empty temp folder ----
let dir = source;
if (statSync(source).isFile()) {
  dir = mkdtempSync(join(tmpdir(), 'harvest-invoices-'));
  // Windows' own tar reads zips; Git's tar (if it's first on the PATH) mistakes "C:" for a remote host.
  const winTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(existsSync(winTar) ? winTar : 'tar', ['-xf', source, '-C', dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Couldn't unpack ${source}`);
}
const pdfs: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(join(d, e.name));
    else if (/\.pdf$/i.test(e.name)) pdfs.push(join(d, e.name));
  }
};
walk(dir);
pdfs.sort();

// ---- read each one ----
const pdftotext = [
  'pdftotext',
  'C:\\Program Files\\Git\\ucrt64\\bin\\pdftotext.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\msys64\\ucrt64\\bin\\pdftotext.exe',
].find((p) => !spawnSync(p, ['-v']).error); // -v exits 99 on some builds; "runs at all" is the test
if (!pdftotext) throw new Error("pdftotext wasn't found. It comes with Git for Windows.");

const invoices = pdfs.map((file) => {
  const r = spawnSync(pdftotext, ['-layout', file, '-'], { encoding: 'utf8' });
  try {
    if (r.status !== 0) throw new Error('pdftotext failed');
    const invoice: ParsedInvoice = parseInvoiceText(r.stdout);
    return { file: basename(file), path: file, invoice, storedAs: `harvest-${invoice.number}.pdf` };
  } catch (e) {
    return { file: basename(file), path: file, invoice: null, error: (e as Error).message };
  }
});

// ---- import ----
const client = await pool.connect();
try {
  if (apply) {
    console.log(`Backed up the database to ${backup('harvest-invoices')}`);
    // The PDFs go in the app's data folder, named by Harvest invoice number.
    const files = join(config.dataDir, 'invoice-files');
    mkdirSync(files, { recursive: true });
    for (const i of invoices) if (i.invoice && i.storedAs && !existsSync(join(files, i.storedAs))) copyFileSync(i.path, join(files, i.storedAs));
    console.log(`Stored the PDFs in ${files}`);
  }
  await client.query('BEGIN');
  const r = await importHarvestInvoices(client, invoices, apply);
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');

  console.log(`\n${r.applied ? 'IMPORTED' : 'DRY RUN (nothing saved)'}: ${r.files} PDFs`);
  console.log(`  imported: ${r.imported.count} invoices, $${r.imported.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}, each paid in full on its due date`);
  for (const c of r.byClient) console.log(`    ${c.account} ("${c.client}" in Harvest): ${c.count} invoices, $${c.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  for (const s of r.skipped) console.log(`  skipped ${s.file}: ${s.reason}`);
  const read = invoices.filter((i) => i.invoice).map((i) => harvestNumber(i.invoice!.number));
  console.log(`  numbers: ${read[0]} … (${read.length} read)`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\nNothing was imported: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
