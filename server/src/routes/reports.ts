// Read-only reports. The math follows the prototype's Budgets, Reports,
// Accounting, Invoices and Mileage screens.
//
// Periods are from/to dates (inclusive). Leave them out for all time.
// The frontend turns choices like "This month" or "Q3" into dates.

import { Router } from 'express';
import { z } from 'zod';
import { camelRow, pool } from '../db.ts';

export const reportRoutes = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 10_000) / 10_000 : null);
const today = () => new Date().toISOString().slice(0, 10);
const thisYear = () => Number(today().slice(0, 4));

/** IRS threshold for a 1099-NEC, as the prototype uses it. */
export const NEC_THRESHOLD = 2000;

const period = z.object({
  from: z.iso.date().default('0001-01-01'),
  to: z.iso.date().default('9999-12-31'),
}).refine((p) => p.from <= p.to, 'from must be on or before to');

const year = z.coerce.number().int().min(1900).max(9999);

// Each trip with the IRS rate in effect on its date (0 if none is set).
const TRIPS_WITH_RATE = `
  SELECT t.*, coalesce((
    SELECT r.rate_per_mile FROM mileage_rates r
    WHERE r.kind = t.kind AND r.effective_date <= t.trip_date
    ORDER BY r.effective_date DESC LIMIT 1), 0) AS rate
  FROM trips t`;

// Open invoices (sent with a balance), with totals.
const OPEN_INVOICES = `
  SELECT i.*, a.name AS account_name, t.total, t.paid, t.balance
  FROM invoices i JOIN accounts a ON a.id = i.account_id JOIN invoice_totals t ON t.invoice_id = i.id
  WHERE i.status = 'sent' AND t.balance > 0.004`;

// ---- budgets -----------------------------------------------------------------------------
// GET /reports/budgets
// Every project with its tasks: budget vs actual hours (all statuses, all time),
// value, cost and margin. Projects where no task is billable are "internal"
// and have no value, cost or margin.

