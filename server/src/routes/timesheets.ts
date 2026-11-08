// Weekly timesheets.
//
// A timesheet is one resource's week (starting Monday). The API exposes it as a
// grid: one line per task with seven daily hour values, Monday first. In the
// database each non-zero day is a time_entries row, so invoices can point at
// exactly the hours they bill.
//
// Status flow (same as the prototype):
//   draft | returned --submit--> submitted --approve--> approved
//   submitted --return--> returned       submitted --recall--> draft
//   approved --reopen--> draft
// Hours can only be changed while the sheet is draft or returned, and hours
// that are already on an invoice can never be changed here.

import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { camelRow, pool, query, transaction } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';

export const timesheetRoutes = Router();

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['draft', 'submitted', 'approved', 'returned'] as const;
type Status = (typeof STATUSES)[number];
const EDITABLE: Status[] = ['draft', 'returned'];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds days to a YYYY-MM-DD date without time-zone surprises. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const monday = z.iso.date().refine((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1, 'Weeks start on a Monday');

const weekParamsSchema = z.object({ resourceId: z.string(), weekStart: monday });
const weekParams = {
  parse(params: unknown) {
    const p = weekParamsSchema.parse(params);
    if (!UUID.test(p.resourceId)) throw notFound('Resource');
    return p;
  },
};

function sheetIdParam(raw: string): string {
  if (!UUID.test(raw)) throw notFound('Timesheet');
  return raw;
}

// ---- loading a sheet as a grid ------------------------------------------------

interface GridLine {
  id: string;
  taskId: string;
  taskNumber: number;
  taskName: string;
  taskType: string;
  taskActive: boolean;
  billRate: number;
  costRate: number;
  projectId: string;
  projectCode: string;
  projectName: string;
  accountId: string | null;
  accountName: string | null;
  note: string;
  hours: number[];
  billed: boolean[];
}

async function loadSheet(db: Queryable, id: string) {
  const sheetRes = await db.query(
    `SELECT ts.*, r.name AS resource_name FROM timesheets ts
     JOIN resources r ON r.id = ts.resource_id WHERE ts.id = $1`,
    [id],
  );
  if (!sheetRes.rows[0]) return null;
  const sheet = camelRow(sheetRes.rows[0]);

  const linesRes = await db.query(
    `SELECT tl.id, tl.task_id, tl.note, t.task_number, t.name AS task_name, t.type AS task_type,
            t.active AS task_active, t.bill_rate, t.cost_rate,
            p.id AS project_id, p.code AS project_code, p.name AS project_name,
            a.id AS account_id, a.name AS account_name
     FROM timesheet_lines tl
     JOIN tasks t ON t.id = tl.task_id
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN accounts a ON a.id = p.account_id
     WHERE tl.timesheet_id = $1
     ORDER BY tl.sort_order, t.task_number`,
    [id],
  );
  const entriesRes = await db.query(
    `SELECT te.timesheet_line_id, te.work_date, te.hours, (b.time_entry_id IS NOT NULL) AS billed
     FROM time_entries te
     JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
     LEFT JOIN invoice_line_time_entries b ON b.time_entry_id = te.id
     WHERE tl.timesheet_id = $1`,
    [id],
  );

  const weekStart = sheet.weekStart as string;
  const lines: GridLine[] = linesRes.rows.map((r) => ({
    ...(camelRow(r) as unknown as Omit<GridLine, 'hours' | 'billed'>),
    hours: [0, 0, 0, 0, 0, 0, 0],
    billed: [false, false, false, false, false, false, false],
  }));
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const e of entriesRes.rows) {
    const line = byId.get(e.timesheet_line_id);
    const day = Math.round((Date.parse(e.work_date + 'T00:00:00Z') - Date.parse(weekStart + 'T00:00:00Z')) / 864e5);
    if (!line || day < 0 || day > 6) continue;
    line.hours[day] = e.hours;
    line.billed[day] = e.billed;
  }

  const totals = { hours: 0, billableHours: 0, billValue: 0, cost: 0, days: [0, 0, 0, 0, 0, 0, 0] };
  for (const l of lines) {
    l.hours.forEach((h, i) => {
      totals.days[i] = round2(totals.days[i]! + h);
      totals.hours += h;
      totals.billValue += h * l.billRate;
      totals.cost += h * l.costRate;
      if (l.billRate > 0) totals.billableHours += h;
    });
  }
  totals.hours = round2(totals.hours);
  totals.billableHours = round2(totals.billableHours);
  totals.billValue = round2(totals.billValue);
  totals.cost = round2(totals.cost);

  return { ...sheet, lines, totals };
}

