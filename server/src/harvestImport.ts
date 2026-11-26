// Harvest import: brings time tracked in Harvest into timesheets.
//
// Used by scripts/import-harvest.ts (which reads the CSV, backs up the database and
// prints the report). Rules, as agreed for the November 2026 import:
//
// - Each Harvest project/task goes to the Beaman Console task in TASK_MAP, or, for the
//   projects in PROJECT_MAP, to a task with the Harvest task's name in that project
//   (created when missing, at Harvest's billable rate; 0 means internal). New tasks are
//   active only if they have Harvest time in the file's last 60 days, so old ones don't
//   crowd the timesheet's task list.
// - The person is Brad Anderson unless the task names Richard Bennion or Onel Jiminez.
// - Beaman Console wins: a day that already has time entered in the app for that person
//   gets nothing from Harvest.
// - Entries marked Invoiced in Harvest are stored as billed outside the app, so they
//   count in reports and budgets but never show as ready to invoice.
// - New weekly timesheets are approved. Several Harvest entries for the same task and
//   day are added together; their notes go on the timesheet line.
// - Imported time is labelled source = 'harvest', so running the import again skips
//   what's already there.

import type pg from 'pg';

export interface HarvestRow {
  /** YYYY-MM-DD */
  date: string;
  client: string;
  project: string;
  task: string;
  notes: string;
  hours: number;
  invoiced: boolean;
  billableRate: number;
}

/** Harvest "project|task" -> existing Beaman Console task number. */
export const TASK_MAP: Record<string, number> = {
  'ERP Implementation|McElroys ERP Implementation': 501,
  "McElroy's Travel Stipend|McElroy's Travel Stipend": 502,
  'Beaman Consulting Projects|Beaman Admin': 510,
  'Beaman Consulting Projects|Beaman Networking': 511,
  'Beaman Consulting Projects|Beaman PTO': 512,
  'Fight Club Volunteer|Fight Club Volunteer': 513,
  'Consulting Services|WavelengthQ: Brad Anderson': 506,
  'Onel Jiminez|WavelengthQ: Onel Jiminez': 508,
  'Modernization Assessment|SPT: Brad Anderson': 503,
  'Modernization Assessment|SPT: Richard Bennion': 517,
};

/** Harvest project -> Beaman Console project (created when missing, with its account). */
export const PROJECT_MAP: Record<string, { code: string; name: string; account: string; accountType?: string }> = {
  zBeaman: { code: 'ZBEAMAN', name: 'zBeaman (Core Catalysts)', account: 'Core Catalysts' },
  'Core Catalysts Projects': { code: 'CC', name: 'Core Catalysts Projects', account: 'Core Catalysts' },
  'AMRT Project': { code: 'AMRT', name: 'AMRT Project', account: 'AMRT Holdings', accountType: 'Prospect' },
  'JAW Services': { code: 'JAW', name: 'JAW Services', account: 'JAW Portfolio Services', accountType: 'Client' },
  'Beaman Consulting Projects': { code: 'BC', name: 'Beaman Operations', account: 'Beaman Consulting' },
};

/** Who did the work: Brad, unless the task (or project) names someone else. */
export function personFor(row: Pick<HarvestRow, 'project' | 'task'>) {
  const text = `${row.project} ${row.task}`;
  if (/Richard Bennion/i.test(text)) return 'Richard Bennion';
  if (/Onel Jiminez/i.test(text)) return 'Onel Jiminez';
  return 'Brad Anderson';
}

/** The Monday on or before a date. */
const mondayOf = (date: string) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const lc = (s: string) => s.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HarvestReport {
  applied: boolean;
  rows: number;
  hours: number;
  imported: { rows: number; hours: number; timeEntries: number; billedOutside: number };
  skipped: { reason: string; rows: number; hours: number }[];
  created: { accounts: string[]; projects: string[]; tasks: string[]; timesheets: number };
  /** Hours imported per Beaman Console task, for the summary. */
  byTask: { task: string; rows: number; hours: number }[];
}