reportRoutes.get('/reports/budgets', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.id AS project_id, p.code, p.name AS project_name, p.type AS project_type,
           p.start_date, p.end_date, a.name AS account_name,
           t.id AS task_id, t.task_number, t.name AS task_name, t.type AS task_type, t.active,
           t.bill_rate, t.cost_rate, t.budget_hours, r.name AS resource_name,
           coalesce((SELECT sum(te.hours) FROM timesheet_lines tl JOIN time_entries te ON te.timesheet_line_id = tl.id
                     WHERE tl.task_id = t.id), 0) AS actual_hours
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    JOIN resources r ON r.id = t.resource_id
    LEFT JOIN accounts a ON a.id = p.account_id
    ORDER BY t.task_number`);

  const projects = new Map<string, any>();
  for (const row of rows) {
    const r = camelRow(row) as any;
    let p = projects.get(r.projectId);
    if (!p) {
      p = { projectId: r.projectId, code: r.code, name: r.projectName, type: r.projectType, accountName: r.accountName,
        startDate: r.startDate, endDate: r.endDate, tasks: [] as any[] };
      projects.set(r.projectId, p);
    }
    const flat = (r.taskType || r.projectType) === 'Flat Fee';
    const value = round2((flat ? r.budgetHours : r.actualHours) * r.billRate);
    const cost = round2(r.actualHours * r.costRate);
    p.tasks.push({
      taskId: r.taskId, taskNumber: r.taskNumber, name: r.taskName, type: r.taskType, active: r.active,
      resourceName: r.resourceName, billRate: r.billRate, costRate: r.costRate, billable: r.billRate > 0,
      budgetHours: r.budgetHours, actualHours: round2(r.actualHours),
      remainingHours: r.budgetHours ? round2(r.budgetHours - r.actualHours) : null,
      burn: ratio(r.actualHours, r.budgetHours),
      value, cost, margin: round2(value - cost),
    });
  }

  const data = [...projects.values()].map((p) => {
    const internal = p.tasks.every((t: any) => !t.billable);
    const sum = (k: string) => round2(p.tasks.reduce((s: number, t: any) => s + t[k], 0));
    const budgetHours = sum('budgetHours');
    const actualHours = sum('actualHours');
    if (internal) for (const t of p.tasks) t.value = t.cost = t.margin = null;
    return {
      ...p,
      internal,
      totals: {
        budgetHours, actualHours,
        remainingHours: budgetHours ? round2(budgetHours - actualHours) : null,
        burn: ratio(actualHours, budgetHours),
        value: internal ? null : sum('value'),
        cost: internal ? null : sum('cost'),
        margin: internal ? null : round2(sum('value') - sum('cost')),
      },
    };
  }).sort((a, b) => Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name));

  res.json({ data });
});

// ---- time ---------------------------------------------------------------------------------
// GET /reports/time?from=&to=&groupBy=client|project|resource|task
// Hours, billable hours, utilization, billing value, contractor cost and margin.
// Value uses each task's current bill rate; cost uses its cost (1099) rate.

const GROUPS = {
  client: `coalesce(a.name, '—')`,
  project: `p.name`,
  resource: `d.resource_name`,
  task: `d.task_name || ' · ' || coalesce(a.name, '—')`,
} as const;

const TIME_FROM = `
  FROM time_detail d
  JOIN projects p ON p.id = d.project_id
  LEFT JOIN accounts a ON a.id = d.account_id
  WHERE d.work_date BETWEEN $1 AND $2`;

function summarize(r: { hours: number; billableHours: number; value: number; cost: number }) {
  const hours = round2(r.hours), value = round2(r.value), cost = round2(r.cost);
  return {
    hours, billableHours: round2(r.billableHours), utilization: ratio(r.billableHours, r.hours),
    value, cost, margin: round2(value - cost), marginPct: ratio(value - cost, value),
  };
}

reportRoutes.get('/reports/time', async (req, res) => {
  const { from, to } = period.parse(req.query);
  const groupBy = z.enum(['client', 'project', 'resource', 'task']).default('client').parse(req.query.groupBy);
  const { rows } = await pool.query(
    `SELECT ${GROUPS[groupBy]} AS name,
            sum(d.hours) AS hours,
            coalesce(sum(d.hours) FILTER (WHERE d.bill_rate > 0), 0) AS billable_hours,
            sum(d.hours * d.bill_rate) AS value,
            sum(d.hours * d.cost_rate) AS cost
     ${TIME_FROM}
     GROUP BY 1 ORDER BY sum(d.hours) DESC, 1`,
    [from, to],
  );
  const groups = rows.map((r) => ({ name: r.name as string, ...summarize(camelRow(r) as any) }));
  const totals = summarize(groups.reduce(
    (t, g) => ({ hours: t.hours + g.hours, billableHours: t.billableHours + g.billableHours, value: t.value + g.value, cost: t.cost + g.cost }),
    { hours: 0, billableHours: 0, value: 0, cost: 0 },
  ));
  res.json({ data: { from, to, groupBy, totals, groups } });
});

// GET /reports/time/entries?from=&to=&limit=&offset=
// The day-lines behind the time report, newest first.
reportRoutes.get('/reports/time/entries', async (req, res) => {
  const { from, to } = period.parse(req.query);
  const { limit, offset } = z.object({
    limit: z.coerce.number().int().min(1).max(5000).default(500),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n ${TIME_FROM}`, [from, to]);
  const { rows } = await pool.query(
    `SELECT d.time_entry_id, d.work_date, d.resource_id, d.resource_name, a.name AS account_name,
            p.code AS project_code, p.name AS project_name, d.task_number, d.task_name, d.task_type,
            d.hours, d.bill_rate, d.cost_rate, (d.bill_rate > 0) AS billable,
            round(d.hours * d.bill_rate, 2) AS value, round(d.hours * d.cost_rate, 2) AS cost,
            d.timesheet_status, d.billed, d.note
     ${TIME_FROM}
     ORDER BY d.work_date DESC, d.resource_name, d.task_number
     LIMIT $3 OFFSET $4`,
    [from, to, limit, offset],
  );
  res.json({ data: rows.map(camelRow), total: n, limit, offset });
});