async function requireSheet(db: Queryable, id: string) {
  const sheet = await loadSheet(db, id);
  if (!sheet) throw notFound('Timesheet');
  return sheet;
}

async function requireResource(db: Queryable, id: string) {
  const { rows } = await db.query('SELECT id, name FROM resources WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Resource');
  return rows[0] as { id: string; name: string };
}

/** Finds or creates the sheet for a resource's week and locks it for this transaction. */
async function lockWeek(client: pg.PoolClient, resourceId: string, weekStart: string) {
  await requireResource(client, resourceId);
  await client.query(
    'INSERT INTO timesheets (resource_id, week_start) VALUES ($1, $2) ON CONFLICT (resource_id, week_start) DO NOTHING',
    [resourceId, weekStart],
  );
  const { rows } = await client.query(
    'SELECT id, status FROM timesheets WHERE resource_id = $1 AND week_start = $2 FOR UPDATE',
    [resourceId, weekStart],
  );
  return rows[0] as { id: string; status: Status };
}

function assertEditable(status: Status) {
  if (!EDITABLE.includes(status)) {
    throw new HttpError(409, `This timesheet is ${status}, so its hours are locked`);
  }
}

// ---- list ---------------------------------------------------------------------
// GET /timesheets?resourceId=&status=&from=&to=&limit=&offset=
// from/to filter on week_start. Use status=submitted for the approvals queue.

