// Harvest invoices: reading the PDF text, importing as paid invoices, the PDF endpoint.
// The invoice text below is made up, but copies the layouts seen in real Harvest PDFs.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { config } from '../src/config.ts';
import { pool } from '../src/db.ts';
import { importHarvestInvoices, parseInvoiceText } from '../src/harvestInvoices.ts';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const pad = (s: string, n: number) => s.padEnd(n);
// Subtotal/Payments labels drift away from their amounts (like Harvest invoice 1012).
const DRIFTING = [
  'INVOICE' + ' '.repeat(70) + 'From      Beaman Consulting',
  '',
  pad('Invoice ID  1012', 69) + 'Invoice For  Acme Corp.',
  'Issue Date  12/12/2025',
  pad('Due Date    12/27/2025 (Net 15)', 82) + 'PO Box 1',
  pad('Subject     Brad Anderson Invoice', 82) + 'Springfield, MO 64000',
  '',
  'Item Type   Description                                              Quantity     Unit Price                  Amount',
  'Service                                                                  4.50      $195.00                  $877.50',
  '            [AC] Consulting: Acme: Brad Anderson',
  '            (12/02/2025 - 12/10/2025)                                                                      $877.50',
  '                                                                                                          -$877.50',
  '                                                                                             Subtotal',
  '                                                                                           Payments        $0.00',
  '                                                                                  Amount Due',
  '',
  'Notes',
  'Attached is the current invoice',
  '                                                        Page 1 of 1',
].join('\n');
// A unit price that drops to the next line (like invoice 5), an Attn line, and one space after "Invoice For".
const DROPPED = [
  pad('Invoice ID  5', 77) + 'Invoice For Acme Corp.',
  'Issue Date  11/30/2025',
  pad('Due Date    12/15/2025 (Net 15)', 90) + 'Attn: Payables',
  pad('Subject     Brad Anderson Invoice', 90) + '1 Main St, Over',
  ' '.repeat(90) + 'Town, KS 66000',
  'Item Type   Description                                                      Quantity     Unit Price                Amount',
  'Service                                                                          0.50       $75.00                 $37.50',
  'Service     [AC] Projects: Business Development                                  6.00                             $819.00',
  '            (11/24/2025 - 11/28/2025)                                                     $136.50',
  '            [AC] Projects: IT Consulting (11/24/2025 -                                                            $0.00',
  '            11/28/2025)',
  '                                                                                          Amount Due',
  'Notes',
  'Thanks',
].join('\n');

describe('reading invoice text', () => {
  test('pairs amounts with descriptions and adds up the lines', () => {
    const i = parseInvoiceText(DRIFTING);
    assert.deepEqual([i.number, i.issueDate, i.dueDate, i.client, i.address, i.total], ['1012', '2025-12-12', '2025-12-27', 'Acme Corp.', 'PO Box 1\nSpringfield, MO 64000', 877.5]);
    assert.deepEqual(i.lines, [{ quantity: 4.5, rate: 195, amount: 877.5, description: '[AC] Consulting: Acme: Brad Anderson (12/02/2025 - 12/10/2025)' }]);
    assert.deepEqual([i.periodStart, i.periodEnd, i.notes], ['2025-12-02', '2025-12-10', 'Attached is the current invoice']);
  });

  test('handles a dropped unit price, Attn and wrapped descriptions', () => {
    const i = parseInvoiceText(DROPPED);
    assert.equal(i.client, 'Acme Corp.');
    assert.equal(i.attn, 'Payables');
    assert.equal(i.address, '1 Main St, Over\nTown, KS 66000');
    assert.deepEqual(i.lines.map((l) => [l.quantity, l.rate, l.amount, l.description]), [
      [0.5, 75, 37.5, '[AC] Projects: Business Development (11/24/2025 - 11/28/2025)'],
      [6, 136.5, 819, '[AC] Projects: IT Consulting (11/24/2025 - 11/28/2025)'],
    ]);
    assert.equal(i.total, 856.5);
  });

  test('refuses text it can\'t pair up', () => {
    assert.throws(() => parseInvoiceText(DROPPED.replace('$136.50', '$99.00')), /no matching unit price/);
    assert.throws(() => parseInvoiceText('nothing here'), /missing Invoice ID/);
  });
});

