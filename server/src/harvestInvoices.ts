// Harvest invoices: reads Harvest's invoice PDFs (as text from `pdftotext -layout`) and
// imports them as past invoices: sent, paid in full on the due date, with their lines,
// and the original PDF kept in the app's data folder.
//
// Used by scripts/import-harvest-invoices.ts. The time these invoices billed was already
// imported as "billed outside the app" (see harvestImport.ts), so no time is linked here.

import type pg from 'pg';

export interface ParsedLine {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface ParsedInvoice {
  number: string;
  issueDate: string;
  dueDate: string;
  client: string;
  attn: string;
  address: string;
  subject: string;
  notes: string;
  lines: ParsedLine[];
  total: number;
  periodStart: string | null;
  periodEnd: string | null;
}

const money = (s: string) => Number(s.replace(/[$,]/g, ''));
const iso = (mdy: string) => {
  const [m, d, y] = mdy.split('/');
  return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line item's numbers: quantity, unit price, amount (at the end of a line). */
const ITEM_NUMBERS = /\s(-?\d+(?:\.\d+)?)\s+(-?\$[\d,]+\.\d{2})\s+(-?\$[\d,]+\.\d{2})\s*$/;
/** Sometimes the unit price drops to the next line, leaving quantity … amount with a wide gap. */
const ITEM_NO_PRICE = /\s(\d+\.\d{2})\s{12,}(\$[\d,]+\.\d{2})\s*$/;

/**
 * Reads one invoice. The layout shifts between invoices (numbers and descriptions don't
 * always share a line, and Subtotal/Payments labels drift away from their amounts), so
 * this pairs the item number rows with the item descriptions in order, and adds up the
 * lines instead of trusting "Amount Due".
 */
export function parseInvoiceText(text: string): ParsedInvoice {
  const lines = text.split(/\r?\n/);
  const field = (label: string) => lines.map((l) => new RegExp(`^${label}\\s{2,}(\\S.*?)(?:\\s{2,}|$)`).exec(l)?.[1]).find(Boolean) ?? '';
  const number = field('Invoice ID');
  const issueDate = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(field('Issue Date'))?.[1];
  const dueDate = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(field('Due Date'))?.[1];
  if (!number || !issueDate || !dueDate) throw new Error('missing Invoice ID, Issue Date or Due Date');

  // The client and address: the right-hand column from "Invoice For" down to the items.
  const forAt = lines.findIndex((l) => /Invoice For\s+\S/.test(l));
  const itemsAt = lines.findIndex((l) => /^Item Type\s/.test(l));
  if (forAt < 0 || itemsAt < 0) throw new Error('missing "Invoice For" or the line items');
  const col = lines[forAt]!.indexOf('Invoice For');
  const client = lines[forAt]!.slice(col).replace(/^Invoice For\s+/, '').trim();
  const right = lines
    .slice(forAt + 1, itemsAt)
    .map((l) => (l.length > col ? l.slice(col).trim() : ''))
    .filter(Boolean);
  const attn = right.find((l) => /^Attn:/i.test(l))?.replace(/^Attn:\s*/i, '') ?? '';
  // As printed: a wrapped line like "Overland / Park, KS" reads right when shown.
  const address = right.filter((l) => !/^Attn:/i.test(l)).join('\n');

  // Line items: number rows and descriptions, between the header and Notes.
  const notesAt = lines.findIndex((l, i) => i > itemsAt && /^Notes\s*$/.test(l.trim()) && /^Notes/.test(l));
  const end = notesAt < 0 ? lines.length : notesAt;
  const descCol = lines[itemsAt]!.indexOf('Description');
  const rows: Omit<ParsedLine, 'description'>[] = [];
  const descs: string[] = [];
  for (const raw of lines.slice(itemsAt + 1, end)) {
    let l = raw;
    const m = ITEM_NUMBERS.exec(l);
    const n = m ? null : ITEM_NO_PRICE.exec(l);
    if (m) {
      rows.push({ quantity: Number(m[1]), rate: money(m[2]!), amount: money(m[3]!) });
      l = l.slice(0, m.index);
    } else if (n) {
      const quantity = Number(n[1]), amount = money(n[2]!);
      const rate = round2(amount / quantity);
      // The dropped price shows up nearby as a value of its own; make sure it agrees.
      const shown = `$${rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (!lines.slice(itemsAt + 1, end).some((x) => x.split(/\s+/).includes(shown))) throw new Error(`a line has ${quantity} for $${amount} but no matching unit price`);
      rows.push({ quantity, rate, amount });
      l = l.slice(0, n.index);
    }
    // What's left in the description column, without the item type, totals and their labels.
    const desc = l
      .slice(Math.min(descCol, l.length))
      .replace(/(Subtotal|Payments|Amount Due)/g, ' ')
      .replace(/-?\$[\d,]+\.\d{2}/g, ' ')
      .trim();
    if (!desc) continue;
    if (desc.startsWith('[') || !descs.length) descs.push(desc);
    else descs[descs.length - 1] = `${descs[descs.length - 1]} ${desc}`;
  }
  if (!rows.length) throw new Error('no line items found');
  if (rows.length !== descs.length) throw new Error(`${rows.length} line amounts but ${descs.length} descriptions`);
  for (const r of rows) if (Math.abs(round2(r.quantity * r.rate) - r.amount) > 0.011) throw new Error(`a line's quantity × price isn't its amount (${r.quantity} × ${r.rate} ≠ ${r.amount})`);

  const items = rows.map((r, i) => ({ ...r, description: descs[i]!.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')') }));
  const dates = items.flatMap((i) => [...i.description.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => iso(m[1]!))).sort();
  const notes = notesAt < 0 ? '' : lines.slice(notesAt + 1).filter((l) => !/Page \d+ of \d+/.test(l)).map((l) => l.trim()).filter(Boolean).join('\n');
  return {
    number, issueDate: iso(issueDate), dueDate: iso(dueDate), client, attn, address, subject: field('Subject'), notes,
    lines: items, total: round2(items.reduce((s, i) => s + i.amount, 0)),
    periodStart: dates[0] ?? null, periodEnd: dates[dates.length - 1] ?? null,
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\b(inc|llc|co|corp|technologies|technology|group|the)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

export interface InvoiceImportReport {
  applied: boolean;
  files: number;
  imported: { count: number; total: number };
  byClient: { client: string; account: string; count: number; total: number }[];
  skipped: { file: string; reason: string }[];
}

/**
 * Imports parsed invoices. `files` maps an invoice number to its PDF's stored file name.
 * Already-imported invoices (same Harvest number) are skipped, so it can be run again.
 */
export async function importHarvestInvoices(
  client: pg.PoolClient,
  invoices: { file: string; invoice: ParsedInvoice | null; error?: string; storedAs?: string }[],
  applied: boolean,
): Promise<InvoiceImportReport> {
  const report: InvoiceImportReport = { applied, files: invoices.length, imported: { count: 0, total: 0 }, byClient: [], skipped: [] };
  const { rows: accounts } = await client.query<{ id: string; name: string; aliases: string[]; billing_attn: string }>(
    'SELECT id, name, aliases, billing_attn FROM accounts');
  const accountFor = (name: string) => accounts.find((a) => [a.name, ...a.aliases].some((n) => norm(n) === norm(name)));
  const { rows: existing } = await client.query<{ number: string; source: string }>('SELECT number, source FROM invoices');
  const harvestNumbers = new Set(existing.filter((e) => e.source === 'harvest').map((e) => e.number));
  const taken = new Set(existing.map((e) => e.number));
  const byClient = new Map<string, { client: string; account: string; count: number; total: number }>();

  for (const { file, invoice: inv, error, storedAs } of invoices) {
    if (!inv) { report.skipped.push({ file, reason: `couldn't read it: ${error}` }); continue; }
    const number = harvestNumber(inv.number);
    if (harvestNumbers.has(number)) { report.skipped.push({ file, reason: `already imported (${number})` }); continue; }
    if (taken.has(number)) { report.skipped.push({ file, reason: `invoice number ${number} is already used` }); continue; }
    const account = accountFor(inv.client);
    if (!account) { report.skipped.push({ file, reason: `no account matches "${inv.client}"` }); continue; }

    const terms = Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 864e5);
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO invoices (number, account_id, status, bill_to_name, bill_to_attn, bill_to_address, period_start, period_end,
                             issue_date, terms_days, tax_rate, memo, source, file_name)
       VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7, $8, $9, 0, $10, 'harvest', $11) RETURNING id`,
      [number, account.id, inv.client, inv.attn || account.billing_attn || '', inv.address, inv.periodStart, inv.periodEnd,
        inv.issueDate, terms, inv.notes, storedAs ?? null]);
    for (const [i, l] of inv.lines.entries()) {
      await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, kind, description, quantity, rate, amount) VALUES ($1, $2, 'manual', $3, $4, $5, $6)`,
        [row!.id, i + 1, l.description, l.quantity, l.rate, l.amount]);
    }
    // Paid in full; the PDFs don't show when, so the payment is dated the due date.
    await client.query(
      `INSERT INTO invoice_payments (invoice_id, payment_date, amount, method, reference) VALUES ($1, $2, $3, 'Other', 'Paid (from Harvest)')`,
      [row!.id, inv.dueDate, inv.total]);
    harvestNumbers.add(number);
    taken.add(number);
    report.imported.count++;
    report.imported.total = round2(report.imported.total + inv.total);
    const c = byClient.get(account.id) ?? { client: inv.client, account: account.name, count: 0, total: 0 };
    c.count++;
    c.total = round2(c.total + inv.total);
    byClient.set(account.id, c);
  }
  report.byClient = [...byClient.values()].sort((a, b) => b.total - a.total);
  return report;
}

/** Harvest's number, kept as is but marked so it can't collide with the app's own numbering. */
export const harvestNumber = (n: string) => `H-${n}`;