// ---- profit and loss ----------------------------------------------------------------------
// GET /reports/pnl?from=&to=&basis=cash|accrual
//
// Cash:    income = invoice payments received (by client) + manual ledger income;
//          expenses = ledger expenses.
// Accrual: income = sent invoices by issue date (by client) + manual ledger income;
//          expenses = ledger expenses, except contractor cost comes from timesheet
//          hours x cost rate instead of payments.
// The mileage deduction is reported alongside; it isn't a cash expense.

const basis = z.enum(['cash', 'accrual']).default('cash');
type Basis = z.infer<typeof basis>;

const revenueLabel = (account: string | null) => `Consulting revenue · ${account || 'Other'}`;

async function pnl(from: string, to: string, b: Basis) {
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};
  const add = (bucket: Record<string, number>, k: string, v: number) => {
    if (v) bucket[k] = round2((bucket[k] ?? 0) + v);
  };

  if (b === 'cash') {
    const { rows } = await pool.query(
      `SELECT a.name, sum(pm.amount) AS amount FROM invoice_payments pm
       JOIN invoices i ON i.id = pm.invoice_id JOIN accounts a ON a.id = i.account_id
       WHERE pm.payment_date BETWEEN $1 AND $2 GROUP BY a.name`, [from, to]);
    for (const r of rows) add(income, revenueLabel(r.name), r.amount);
  } else {
    const { rows } = await pool.query(
      `SELECT a.name, sum(t.total) AS amount FROM invoices i
       JOIN accounts a ON a.id = i.account_id JOIN invoice_totals t ON t.invoice_id = i.id
       WHERE i.status = 'sent' AND i.issue_date BETWEEN $1 AND $2 GROUP BY a.name`, [from, to]);
    for (const r of rows) add(income, revenueLabel(r.name), r.amount);
  }

  const { rows: ledger } = await pool.query(
    `SELECT type, category, sum(amount) AS amount FROM ledger_entries
     WHERE entry_date BETWEEN $1 AND $2 GROUP BY type, category`, [from, to]);
  for (const r of ledger) {
    if (r.type === 'income') add(income, r.category, r.amount);
    else if (!(b === 'accrual' && r.category === 'Contractors (1099)')) add(expenses, r.category, r.amount);
  }

  if (b === 'accrual') {
    const { rows: [c] } = await pool.query(
      `SELECT coalesce(sum(hours * cost_rate), 0) AS cost FROM time_detail
       WHERE contractor AND work_date BETWEEN $1 AND $2`, [from, to]);
    add(expenses, 'Contractors (1099)', c.cost);
  }

  const totalIncome = round2(Object.values(income).reduce((s, v) => s + v, 0));
  const totalExpenses = round2(Object.values(expenses).reduce((s, v) => s + v, 0));
  const sorted = (o: Record<string, number>) =>
    Object.entries(o).sort((x, y) => y[1] - x[1]).map(([category, amount]) => ({ category, amount }));
  return {
    income: sorted(income), expenses: sorted(expenses),
    totalIncome, totalExpenses, net: round2(totalIncome - totalExpenses), netMargin: ratio(totalIncome - totalExpenses, totalIncome),
  };
}

async function mileageDeduction(from: string, to: string) {
  const { rows: [r] } = await pool.query(
    `SELECT coalesce(sum(miles * rate), 0) AS value FROM (${TRIPS_WITH_RATE}) t WHERE trip_date BETWEEN $1 AND $2`,
    [from, to],
  );
  return round2(r.value);
}

reportRoutes.get('/reports/pnl', async (req, res) => {
  const { from, to } = period.parse(req.query);
  const b = basis.parse(req.query.basis);
  res.json({ data: { from, to, basis: b, ...(await pnl(from, to, b)), mileageDeduction: await mileageDeduction(from, to) } });
});

