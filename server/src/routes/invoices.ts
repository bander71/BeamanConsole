// Invoices.
//
// Stored status is draft | sent | void. The status people see is worked out
// the same way the prototype does it:
//   void -> void; draft -> draft; sent and nothing owed -> paid;
//   sent and past due -> overdue; sent and partly paid -> partial; else sent.
//
// Time lines point at the exact time entries they bill, and a time entry can
// be on only one invoice. Voiding or deleting an invoice frees its hours.
// Tax rates are fractions: 0.0865 means 8.65%.

import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { camelRow, pool, transaction } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { PAYMENT_METHODS } from '../resources.ts';
import { getSettings } from './extra.ts';

export const invoiceRoutes = Router();

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPLAY_STATUSES = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'] as const;
const LINE_KINDS = ['time', 'manual', 'expense', 'product'] as const;
const NUMBER_LOCK = 727275; // advisory lock id for invoice numbering

const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function idParam(raw: string, what = 'Invoice') {
  if (!UUID.test(raw)) throw notFound(what);
  return raw;
}

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

// SQL for the status people see, given invoice i and invoice_totals t.
const DISPLAY_STATUS_SQL = `CASE
  WHEN i.status = 'void' THEN 'void'
  WHEN i.status = 'draft' THEN 'draft'
  WHEN t.balance <= 0.004 THEN 'paid'
  WHEN i.due_date < current_date THEN 'overdue'
  WHEN t.paid > 0 THEN 'partial'
  ELSE 'sent' END`;

// ---- unbilled time ------------------------------------------------------------------

interface UnbilledOptions {
  accountId?: string;
  from?: string;
  to?: string;
  includeUnapproved: boolean;
  includeFlatFee: boolean;
}

interface UnbilledEntry {
  timeEntryId: string;
  timesheetId: string;
  workDate: string;
  hours: number;
  timesheetStatus: string;
  resourceName: string;
  taskId: string;
  taskNumber: number;
  taskName: string;
  taskType: string;
  billRate: number;
  accountId: string;
  note: string;
}

/** Billable hours that aren't on any invoice yet, oldest first. */
async function unbilledEntries(db: Queryable, o: UnbilledOptions): Promise<UnbilledEntry[]> {
  const where = ['NOT billed', 'bill_rate > 0', 'account_id IS NOT NULL'];
  const values: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace('?', '$' + values.length));
  };
  if (o.accountId) add('account_id = ?', o.accountId);
  if (o.from) add('work_date >= ?', o.from);
  if (o.to) add('work_date <= ?', o.to);
  if (!o.includeUnapproved) where.push(`timesheet_status = 'approved'`);
  if (!o.includeFlatFee) where.push(`task_type <> 'Flat Fee'`);
  const { rows } = await db.query(
    `SELECT time_entry_id, timesheet_id, work_date, hours, timesheet_status, resource_name, task_id,
            task_number, task_name, task_type, bill_rate, account_id, note
     FROM time_detail WHERE ${where.join(' AND ')}
     ORDER BY work_date, task_number`,
    values,
  );
  return rows.map((r) => camelRow(r) as unknown as UnbilledEntry);
}

/** One invoice line per task (a task belongs to one resource), like the prototype. */
function groupLines(entries: UnbilledEntry[]) {
  const byTask = new Map<string, { taskId: string; taskNumber: number; description: string; quantity: number; rate: number; amount: number; entries: UnbilledEntry[] }>();
  for (const e of entries) {
    let line = byTask.get(e.taskId);
    if (!line) {
      line = { taskId: e.taskId, taskNumber: e.taskNumber, description: `${e.taskName} — ${e.resourceName}`, quantity: 0, rate: e.billRate, amount: 0, entries: [] };
      byTask.set(e.taskId, line);
    }
    line.quantity = round2(line.quantity + e.hours);
    line.amount = round2(line.quantity * line.rate);
    line.entries.push(e);
  }
  return [...byTask.values()].sort((a, b) => a.taskNumber - b.taskNumber);
}

