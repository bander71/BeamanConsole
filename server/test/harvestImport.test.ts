// Harvest import: mapping, new projects and tasks, "Beaman Console wins", billed outside, re-runs.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { pool } from '../src/db.ts';
import { importHarvest, type HarvestRow } from '../src/harvestImport.ts';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const row = (o: Partial<HarvestRow>): HarvestRow => ({ date: '2026-03-02', client: '', project: '', task: '', notes: '', hours: 1, invoiced: false, billableRate: 0, ...o });
let brad: any, erp: any, mce: any;

beforeEach(async () => {
  mce = await create('/accounts', { name: "McElroy's", type: 'Client' });
  await create('/accounts', { name: 'Core Catalysts' });
  brad = await create('/resources', { name: 'Brad Anderson' });
  await create('/resources', { name: 'Richard Bennion', contractor: true });
  const p = await create('/projects', { code: 'MCERP', name: 'MCE ERP', accountId: mce.id });
  erp = await create('/tasks', { taskNumber: 501, projectId: p.id, resourceId: brad.id, name: 'MCE ERP', billRate: 195 });
  // Time entered in the app on Tuesday 3/3.
  await api('PUT', `/resources/${brad.id}/timesheets/2026-03-02`, { lines: [{ taskId: erp.id, hours: [0, 4, 0, 0, 0, 0, 0] }] });
});

const rows = [
  row({ project: 'ERP Implementation', task: 'McElroys ERP Implementation', date: '2026-03-02', hours: 5, invoiced: true, billableRate: 195 }),
  row({ project: 'ERP Implementation', task: 'McElroys ERP Implementation', date: '2026-03-02', hours: 1.5, invoiced: true, notes: 'Go-live prep' }),
  row({ project: 'ERP Implementation', task: 'McElroys ERP Implementation', date: '2026-03-03', hours: 6 }), // the app has 3/3: skipped
  row({ project: 'ERP Implementation', task: 'McElroys ERP Implementation', date: '2026-03-04', hours: 2 }), // not invoiced: billable later
  row({ project: 'Core Catalysts Projects', task: 'CC IT Tasks', date: '2025-12-01', hours: 1.5, billableRate: 75, invoiced: true }),
  row({ project: 'zBeaman', task: 'Hodgdon Powder', date: '2022-05-02', hours: 8 }),
  row({ project: 'Unknown', task: 'Mystery', date: '2026-03-05', hours: 1 }),
];

async function run(apply: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await importHarvest(client, rows, apply);
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return r;
  } finally { client.release(); }
}

test('imports, skips days the app has, and creates projects and tasks', async () => {
  const preview = await run(false);
  assert.equal((await api('GET', '/projects?code=CC')).body.total, 0, 'the dry run saved nothing');
  const r = await run(true);
  assert.deepEqual({ ...preview, applied: true }, r);
  assert.deepEqual(r.imported, { rows: 5, hours: 18, timeEntries: 4, billedOutside: 2 });
  assert.deepEqual(Object.fromEntries(r.skipped.map((s) => [s.reason, s.rows])), {
    'Beaman Console already has time that day': 1, 'no mapping for Unknown › Mystery': 1 });
  assert.deepEqual(r.created.projects, ['CC – Core Catalysts Projects', 'ZBEAMAN – zBeaman (Core Catalysts)']);
  assert.equal(r.created.timesheets, 2, 'the 3/2 week already had a sheet; 2025-12-01 and 2022-05-02 get new ones');

  const sheet = (await api('GET', `/resources/${brad.id}/timesheets/2026-03-02`)).body.data;
  const line = sheet.lines.find((l: any) => l.taskNumber === 501);
  assert.deepEqual(line.hours.slice(0, 3), [6.5, 4, 2], 'two Harvest entries added together; the app kept 3/3');
  assert.deepEqual(line.billed.slice(0, 3), [true, false, false], 'invoiced in Harvest = billed');
  assert.match(line.note, /3\/2: Go-live prep/);
  assert.equal(sheet.status, 'draft', 'an existing sheet keeps its status');

  const cc = (await api('GET', '/projects?code=CC')).body.data[0];
  const ccTask = (await api('GET', `/tasks?projectId=${cc.id}`)).body.data[0];
  assert.deepEqual([ccTask.name, ccTask.billRate, ccTask.active], ['CC IT Tasks', 75, false], 'old task created inactive');
  const old = (await api('GET', `/timesheets?resourceId=${brad.id}&from=2022-01-01&to=2022-12-31`)).body.data[0];
  assert.equal(old.status, 'approved');
});

test('billed-outside hours stay out of Invoices, count in reports, and are locked', async () => {
  await run(true);
  const unbilled = (await api('GET', '/invoices/unbilled')).body.data;
  const mceUnbilled = unbilled.find((a: any) => a.accountId === mce.id);
  assert.equal(mceUnbilled.hours, 6, 'the app 4 h and Harvest 2 h not invoiced; the 6.5 h billed in Harvest are left out');
  const report = (await api('GET', '/reports/time?from=2026-03-01&to=2026-03-31')).body.data;
  assert.equal(report.totals.hours, 12.5, 'billed hours still count');
  const put = await api('PUT', `/resources/${brad.id}/timesheets/2026-03-02`, { lines: [{ taskId: erp.id, hours: [1, 4, 2, 0, 0, 0, 0] }] });
  assert.equal(put.status, 409, 'billed-outside hours can not be changed');
});

test('running it again imports nothing new', async () => {
  await run(true);
  const again = await run(true);
  assert.deepEqual([again.imported.rows, again.created.timesheets, again.created.tasks.length], [0, 0, 0]);
  assert.equal(again.skipped.find((s) => s.reason === 'already imported')?.rows, 5, 'counted in Harvest rows');
});