// GET /reports/pnl/monthly?year=&basis=
reportRoutes.get('/reports/pnl/monthly', async (req, res) => {
  const y = year.default(thisYear()).parse(req.query.year);
  const b = basis.parse(req.query.basis);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const p = await pnl(from, to, b);
    months.push({ month: m, from, to, income: p.totalIncome, expenses: p.totalExpenses, net: p.net });
  }
  res.json({ data: { year: y, basis: b, months } });
});

// ---- receivables aging ------------------------------------------------------------------------
// GET /reports/receivables?asOf=
// Open balances by client and by days past due.

const BUCKETS = [
  { key: 'current', label: 'Current', min: -Infinity, max: 0 },
  { key: 'days1to30', label: '1–30 days', min: 1, max: 30 },
  { key: 'days31to60', label: '31–60 days', min: 31, max: 60 },
  { key: 'days61to90', label: '61–90 days', min: 61, max: 90 },
  { key: 'over90', label: 'Over 90', min: 91, max: Infinity },
] as const;
type BucketKey = (typeof BUCKETS)[number]['key'];

reportRoutes.get('/reports/receivables', async (req, res) => {
  const asOf = z.iso.date().default(today()).parse(req.query.asOf);
  const { rows } = await pool.query(
    `SELECT *, ($1::date - due_date) AS days_late FROM (${OPEN_INVOICES}) o ORDER BY due_date, number`, [asOf]);

  const blank = () => Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
  const totals = { ...blank(), total: 0 };
  const clients = new Map<string, any>();
  const invoices = rows.map((row) => {
    const r = camelRow(row) as any;
    const bucket = BUCKETS.find((b) => r.daysLate >= b.min && r.daysLate <= b.max)!.key;
    let c = clients.get(r.accountId);
    if (!c) {
      c = { accountId: r.accountId, accountName: r.accountName, ...blank(), total: 0 };
      clients.set(r.accountId, c);
    }
    for (const t of [c, totals]) {
      t[bucket] = round2(t[bucket] + r.balance);
      t.total = round2(t.total + r.balance);
    }
    return { invoiceId: r.id, number: r.number, accountId: r.accountId, accountName: r.accountName,
      issueDate: r.issueDate, dueDate: r.dueDate, daysLate: r.daysLate, bucket, total: r.total, paid: r.paid, balance: r.balance };
  });
  res.json({
    data: {
      asOf,
      buckets: BUCKETS.map(({ key, label }) => ({ key, label })),
      clients: [...clients.values()].sort((a, b) => b.total - a.total),
      totals,
      invoices,
    },
  });
});

// ---- contractors ----------------------------------------------------------------------------------
// GET /reports/contractors?year=
// For each 1099 contractor: hours and cost from timesheets in the year, payments
// in the year, what's still owed (all-time cost minus all-time payments), and
// whether a 1099-NEC is needed (paid NEC_THRESHOLD or more in the year).

reportRoutes.get('/reports/contractors', async (req, res) => {
  const y = year.default(thisYear()).parse(req.query.year);
  const from = `${y}-01-01`, to = `${y}-12-31`;
  const { rows } = await pool.query(
    `SELECT r.id AS resource_id, r.name, r.active,
       coalesce((SELECT sum(hours) FROM time_detail d WHERE d.resource_id = r.id AND d.work_date BETWEEN $1 AND $2), 0) AS hours,
       coalesce((SELECT sum(hours * cost_rate) FROM time_detail d WHERE d.resource_id = r.id AND d.work_date BETWEEN $1 AND $2), 0) AS cost,
       coalesce((SELECT sum(hours * cost_rate) FROM time_detail d WHERE d.resource_id = r.id), 0) AS cost_all_time,
       coalesce((SELECT sum(amount) FROM ledger_entries l WHERE l.resource_id = r.id AND l.category = 'Contractors (1099)'
                 AND l.entry_date BETWEEN $1 AND $2), 0) AS paid,
       coalesce((SELECT sum(amount) FROM ledger_entries l WHERE l.resource_id = r.id AND l.category = 'Contractors (1099)'), 0) AS paid_all_time
     FROM resources r WHERE r.contractor ORDER BY r.name`,
    [from, to],
  );
  const data = rows.map((row) => {
    const r = camelRow(row) as any;
    const paid = round2(r.paid);
    return {
      resourceId: r.resourceId, name: r.name, active: r.active,
      hours: round2(r.hours), cost: round2(r.cost), paid,
      owed: round2(Math.max(0, r.costAllTime - r.paidAllTime)),
      needs1099: paid >= NEC_THRESHOLD,
    };
  });
  res.json({ data: { year: y, threshold: NEC_THRESHOLD, contractors: data, totalOwed: round2(data.reduce((s, c) => s + c.owed, 0)) } });
});