const unbilledQuery = z.object({
  accountId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  includeUnapproved: boolParam.default(true),
  includeFlatFee: boolParam.default(false),
});

// GET /invoices/unbilled?accountId=&from=&to=&includeUnapproved=&includeFlatFee=
// Ready-to-invoice time grouped by account, with the lines a new invoice would get.
invoiceRoutes.get('/invoices/unbilled', async (req, res) => {
  const o = unbilledQuery.parse(req.query);
  const entries = await unbilledEntries(pool, o);
  const accountIds = [...new Set(entries.map((e) => e.accountId))];
  const { rows: accounts } = await pool.query('SELECT id, name FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
  const names = new Map(accounts.map((a) => [a.id as string, a.name as string]));

  const data = accountIds.map((accountId) => {
    const mine = entries.filter((e) => e.accountId === accountId);
    const lines = groupLines(mine).map(({ entries: es, ...l }) => ({
      ...l,
      entries: es.map((e) => ({ timeEntryId: e.timeEntryId, workDate: e.workDate, hours: e.hours, resourceName: e.resourceName, timesheetStatus: e.timesheetStatus, note: e.note })),
    }));
    return {
      accountId,
      accountName: names.get(accountId) ?? '',
      hours: round2(mine.reduce((s, e) => s + e.hours, 0)),
      amount: round2(lines.reduce((s, l) => s + l.amount, 0)),
      unapprovedHours: round2(mine.filter((e) => e.timesheetStatus !== 'approved').reduce((s, e) => s + e.hours, 0)),
      oldestDate: mine[0]?.workDate ?? null,
      lines,
    };
  }).sort((a, b) => a.accountName.localeCompare(b.accountName));

  res.json({ data });
});

// ---- loading an invoice ---------------------------------------------------------------

async function loadInvoice(db: Queryable, id: string) {
  const { rows: [inv] } = await db.query(
    `SELECT i.*, a.name AS account_name,
            t.subtotal, t.tax, t.total, t.paid, t.balance, ${DISPLAY_STATUS_SQL} AS display_status
     FROM invoices i JOIN accounts a ON a.id = i.account_id JOIN invoice_totals t ON t.invoice_id = i.id
     WHERE i.id = $1`,
    [id],
  );
  if (!inv) return null;

  const { rows: lines } = await db.query(
    `SELECT l.*, t.task_number FROM invoice_lines l LEFT JOIN tasks t ON t.id = l.task_id
     WHERE l.invoice_id = $1 ORDER BY l.line_no`,
    [id],
  );
  const { rows: entries } = await db.query(
    `SELECT b.invoice_line_id, te.id AS time_entry_id, te.work_date, b.hours, r.name AS resource_name, tl.note
     FROM invoice_line_time_entries b
     JOIN invoice_lines l ON l.id = b.invoice_line_id
     JOIN time_entries te ON te.id = b.time_entry_id
     JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
     JOIN timesheets ts ON ts.id = tl.timesheet_id
     JOIN resources r ON r.id = ts.resource_id
     WHERE l.invoice_id = $1 ORDER BY te.work_date`,
    [id],
  );
  const { rows: payments } = await db.query(
    'SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date, created_at', [id],
  );

  const out = camelRow(inv);
  const totals = {
    subtotal: out.subtotal, tax: out.tax, total: out.total, paid: out.paid, balance: out.balance,
  };
  for (const k of Object.keys(totals)) delete out[k];
  return {
    ...out,
    totals,
    lines: lines.map((l) => {
      const line = camelRow(l);
      delete line.invoiceId;
      return {
        ...line,
        entries: line.kind === 'time'
          ? entries.filter((e) => e.invoice_line_id === l.id).map((e) => {
              const { invoiceLineId: _, ...rest } = camelRow(e);
              return rest;
            })
          : [],
      };
    }),
    payments: payments.map((p) => {
      const pay = camelRow(p);
      delete pay.invoiceId;
      return pay;
    }),
  };
}

async function requireInvoice(db: Queryable, id: string) {
  const inv = await loadInvoice(db, id);
  if (!inv) throw notFound('Invoice');
  return inv;
}

/** Locks the invoice row for this transaction and returns its stored status. */
async function lockInvoice(client: pg.PoolClient, id: string) {
  const { rows: [row] } = await client.query('SELECT id, status FROM invoices WHERE id = $1 FOR UPDATE', [id]);
  if (!row) throw notFound('Invoice');
  return row as { id: string; status: 'draft' | 'sent' | 'void' };
}

async function paymentCount(client: pg.PoolClient, id: string): Promise<number> {
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1', [id]);
  return n;
}

// ---- list -------------------------------------------------------------------------------
// GET /invoices?accountId=&status=&from=&to=&q=&limit=&offset=
// status is the status people see (draft, sent, partial, paid, overdue, void).
// from/to filter on issue date.

const listQuery = z.object({
  accountId: z.uuid().optional(),
  status: z.enum(DISPLAY_STATUSES).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

invoiceRoutes.get('/invoices', async (req, res) => {
  const f = listQuery.parse(req.query);
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replaceAll('?', '$' + values.length));
  };
  if (f.accountId) add('account_id = ?', f.accountId);
  if (f.status) add('display_status = ?', f.status);
  if (f.from) add('issue_date >= ?', f.from);
  if (f.to) add('issue_date <= ?', f.to);
  if (f.q) add('(number ILIKE ? OR account_name ILIKE ? OR bill_to_name ILIKE ?)', '%' + f.q.replace(/[\\%_]/g, '\\$&') + '%');

  const base = `WITH list AS (
      SELECT i.*, a.name AS account_name, t.subtotal, t.tax, t.total, t.paid, t.balance,
             ${DISPLAY_STATUS_SQL} AS display_status
      FROM invoices i JOIN accounts a ON a.id = i.account_id JOIN invoice_totals t ON t.invoice_id = i.id)
    SELECT * FROM list ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const { rows: [count] } = await pool.query(`SELECT count(*)::int AS n FROM (${base}) x`, values);
  values.push(f.limit, f.offset);
  const { rows } = await pool.query(
    `${base} ORDER BY issue_date DESC, number DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  res.json({ data: rows.map(camelRow), total: count.n, limit: f.limit, offset: f.offset });
});

invoiceRoutes.get('/invoices/:id', async (req, res) => {
  res.json({ data: await requireInvoice(pool, idParam(req.params.id)) });
});

// ---- create a draft -------------------------------------------------------------------------
// POST /invoices
// { accountId, from?, to?, cadence?, issueDate?, includeUnapproved? (true), includeFlatFee? (false), blank? (false) }
// Pulls in the account's unbilled billable time in the window, one line per task.
// blank: true creates an empty draft instead.

const createBody = z.strictObject({
  accountId: z.uuid(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cadence: z.string().trim().max(30).optional(),
  issueDate: z.iso.date().optional(),
  includeUnapproved: z.boolean().default(true),
  includeFlatFee: z.boolean().default(false),
  blank: z.boolean().default(false),
});

async function nextNumber(client: pg.PoolClient, issueDate: string, prefix: string, firstNumber: number) {
  const stem = `${prefix}${issueDate.slice(0, 4)}-`;
  const { rows: [{ n }] } = await client.query(
    `SELECT coalesce(max(substring(number FROM length($1) + 1)::int), 0) AS n
     FROM invoices WHERE number LIKE $2 AND substring(number FROM length($1) + 1) ~ '^[0-9]+$'`,
    [stem, stem.replace(/[\\%_]/g, '\\$&') + '%'],
  );
  return stem + String(Math.max(n, firstNumber - 1) + 1).padStart(4, '0');
}

invoiceRoutes.post('/invoices', async (req, res) => {
  const body = createBody.parse(req.body ?? {});
  if (body.from && body.to && body.from > body.to) throw new HttpError(400, 'from must be on or before to');
  const settings = await getSettings();

  const id = await transaction(async (client) => {
    const { rows: [account] } = await client.query('SELECT * FROM accounts WHERE id = $1', [body.accountId]);
    if (!account) throw new HttpError(400, 'Account not found');

    let lines: ReturnType<typeof groupLines> = [];
    let entries: UnbilledEntry[] = [];
    if (!body.blank) {
      const opts = { ...body, accountId: body.accountId };
      // Lock the timesheets involved so their hours can't change while we bill them,
      // then read the entries again under the lock.
      const first = await unbilledEntries(client, opts);
      const sheetIds = [...new Set(first.map((e) => e.timesheetId))];
      if (sheetIds.length) {
        await client.query('SELECT id FROM timesheets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [sheetIds]);
      }
      entries = await unbilledEntries(client, opts);
      lines = groupLines(entries);
    }

    const issueDate = body.issueDate ?? today();
    const dates = entries.map((e) => e.workDate);
    await client.query('SELECT pg_advisory_xact_lock($1)', [NUMBER_LOCK]);
    const number = await nextNumber(client, issueDate, settings!.numberPrefix as string, settings!.firstNumber as number);

    const { rows: [inv] } = await client.query(
      `INSERT INTO invoices (number, account_id, bill_to_name, bill_to_attn, bill_to_email, bill_to_address,
         cadence, period_start, period_end, issue_date, terms_days, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        number, account.id, account.name, account.billing_attn || 'Accounts Payable', account.billing_email,
        account.address, body.cadence ?? null,
        dates[0] ?? body.from ?? issueDate, body.to ?? dates[dates.length - 1] ?? issueDate,
        issueDate, settings!.termsDays, settings!.taxRate,
      ],
    );

    for (const [i, line] of lines.entries()) {
      const { rows: [saved] } = await client.query(
        `INSERT INTO invoice_lines (invoice_id, line_no, kind, task_id, description, quantity, rate, amount)
         VALUES ($1, $2, 'time', $3, $4, $5, $6, $7) RETURNING id`,
        [inv.id, i + 1, line.taskId, line.description, line.quantity, line.rate, line.amount],
      );
      await client.query(
        `INSERT INTO invoice_line_time_entries (invoice_line_id, time_entry_id, hours)
         SELECT $1, unnest($2::uuid[]), unnest($3::numeric[])`,
        [saved.id, line.entries.map((e) => e.timeEntryId), line.entries.map((e) => e.hours)],
      );
    }
    return inv.id as string;
  });

  const inv = await requireInvoice(pool, id);
  res.status(201).location(`/api/invoices/${id}`).json({ data: inv });
});

// ---- edit a draft ------------------------------------------------------------------------------
// PATCH /invoices/:id   (drafts only)
// Any header fields, and optionally `lines` to replace all lines, in order:
//   existing line: { id, description?, rate?, quantity? (not for time lines), taxable? }
//   new line:      { kind: manual|expense|product, description, quantity, rate, taxable? }
// Leaving a time line out removes it and frees its hours. Amounts are worked out here.

const money = z.number().min(-9_999_999_999.99).max(9_999_999_999.99);
const lineInput = z.strictObject({
  id: z.uuid().optional(),
  kind: z.enum(LINE_KINDS).optional(),
  description: z.string().max(2000).optional(),
  quantity: z.number().min(-99_999_999).max(99_999_999).optional(),
  rate: money.optional(),
  taxable: z.boolean().optional(),
});

const patchBody = z.strictObject({
  number: z.string().trim().min(1).max(40).optional(),
  issueDate: z.iso.date().optional(),
  termsDays: z.number().int().min(0).max(365).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  memo: z.string().max(5000).optional(),
  cadence: z.string().trim().max(30).nullable().optional(),
  periodStart: z.iso.date().nullable().optional(),
  periodEnd: z.iso.date().nullable().optional(),
  billToName: z.string().max(200).optional(),
  billToAttn: z.string().max(200).optional(),
  billToEmail: z.string().max(320).optional(),
  billToAddress: z.string().max(1000).optional(),
  lines: z.array(lineInput).max(500).optional(),
}).refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

const HEADER_COLUMNS: Record<string, string> = {
  number: 'number', issueDate: 'issue_date', termsDays: 'terms_days', taxRate: 'tax_rate', memo: 'memo',
  cadence: 'cadence', periodStart: 'period_start', periodEnd: 'period_end', billToName: 'bill_to_name',
  billToAttn: 'bill_to_attn', billToEmail: 'bill_to_email', billToAddress: 'bill_to_address',
};

invoiceRoutes.patch('/invoices/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const { lines, ...header } = patchBody.parse(req.body ?? {});

  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'draft') throw new HttpError(409, `Only drafts can be edited; this invoice is ${inv.status}`);

    const keys = Object.keys(header) as (keyof typeof header)[];
    if (keys.length) {
      await client.query(
        `UPDATE invoices SET ${keys.map((k, i) => `${HEADER_COLUMNS[k]} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...keys.map((k) => header[k])],
      );
    }

    if (lines) {
      const { rows: existing } = await client.query('SELECT * FROM invoice_lines WHERE invoice_id = $1', [id]);
      const byId = new Map(existing.map((l) => [l.id as string, l]));
      const seen = new Set<string>();

      // Check everything before writing.
      const plan = lines.map((input, i) => {
        if (input.id) {
          const old = byId.get(input.id);
          if (!old) throw new HttpError(400, `Line ${i + 1} is not on this invoice`);
          if (seen.has(input.id)) throw new HttpError(400, `Line ${i + 1} appears twice`);
          seen.add(input.id);
          if (input.kind && input.kind !== old.kind) throw new HttpError(400, `Line ${i + 1}: a line's kind can't change`);
          if (old.kind === 'time' && input.quantity !== undefined && input.quantity !== old.quantity) {
            throw new HttpError(400, `Line ${i + 1}: hours on a time line come from timesheets and can't be edited`);
          }
          const quantity = input.quantity ?? old.quantity;
          const rate = input.rate ?? old.rate;
          return { id: input.id, kind: old.kind, description: input.description ?? old.description, quantity, rate, taxable: input.taxable ?? old.taxable };
        }
        if (!input.kind || input.kind === 'time') {
          throw new HttpError(400, `Line ${i + 1}: new lines need a kind of manual, expense or product`);
        }
        return {
          id: null, kind: input.kind, description: input.description ?? '', quantity: input.quantity ?? 1,
          rate: input.rate ?? 0, taxable: input.taxable ?? input.kind === 'product',
        };
      });

      const dropped = existing.filter((l) => !seen.has(l.id)).map((l) => l.id);
      if (dropped.length) await client.query('DELETE FROM invoice_lines WHERE id = ANY($1::uuid[])', [dropped]);
      // Move kept lines out of the way so renumbering can't collide.
      await client.query('UPDATE invoice_lines SET line_no = -line_no WHERE invoice_id = $1', [id]);
      for (const [i, l] of plan.entries()) {
        const amount = round2(l.quantity * l.rate);
        if (l.id) {
          await client.query(
            'UPDATE invoice_lines SET line_no = $2, description = $3, quantity = $4, rate = $5, amount = $6, taxable = $7 WHERE id = $1',
            [l.id, i + 1, l.description, l.quantity, l.rate, amount, l.taxable],
          );
        } else {
          await client.query(
            `INSERT INTO invoice_lines (invoice_id, line_no, kind, description, quantity, rate, amount, taxable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, i + 1, l.kind, l.description, l.quantity, l.rate, amount, l.taxable],
          );
        }
      }
    }
    await client.query('UPDATE invoices SET updated_at = now() WHERE id = $1', [id]);
  });

  res.json({ data: await requireInvoice(pool, id) });
});

// ---- send, unsend, void, delete ----------------------------------------------------------------

invoiceRoutes.post('/invoices/:id/send', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'draft') throw new HttpError(409, `Only drafts can be sent; this invoice is ${inv.status}`);
    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM invoice_lines WHERE invoice_id = $1', [id]);
    if (!n) throw new HttpError(409, 'Add at least one line before sending');
    await client.query(`UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
  });
  res.json({ data: await requireInvoice(pool, id) });
});

invoiceRoutes.post('/invoices/:id/unsend', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'sent') throw new HttpError(409, `Only sent invoices can go back to draft; this invoice is ${inv.status}`);
    if (await paymentCount(client, id)) throw new HttpError(409, 'Remove the payments before moving this invoice back to draft');
    await client.query(`UPDATE invoices SET status = 'draft', sent_at = NULL WHERE id = $1`, [id]);
  });
  res.json({ data: await requireInvoice(pool, id) });
});

// Voiding keeps the invoice and its lines for the record but frees its hours.
invoiceRoutes.post('/invoices/:id/void', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status === 'draft') throw new HttpError(409, 'Delete a draft instead of voiding it');
    if (inv.status === 'void') throw new HttpError(409, 'This invoice is already void');
    if (await paymentCount(client, id)) throw new HttpError(409, 'Remove the payments before voiding this invoice');
    await client.query(
      `DELETE FROM invoice_line_time_entries WHERE invoice_line_id IN (SELECT id FROM invoice_lines WHERE invoice_id = $1)`,
      [id],
    );
    await client.query(`UPDATE invoices SET status = 'void', voided_at = now() WHERE id = $1`, [id]);
  });
  res.json({ data: await requireInvoice(pool, id) });
});