describe('importing', () => {
  let acme: any;
  beforeEach(async () => {
    acme = await create('/accounts', { name: 'Acme', type: 'Client', aliases: ['Acme Corporation'] });
  });

  async function run(invoices: Parameters<typeof importHarvestInvoices>[1], apply: boolean) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await importHarvestInvoices(client, invoices, apply);
      await client.query(apply ? 'COMMIT' : 'ROLLBACK');
      return r;
    } finally { client.release(); }
  }
  const files = () => [
    { file: 'a.pdf', invoice: parseInvoiceText(DRIFTING), storedAs: 'harvest-1012.pdf' },
    { file: 'b.pdf', invoice: parseInvoiceText(DROPPED), storedAs: 'harvest-5.pdf' },
    { file: 'c.pdf', invoice: { ...parseInvoiceText(DROPPED), number: '9', client: 'Nobody Inc.' } },
    { file: 'd.pdf', invoice: null, error: 'bad PDF' },
  ];

  test('imports paid invoices, kept apart from the app\'s own, and skips what it can\'t match', async () => {
    const preview = await run(files(), false);
    assert.equal((await api('GET', '/invoices')).body.total, 0, 'the dry run saved nothing');
    const r = await run(files(), true);
    assert.deepEqual({ ...preview, applied: true }, r);
    assert.deepEqual(r.imported, { count: 2, total: 1734 });
    assert.deepEqual(r.skipped.map((s) => s.reason), ['no account matches "Nobody Inc."', "couldn't read it: bad PDF"]);

    const list = (await api('GET', '/invoices?source=harvest')).body.data;
    assert.deepEqual(list.map((i: any) => [i.number, i.displayStatus, i.total, i.balance, i.accountId]).sort(), [
      ['H-1012', 'paid', 877.5, 0, acme.id], ['H-5', 'paid', 856.5, 0, acme.id]]);
    assert.equal((await api('GET', '/invoices?source=app')).body.total, 0, "they're not in the app's own list");

    const one = (await api('GET', `/invoices/${list.find((i: any) => i.number === 'H-5').id}`)).body.data;
    assert.deepEqual([one.status, one.source, one.fileName, one.billToAttn, one.termsDays, one.dueDate], ['sent', 'harvest', 'harvest-5.pdf', 'Payables', 15, '2025-12-15']);
    assert.deepEqual(one.payments.map((p: any) => [p.paymentDate, p.amount]), [['2025-12-15', 856.5]], 'paid in full on the due date');

    // Counted as invoiced and collected.
    const stats = (await api('GET', '/reports/invoicing?year=2025')).body.data;
    assert.deepEqual([stats.invoiced, stats.collected, stats.outstanding.amount], [1734, 1734, 0]);
    const pnl = (await api('GET', '/reports/pnl?from=2025-12-01&to=2025-12-31&basis=cash')).body.data;
    assert.equal(pnl.totalIncome, 1734);
  });

  test('running it again imports nothing new', async () => {
    await run(files(), true);
    const again = await run(files(), true);
    assert.equal(again.imported.count, 0);
    assert.deepEqual(again.skipped.filter((s) => s.reason.startsWith('already imported')).length, 2);
  });

  test('serves the stored PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beaman-data-'));
    mkdirSync(join(dir, 'invoice-files'));
    writeFileSync(join(dir, 'invoice-files', 'harvest-1012.pdf'), '%PDF-1.4 test');
    const saved = config.dataDir;
    config.dataDir = dir;
    try {
      await run(files().slice(0, 2), true);
      const list = (await api('GET', '/invoices?source=harvest')).body.data;
      const id = (n: string) => list.find((i: any) => i.number === n).id;
      const ok = await api('GET', `/invoices/${id('H-1012')}/file`);
      assert.deepEqual([ok.status, ok.type, ok.body], [200, 'application/pdf', '%PDF-1.4 test']);
      const missing = await api('GET', `/invoices/${id('H-5')}/file`);
      assert.equal(missing.status, 404, 'no stored file for H-5 in this folder');
    } finally {
      config.dataDir = saved;
    }
  });
});