const listQuery = z.object({
  resourceId: z.uuid().optional(),
  status: z.enum(STATUSES).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

timesheetRoutes.get('/timesheets', async (req, res) => {
  const f = listQuery.parse(req.query);
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace('?', '$' + values.length));
  };
  if (f.resourceId) add('ts.resource_id = ?', f.resourceId);
  if (f.status) add('ts.status = ?', f.status);
  if (f.from) add('ts.week_start >= ?', f.from);
  if (f.to) add('ts.week_start <= ?', f.to);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [count] = await query(`SELECT count(*) AS n FROM timesheets ts ${whereSql}`, values);
  values.push(f.limit, f.offset);
  const rows = await query(
    `SELECT ts.*, r.name AS resource_name,
            coalesce(sum(te.hours), 0) AS total_hours,
            coalesce(sum(te.hours) FILTER (WHERE t.bill_rate > 0), 0) AS billable_hours,
            coalesce(sum(te.hours * t.bill_rate), 0) AS bill_value
     FROM timesheets ts
     JOIN resources r ON r.id = ts.resource_id
     LEFT JOIN timesheet_lines tl ON tl.timesheet_id = ts.id
     LEFT JOIN tasks t ON t.id = tl.task_id
     LEFT JOIN time_entries te ON te.timesheet_line_id = tl.id
     ${whereSql}
     GROUP BY ts.id, r.name
     ORDER BY ts.week_start DESC, r.name
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  res.json({ data: rows, total: count!.n, limit: f.limit, offset: f.offset });
});

// ---- one sheet --------------------------------------------------------------------

timesheetRoutes.get('/timesheets/:id', async (req, res) => {
  res.json({ data: await requireSheet(pool, sheetIdParam(req.params.id)) });
});

// GET /resources/:resourceId/timesheets/:weekStart
// Returns the sheet for that week, or an empty draft (id: null) if none is saved yet.
timesheetRoutes.get('/resources/:resourceId/timesheets/:weekStart', async (req, res) => {
  const { resourceId, weekStart } = weekParams.parse(req.params);
  const resource = await requireResource(pool, resourceId);
  const [row] = await query('SELECT id FROM timesheets WHERE resource_id = $1 AND week_start = $2', [resourceId, weekStart]);
  if (row) return void res.json({ data: await requireSheet(pool, row.id as string) });
  res.json({
    data: {
      id: null, resourceId, resourceName: resource.name, weekStart, status: 'draft',
      submittedAt: null, approvedAt: null, approvedBy: null, returnNote: '',
      lines: [], totals: { hours: 0, billableHours: 0, billValue: 0, cost: 0, days: [0, 0, 0, 0, 0, 0, 0] },
    },
  });
});

// ---- save the grid ----------------------------------------------------------------
// PUT /resources/:resourceId/timesheets/:weekStart
// { lines: [{ taskId, note?, hours: [mon..sun] }] }
// Replaces the sheet's lines with these, in this order. Creates the sheet if needed.

const hoursValue = z.number().min(0).max(24);
const saveBody = z.strictObject({
  lines: z.array(z.strictObject({
    taskId: z.uuid(),
    note: z.string().max(2000).optional(),
    hours: z.array(hoursValue).length(7, 'Send 7 values, Monday to Sunday'),
  })).max(100),
});

timesheetRoutes.put('/resources/:resourceId/timesheets/:weekStart', async (req, res) => {
  const { resourceId, weekStart } = weekParams.parse(req.params);
  const { lines } = saveBody.parse(req.body ?? {});
  const hoursOf = (l: (typeof lines)[number]) => l.hours.map(round2);

  const taskIds = lines.map((l) => l.taskId);
  if (new Set(taskIds).size !== taskIds.length) throw new HttpError(400, 'Each task can appear only once on a timesheet');
  for (let day = 0; day < 7; day++) {
    const total = round2(lines.reduce((s, l) => s + hoursOf(l)[day]!, 0));
    if (total > 24) throw new HttpError(400, `${addDays(weekStart, day)} adds up to ${total} hours; a day can't be more than 24`);
  }

  const id = await transaction(async (client) => {
    const sheet = await lockWeek(client, resourceId, weekStart);
    assertEditable(sheet.status);

    const existingLines = (await client.query(
      'SELECT id, task_id FROM timesheet_lines WHERE timesheet_id = $1', [sheet.id],
    )).rows as { id: string; task_id: string }[];
    const lineByTask = new Map(existingLines.map((l) => [l.task_id, l.id]));

    // Tasks must exist and belong to this resource. New lines need an active task;
    // a line already on the sheet may keep a task that was deactivated since.
    if (taskIds.length) {
      const { rows: tasks } = await client.query(
        'SELECT id, resource_id, active, task_number FROM tasks WHERE id = ANY($1::uuid[])', [taskIds],
      );
      const byId = new Map(tasks.map((t) => [t.id as string, t]));
      for (const tid of taskIds) {
        const t = byId.get(tid);
        if (!t) throw new HttpError(400, `Task ${tid} does not exist`);
        if (t.resource_id !== resourceId) throw new HttpError(400, `Task #${t.task_number} belongs to a different resource`);
        if (!t.active && !lineByTask.has(tid)) throw new HttpError(400, `Task #${t.task_number} is inactive`);
      }
    }

    const { rows: entries } = await client.query(
      `SELECT te.id, te.timesheet_line_id, te.work_date, te.hours, (b.time_entry_id IS NOT NULL) AS billed
       FROM time_entries te JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
       LEFT JOIN invoice_line_time_entries b ON b.time_entry_id = te.id
       WHERE tl.timesheet_id = $1`,
      [sheet.id],
    );
    const entryKey = (lineId: string, date: string) => lineId + '|' + date;
    const entryMap = new Map(entries.map((e) => [entryKey(e.timesheet_line_id, e.work_date), e]));
    const billedError = (date: string) =>
      new HttpError(409, `Hours on ${date} are already on an invoice and can't be changed`);

    // Remove lines that are no longer on the grid.
    const keep = new Set(taskIds);
    for (const l of existingLines) {
      if (keep.has(l.task_id)) continue;
      const billed = entries.find((e) => e.timesheet_line_id === l.id && e.billed);
      if (billed) throw billedError(billed.work_date);
      await client.query('DELETE FROM timesheet_lines WHERE id = $1', [l.id]);
    }

    // Upsert each line and its seven days.
    for (const [order, line] of lines.entries()) {
      const { rows: [saved] } = await client.query(
        `INSERT INTO timesheet_lines (timesheet_id, task_id, note, sort_order) VALUES ($1, $2, $3, $4)
         ON CONFLICT (timesheet_id, task_id) DO UPDATE SET note = EXCLUDED.note, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [sheet.id, line.taskId, line.note ?? '', order],
      );
      const hours = hoursOf(line);
      for (let day = 0; day < 7; day++) {
        const date = addDays(weekStart, day);
        const h = hours[day]!;
        const existing = entryMap.get(entryKey(saved.id, date));
        if (existing) {
          if (existing.hours === h) continue;
          if (existing.billed) throw billedError(date);
          if (h === 0) await client.query('DELETE FROM time_entries WHERE id = $1', [existing.id]);
          else await client.query('UPDATE time_entries SET hours = $2 WHERE id = $1', [existing.id, h]);
        } else if (h > 0) {
          await client.query(
            'INSERT INTO time_entries (timesheet_line_id, work_date, hours) VALUES ($1, $2, $3)', [saved.id, date, h],
          );
        }
      }
    }
    await client.query('UPDATE timesheets SET updated_at = now() WHERE id = $1', [sheet.id]);
    return sheet.id;
  });

  res.json({ data: await requireSheet(pool, id) });
});

// ---- copy lines from the previous sheet --------------------------------------------
// POST /resources/:resourceId/timesheets/:weekStart/copy-previous
// Adds the task lines (with zero hours) from this resource's most recent earlier
// sheet. Skips tasks already on this week and tasks that are now inactive.

timesheetRoutes.post('/resources/:resourceId/timesheets/:weekStart/copy-previous', async (req, res) => {
  const { resourceId, weekStart } = weekParams.parse(req.params);
  const result = await transaction(async (client) => {
    await requireResource(client, resourceId);
    const { rows: [prev] } = await client.query(
      `SELECT id, week_start FROM timesheets WHERE resource_id = $1 AND week_start < $2
       ORDER BY week_start DESC LIMIT 1`,
      [resourceId, weekStart],
    );
    if (!prev) throw new HttpError(404, 'No earlier timesheet to copy from');

    const sheet = await lockWeek(client, resourceId, weekStart);
    assertEditable(sheet.status);
    const { rows: [{ n: start }] } = await client.query(
      'SELECT coalesce(max(sort_order) + 1, 0) AS n FROM timesheet_lines WHERE timesheet_id = $1', [sheet.id],
    );
    const { rowCount } = await client.query(
      `INSERT INTO timesheet_lines (timesheet_id, task_id, sort_order)
       SELECT $1, pl.task_id, $3 + row_number() OVER (ORDER BY pl.sort_order) - 1
       FROM timesheet_lines pl JOIN tasks t ON t.id = pl.task_id
       WHERE pl.timesheet_id = $2 AND t.active
       ON CONFLICT (timesheet_id, task_id) DO NOTHING`,
      [sheet.id, prev.id, start],
    );
    return { id: sheet.id, added: rowCount ?? 0, copiedFrom: prev.week_start as string };
  });
  const sheet = await requireSheet(pool, result.id);
  res.json({ data: sheet, added: result.added, copiedFrom: result.copiedFrom });
});

// ---- status changes ---------------------------------------------------------------------

interface Transition {
  from: Status[];
  to: Status;
  set: string;               // extra SET clauses; $2 is the optional body value
  bodySchema?: z.ZodType<{ value?: unknown }>;
}

const TRANSITIONS: Record<string, Transition> = {
  submit:  { from: ['draft', 'returned'], to: 'submitted', set: 'submitted_at = now()' },
  recall:  { from: ['submitted'], to: 'draft', set: 'submitted_at = NULL' },
  approve: { from: ['submitted'], to: 'approved', set: 'approved_at = now(), approved_by = $2' },
  return:  { from: ['submitted'], to: 'returned', set: 'return_note = $2' },
  reopen:  { from: ['approved'], to: 'draft', set: 'approved_at = NULL, approved_by = NULL' },
};

const approveBody = z.strictObject({ approvedBy: z.uuid().nullable().optional() });
const returnBody = z.strictObject({ note: z.string().max(2000).optional() });

timesheetRoutes.post('/timesheets/:id/:action', async (req, res) => {
  const id = sheetIdParam(req.params.id);
  const action = req.params.action;
  const t = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : undefined;
  if (!t) throw new HttpError(404, `No endpoint for POST ${req.originalUrl}`);

  let param: unknown = null;
  if (action === 'approve') param = approveBody.parse(req.body ?? {}).approvedBy ?? null;
  else if (action === 'return') param = returnBody.parse(req.body ?? {}).note ?? '';
  else if (req.body && Object.keys(req.body).length) throw new HttpError(400, `${action} takes no fields`);

  await transaction(async (client) => {
    const { rows: [sheet] } = await client.query('SELECT status FROM timesheets WHERE id = $1 FOR UPDATE', [id]);
    if (!sheet) throw notFound('Timesheet');
    if (!t.from.includes(sheet.status)) {
      throw new HttpError(409, `Can't ${action} a timesheet that is ${sheet.status}`);
    }
    if (action === 'submit') {
      const { rows: [{ n }] } = await client.query(
        `SELECT count(*) AS n FROM time_entries te JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
         WHERE tl.timesheet_id = $1`, [id],
      );
      if (!n) throw new HttpError(409, 'Add some hours before submitting');
    }
    const usesParam = t.set.includes('$2');
    await client.query(
      `UPDATE timesheets SET status = '${t.to}', ${t.set} WHERE id = $1`,
      usesParam ? [id, param] : [id],
    );
  });
  res.json({ data: await requireSheet(pool, id) });
});

// ---- delete -----------------------------------------------------------------------------
// Only draft or returned sheets with no invoiced hours.

timesheetRoutes.delete('/timesheets/:id', async (req, res) => {
  const id = sheetIdParam(req.params.id);
  await transaction(async (client) => {
    const { rows: [sheet] } = await client.query('SELECT status FROM timesheets WHERE id = $1 FOR UPDATE', [id]);
    if (!sheet) throw notFound('Timesheet');
    assertEditable(sheet.status);
    await client.query('DELETE FROM timesheets WHERE id = $1', [id]);
  });
  res.status(204).end();
});