invoiceRoutes.delete('/invoices/:id', async (req, res) => {
  const id = idParam(req.params.id);
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'draft') throw new HttpError(409, `Only drafts can be deleted; void a ${inv.status} invoice instead`);
    await client.query('DELETE FROM invoices WHERE id = $1', [id]);
  });
  res.status(204).end();
});

// ---- payments ------------------------------------------------------------------------------------
// POST   /invoices/:id/payments   { paymentDate?, amount, method?, reference? }
// DELETE /invoices/:id/payments/:paymentId

const paymentBody = z.strictObject({
  paymentDate: z.iso.date().optional(),
  amount: z.number().positive().max(9_999_999_999.99),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().max(200).optional(),
});

invoiceRoutes.post('/invoices/:id/payments', async (req, res) => {
  const id = idParam(req.params.id);
  const body = paymentBody.parse(req.body ?? {});
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'sent') throw new HttpError(409, `Payments can only be recorded on sent invoices; this invoice is ${inv.status}`);
    const { rows: [t] } = await client.query('SELECT balance FROM invoice_totals WHERE invoice_id = $1', [id]);
    if (body.amount > t.balance + 0.004) {
      throw new HttpError(400, `That's more than the ${t.balance.toFixed(2)} balance`);
    }
    await client.query(
      `INSERT INTO invoice_payments (invoice_id, payment_date, amount, method, reference) VALUES ($1, $2, $3, $4, $5)`,
      [id, body.paymentDate ?? today(), body.amount, body.method ?? 'ACH', body.reference ?? ''],
    );
  });
  res.status(201).json({ data: await requireInvoice(pool, id) });
});

invoiceRoutes.delete('/invoices/:id/payments/:paymentId', async (req, res) => {
  const id = idParam(req.params.id);
  const paymentId = idParam(req.params.paymentId, 'Payment');
  await transaction(async (client) => {
    const inv = await lockInvoice(client, id);
    if (inv.status !== 'sent') throw new HttpError(409, `This invoice is ${inv.status}, so its payments can't change`);
    const { rowCount } = await client.query('DELETE FROM invoice_payments WHERE id = $1 AND invoice_id = $2', [paymentId, id]);
    if (!rowCount) throw notFound('Payment');
  });
  res.json({ data: await requireInvoice(pool, id) });
});