// ---- invoicing summary ----------------------------------------------------------------------------
// GET /reports/invoicing?year=
// The numbers across the top of the Invoices screen.

reportRoutes.get('/reports/invoicing', async (req, res) => {
  const y = year.default(thisYear()).parse(req.query.year);
  const from = `${y}-01-01`, to = `${y}-12-31`;
  const { rows: [open] } = await pool.query(
    `SELECT count(*)::int AS n, coalesce(sum(balance), 0) AS amount,
            count(*) FILTER (WHERE due_date < current_date)::int AS overdue_n,
            coalesce(sum(balance) FILTER (WHERE due_date < current_date), 0) AS overdue_amount
     FROM (${OPEN_INVOICES}) o`);
  const { rows: [unbilled] } = await pool.query(
    `SELECT coalesce(sum(hours), 0) AS hours, coalesce(sum(hours * bill_rate), 0) AS amount
     FROM time_detail WHERE NOT billed AND bill_rate > 0 AND account_id IS NOT NULL AND task_type <> 'Flat Fee'`);
  const { rows: [invoiced] } = await pool.query(
    `SELECT coalesce(sum(t.total), 0) AS amount FROM invoices i JOIN invoice_totals t ON t.invoice_id = i.id
     WHERE i.status = 'sent' AND i.issue_date BETWEEN $1 AND $2`, [from, to]);
  const { rows: [collected] } = await pool.query(
    `SELECT coalesce(sum(amount), 0) AS amount FROM invoice_payments WHERE payment_date BETWEEN $1 AND $2`, [from, to]);
  res.json({
    data: {
      year: y,
      outstanding: { amount: round2(open.amount), count: open.n },
      overdue: { amount: round2(open.overdue_amount), count: open.overdue_n },
      unbilled: { amount: round2(unbilled.amount), hours: round2(unbilled.hours) },
      invoiced: round2(invoiced.amount),
      collected: round2(collected.amount),
    },
  });
});

// ---- mileage ----------------------------------------------------------------------------------------
// GET /reports/mileage?from=&to=
// Miles and deduction value (miles x IRS rate on the trip date) by month, client,
// vehicle and kind.

reportRoutes.get('/reports/mileage', async (req, res) => {
  const { from, to } = period.parse(req.query);
  const base = `FROM (${TRIPS_WITH_RATE}) t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    WHERE t.trip_date BETWEEN $1 AND $2`;
  const agg = `count(*)::int AS trips, sum(t.miles) AS miles, sum(t.miles * t.rate) AS value`;
  const group = async (expr: string, order = '1') =>
    (await pool.query(`SELECT ${expr} AS name, ${agg} ${base} GROUP BY 1 ORDER BY ${order}`, [from, to])).rows
      .map((r) => ({ name: r.name, trips: r.trips, miles: round2(r.miles), value: round2(r.value) }));

  const [totals] = (await pool.query(`SELECT ${agg} ${base}`, [from, to])).rows;
  res.json({
    data: {
      from, to,
      totals: { trips: totals.trips, miles: round2(totals.miles ?? 0), value: round2(totals.value ?? 0) },
      byMonth: await group(`to_char(t.trip_date, 'YYYY-MM')`),
      byClient: await group(`coalesce(a.name, nullif(t.client_name, ''), '—')`, 'sum(t.miles) DESC, 1'),
      byVehicle: await group(`coalesce(v.name, '—')`, 'sum(t.miles) DESC, 1'),
      byKind: await group(`t.kind`),
    },
  });
});