export async function importHarvest(client: pg.PoolClient, rows: HarvestRow[], applied: boolean): Promise<HarvestReport> {
  const report: HarvestReport = {
    applied, rows: rows.length, hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
    imported: { rows: 0, hours: 0, timeEntries: 0, billedOutside: 0 },
    skipped: [], created: { accounts: [], projects: [], tasks: [], timesheets: 0 }, byTask: [],
  };
  const skips = new Map<string, { rows: number; hours: number }>();
  const skip = (reason: string, rs: HarvestRow[]) => {
    const s = skips.get(reason) ?? { rows: 0, hours: 0 };
    s.rows += rs.length;
    s.hours = round2(s.hours + rs.reduce((n, r) => n + r.hours, 0));
    skips.set(reason, s);
  };

  // ---- what's there now ----
  const { rows: resources } = await client.query<{ id: string; name: string }>('SELECT id, name FROM resources');
  const resourceId = new Map(resources.map((r) => [lc(r.name), r.id]));
  const { rows: tasks } = await client.query<{ id: string; task_number: number; name: string; project_id: string; resource_id: string }>(
    'SELECT id, task_number, name, project_id, resource_id FROM tasks');
  const taskByNumber = new Map(tasks.map((t) => [t.task_number, t]));
  let nextTaskNumber = Math.max(0, ...tasks.map((t) => t.task_number)) + 1;
  const { rows: projects } = await client.query<{ id: string; code: string }>('SELECT id, code FROM projects');
  const projectByCode = new Map(projects.map((p) => [p.code, p.id]));
  const { rows: accounts } = await client.query<{ id: string; name: string; aliases: string[] }>('SELECT id, name, aliases FROM accounts');

  // Days that already have time: entered in the app (Beaman Console wins) or imported before.
  const { rows: existing } = await client.query<{ resource_id: string; work_date: string; task_id: string; source: string }>(
    `SELECT ts.resource_id, te.work_date::text AS work_date, tl.task_id, te.source
     FROM time_entries te JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id JOIN timesheets ts ON ts.id = tl.timesheet_id`);
  const appDays = new Set(existing.filter((e) => e.source !== 'harvest').map((e) => `${e.resource_id}|${e.work_date}`));
  const imported = new Set(existing.filter((e) => e.source === 'harvest').map((e) => `${e.resource_id}|${e.work_date}|${e.task_id}`));

  async function accountFor(name: string, type?: string) {
    const hit = accounts.find((a) => [a.name, ...a.aliases].some((n) => lc(n) === lc(name)));
    if (hit) return hit.id;
    const { rows: [a] } = await client.query<{ id: string }>('INSERT INTO accounts (name, type) VALUES ($1, $2) RETURNING id', [name, type ?? null]);
    accounts.push({ id: a!.id, name, aliases: [] });
    report.created.accounts.push(name);
    return a!.id;
  }
  async function projectFor(harvestProject: string, firstDate: string) {
    const p = PROJECT_MAP[harvestProject]!;
    const known = projectByCode.get(p.code);
    if (known) return known;
    const accountId = await accountFor(p.account, p.accountType);
    const { rows: [row] } = await client.query<{ id: string }>(
      'INSERT INTO projects (code, name, account_id, start_date) VALUES ($1, $2, $3, $4) RETURNING id', [p.code, p.name, accountId, firstDate]);
    projectByCode.set(p.code, row!.id);
    report.created.projects.push(`${p.code} – ${p.name}`);
    return row!.id;
  }
  async function taskFor(projectId: string, name: string, personId: string, rate: number, active: boolean) {
    const hit = tasks.find((t) => t.project_id === projectId && t.resource_id === personId && lc(t.name) === lc(name));
    if (hit) return hit;
    const number = nextTaskNumber++;
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO tasks (task_number, project_id, resource_id, name, bill_rate, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [number, projectId, personId, name, rate, active]);
    const t = { id: row!.id, task_number: number, name, project_id: projectId, resource_id: personId };
    tasks.push(t);
    taskByNumber.set(number, t);
    report.created.tasks.push(`#${number} ${name}${active ? '' : ' (inactive)'}`);
    return t;
  }

  // ---- map each row to a person and a task ----
  const firstDate = new Map<string, string>();
  const maxRate = new Map<string, number>();
  const lastDate = new Map<string, string>();
  const newest = rows.reduce((m, r) => (r.date > m ? r.date : m), '');
  const recent = newest ? new Date(Date.parse(newest + 'T00:00:00Z') - 60 * 864e5).toISOString().slice(0, 10) : '';
  for (const r of rows) {
    const k = `${r.project}|${r.task}`;
    if (!lastDate.has(k) || r.date > lastDate.get(k)!) lastDate.set(k, r.date);
    if (!firstDate.has(r.project) || r.date < firstDate.get(r.project)!) firstDate.set(r.project, r.date);
    maxRate.set(k, Math.max(maxRate.get(k) ?? 0, r.billableRate));
  }
  const groups = new Map<string, { personId: string; taskId: string; label: string; date: string; rows: HarvestRow[] }>();
  for (const r of rows) {
    const personId = resourceId.get(lc(personFor(r)));
    if (!personId) { skip(`no resource named ${personFor(r)}`, [r]); continue; }
    const key = `${r.project}|${r.task}`;
    let task;
    if (TASK_MAP[key] !== undefined) {
      task = taskByNumber.get(TASK_MAP[key]!);
      if (!task) { skip(`task #${TASK_MAP[key]} is missing`, [r]); continue; }
    } else if (PROJECT_MAP[r.project]) {
      const projectId = await projectFor(r.project, firstDate.get(r.project)!);
      task = await taskFor(projectId, r.task, personId, maxRate.get(key) ?? 0, lastDate.get(key)! >= recent);
    } else {
      skip(`no mapping for ${r.project} › ${r.task}`, [r]);
      continue;
    }
    const g = `${personId}|${r.date}|${task.id}`;
    if (!groups.has(g)) groups.set(g, { personId, taskId: task.id, label: `#${task.task_number} ${task.name}`, date: r.date, rows: [] });
    groups.get(g)!.rows.push(r);
  }

  // ---- write ----
  const sheets = new Map<string, string>();
  async function sheetFor(personId: string, week: string) {
    const k = `${personId}|${week}`;
    if (sheets.has(k)) return sheets.get(k)!;
    const { rows: [found] } = await client.query<{ id: string }>('SELECT id FROM timesheets WHERE resource_id = $1 AND week_start = $2', [personId, week]);
    let id = found?.id;
    if (!id) {
      const { rows: [made] } = await client.query<{ id: string }>(
        `INSERT INTO timesheets (resource_id, week_start, status, submitted_at, approved_at) VALUES ($1, $2, 'approved', now(), now()) RETURNING id`,
        [personId, week]);
      id = made!.id;
      report.created.timesheets++;
    }
    sheets.set(k, id!);
    return id!;
  }
  const byTask = new Map<string, { rows: number; hours: number }>();
  for (const g of groups.values()) {
    if (appDays.has(`${g.personId}|${g.date}`)) { skip('Beaman Console already has time that day', g.rows); continue; }
    if (imported.has(`${g.personId}|${g.date}|${g.taskId}`)) { skip('already imported', g.rows); continue; }
    const hours = round2(g.rows.reduce((s, r) => s + r.hours, 0));
    const billedOutside = g.rows.every((r) => r.invoiced);
    const sheetId = await sheetFor(g.personId, mondayOf(g.date));
    const notes = g.rows.filter((r) => r.notes).map((r) => `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8))}: ${r.notes}`);
    const { rows: [line] } = await client.query<{ id: string; note: string }>(
      `INSERT INTO timesheet_lines (timesheet_id, task_id, sort_order)
       VALUES ($1, $2, (SELECT coalesce(max(sort_order), -1) + 1 FROM timesheet_lines WHERE timesheet_id = $1))
       ON CONFLICT (timesheet_id, task_id) DO UPDATE SET task_id = EXCLUDED.task_id RETURNING id, note`, [sheetId, g.taskId]);
    const extra = notes.filter((n) => !line!.note.includes(n));
    if (extra.length) await client.query('UPDATE timesheet_lines SET note = $2 WHERE id = $1', [line!.id, [line!.note, ...extra].filter(Boolean).join('\n')]);
    await client.query(
      `INSERT INTO time_entries (timesheet_line_id, work_date, hours, billed_outside, source) VALUES ($1, $2, $3, $4, 'harvest')`,
      [line!.id, g.date, hours, billedOutside]);
    report.imported.rows += g.rows.length;
    report.imported.hours = round2(report.imported.hours + hours);
    report.imported.timeEntries++;
    if (billedOutside) report.imported.billedOutside++;
    const t = byTask.get(g.label) ?? { rows: 0, hours: 0 };
    t.rows += g.rows.length;
    t.hours = round2(t.hours + hours);
    byTask.set(g.label, t);
  }

  report.skipped = [...skips].map(([reason, s]) => ({ reason, ...s }));
  report.byTask = [...byTask].map(([task, t]) => ({ task, ...t })).sort((a, b) => b.hours - a.hours);
  return report;
}
