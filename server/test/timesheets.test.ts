import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { pool } from '../src/db.ts';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const WEEK = '2026-11-02'; // a Monday
const PREV_WEEK = '2026-10-26';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let dev: any, other: any, rep: any, project: any, build: any, meet: any, internal: any, othersTask: any;
const url = (week = WEEK, resource = dev.id) => `/resources/${resource}/timesheets/${week}`;

beforeEach(async () => {
  rep = await create('/employees', { firstName: 'Ann', lastName: 'Approver' });
  dev = await create('/resources', { name: 'Dev One' });
  other = await create('/resources', { name: 'Dev Two' });
  const acct = await create('/accounts', { name: 'Acme', type: 'Client' });
  project = await create('/projects', { code: 'ACME', name: 'Acme Build', accountId: acct.id });
  build = await create('/tasks', { taskNumber: 501, projectId: project.id, resourceId: dev.id, name: 'Build', billRate: 150, costRate: 90 });
  meet = await create('/tasks', { taskNumber: 502, projectId: project.id, resourceId: dev.id, name: 'Meetings', billRate: 100 });
  internal = await create('/tasks', { taskNumber: 503, projectId: project.id, resourceId: dev.id, name: 'Admin', billRate: 0 });
  othersTask = await create('/tasks', { taskNumber: 601, projectId: project.id, resourceId: other.id, name: 'Build', billRate: 150 });
});

const save = (lines: unknown[], week = WEEK) => api('PUT', url(week), { lines });
const hours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);

/** Puts one day's time entry on an invoice, the way invoicing will. */
async function invoiceEntry(sheetId: string, date: string) {
  const { rows: [entry] } = await pool.query(
    `SELECT te.id, te.hours FROM time_entries te JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
     WHERE tl.timesheet_id = $1 AND te.work_date = $2 LIMIT 1`, [sheetId, date],
  );
  const { rows: [acct] } = await pool.query('SELECT account_id FROM projects WHERE id = $1', [project.id]);
  const { rows: [inv] } = await pool.query(
    `INSERT INTO invoices (number, account_id) VALUES ('T-' || gen_random_uuid(), $1) RETURNING id`, [acct.account_id],
  );
  const { rows: [line] } = await pool.query(
    `INSERT INTO invoice_lines (invoice_id, line_no, kind) VALUES ($1, 1, 'time') RETURNING id`, [inv.id],
  );
  await pool.query('INSERT INTO invoice_line_time_entries VALUES ($1, $2, $3)', [line.id, entry.id, entry.hours]);
}

describe('weekly grid', () => {
  test('an unsaved week comes back as an empty draft', async () => {
    const res = await api('GET', url());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, null);
    assert.equal(res.body.data.status, 'draft');
    assert.equal(res.body.data.resourceName, 'Dev One');
    assert.deepEqual(res.body.data.lines, []);
  });

  test('save and reload the grid with totals', async () => {
    const res = await save([
      { taskId: build.id, hours: hours(6.5, 6.5, 6.5, 6.5, 2), note: 'Sprint 4' },
      { taskId: internal.id, hours: hours(1, 0, 0, 0, 1.25) },
    ]);
    assert.equal(res.status, 200);
    const sheet = res.body.data;
    assert.ok(sheet.id);
    assert.equal(sheet.lines.length, 2);
    assert.deepEqual(sheet.lines[0].hours, [6.5, 6.5, 6.5, 6.5, 2, 0, 0]);
    assert.equal(sheet.lines[0].note, 'Sprint 4');
    assert.equal(sheet.lines[0].taskNumber, 501);
    assert.equal(sheet.lines[0].projectCode, 'ACME');
    assert.equal(sheet.lines[0].accountName, 'Acme');
    assert.deepEqual(sheet.totals, {
      hours: 30.25, billableHours: 28, billValue: 4200, cost: 2520, days: [7.5, 6.5, 6.5, 6.5, 3.25, 0, 0],
    });

    const reload = await api('GET', url());
    assert.equal(reload.body.data.id, sheet.id);
    assert.deepEqual(reload.body.data.totals, sheet.totals);
    assert.deepEqual((await api('GET', `/timesheets/${sheet.id}`)).body.data.lines, sheet.lines);

    const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM time_entries');
    assert.equal(n, 7, 'only non-zero days are stored');
  });

  test('saving again changes, removes and reorders lines', async () => {
    await save([{ taskId: build.id, hours: hours(8, 8) }, { taskId: meet.id, hours: hours(1) }]);
    const res = await save([{ taskId: internal.id, hours: hours(2) }, { taskId: build.id, hours: hours(8, 0, 4) }]);
    assert.deepEqual(res.body.data.lines.map((l: any) => l.taskNumber), [503, 501]);
    assert.deepEqual(res.body.data.lines[1].hours, [8, 0, 4, 0, 0, 0, 0]);
    assert.equal(res.body.data.totals.hours, 14);
  });

  test('rejects bad grids', async () => {
    assert.equal((await save([{ taskId: build.id, hours: [1, 2, 3] }])).status, 400, 'needs 7 days');
    assert.equal((await save([{ taskId: build.id, hours: hours(25) }])).status, 400, 'over 24 on a line');
    assert.equal((await save([{ taskId: build.id, hours: hours(-1) }])).status, 400, 'negative');
    const dayTotal = await save([{ taskId: build.id, hours: hours(16) }, { taskId: meet.id, hours: hours(9) }]);
    assert.equal(dayTotal.status, 400, 'day adds up over 24');
    assert.match(dayTotal.body.error.message, /2026-11-02/);
    assert.equal((await save([{ taskId: build.id, hours: hours(1) }, { taskId: build.id, hours: hours(1) }])).status, 400, 'duplicate task');
    assert.equal((await save([{ taskId: othersTask.id, hours: hours(1) }])).status, 400, "someone else's task");
    assert.equal((await save([{ taskId: MISSING_ID, hours: hours(1) }])).status, 400, 'missing task');
    assert.equal((await api('PUT', url('2026-11-04'), { lines: [] })).status, 400, 'week must start Monday');
    assert.equal((await api('PUT', url(WEEK, MISSING_ID), { lines: [] })).status, 404, 'missing resource');
    assert.equal((await api('GET', url(WEEK, 'nope'))).status, 404, 'bad resource id');
  });

  test('inactive tasks can stay on a sheet but not be added', async () => {
    await save([{ taskId: build.id, hours: hours(4) }]);
    await api('PATCH', `/tasks/${build.id}`, { active: false });
    await api('PATCH', `/tasks/${meet.id}`, { active: false });
    assert.equal((await save([{ taskId: build.id, hours: hours(5) }])).status, 200, 'existing line keeps working');
    assert.equal((await save([{ taskId: build.id, hours: hours(5) }, { taskId: meet.id, hours: hours(1) }])).status, 400);
  });
});

describe('status flow', () => {
  async function savedSheet() {
    return (await save([{ taskId: build.id, hours: hours(8) }])).body.data;
  }
  const act = (id: string, action: string, body?: unknown) => api('POST', `/timesheets/${id}/${action}`, body);

  test('submit, approve, reopen', async () => {
    const sheet = await savedSheet();
    const submitted = await act(sheet.id, 'submit');
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.status, 'submitted');
    assert.ok(submitted.body.data.submittedAt);

    assert.equal((await save([{ taskId: build.id, hours: hours(9) }])).status, 409, 'locked while submitted');

    const approved = await act(sheet.id, 'approve', { approvedBy: rep.id });
    assert.equal(approved.body.data.status, 'approved');
    assert.equal(approved.body.data.approvedBy, rep.id);
    assert.ok(approved.body.data.approvedAt);
    assert.equal((await save([{ taskId: build.id, hours: hours(9) }])).status, 409, 'locked while approved');

    const reopened = await act(sheet.id, 'reopen');
    assert.equal(reopened.body.data.status, 'draft');
    assert.equal(reopened.body.data.approvedAt, null);
    assert.equal((await save([{ taskId: build.id, hours: hours(9) }])).status, 200);
  });

  test('return with a note, edit, resubmit', async () => {
    const sheet = await savedSheet();
    await act(sheet.id, 'submit');
    const returned = await act(sheet.id, 'return', { note: 'Split out the meeting hours' });
    assert.equal(returned.body.data.status, 'returned');
    assert.equal(returned.body.data.returnNote, 'Split out the meeting hours');

    const edited = await save([{ taskId: build.id, hours: hours(7) }, { taskId: meet.id, hours: hours(1) }]);
    assert.equal(edited.status, 200, 'returned sheets can be edited');
    assert.equal(edited.body.data.status, 'returned', 'saving keeps the status');
    assert.equal((await act(sheet.id, 'submit')).body.data.status, 'submitted');
  });

  test('recall a submitted sheet', async () => {
    const sheet = await savedSheet();
    await act(sheet.id, 'submit');
    const recalled = await act(sheet.id, 'recall');
    assert.equal(recalled.body.data.status, 'draft');
    assert.equal(recalled.body.data.submittedAt, null);
  });

  test('rejects moves that the flow does not allow', async () => {
    const sheet = await savedSheet();
    assert.equal((await act(sheet.id, 'approve')).status, 409, 'approve a draft');
    assert.equal((await act(sheet.id, 'return')).status, 409, 'return a draft');
    assert.equal((await act(sheet.id, 'reopen')).status, 409, 'reopen a draft');
    assert.equal((await act(sheet.id, 'recall')).status, 409, 'recall a draft');
    await act(sheet.id, 'submit');
    assert.equal((await act(sheet.id, 'submit')).status, 409, 'submit twice');
    assert.equal((await act(sheet.id, 'approve', { approvedBy: MISSING_ID })).status, 400, 'unknown approver');
    assert.equal((await act(sheet.id, 'approve', { extra: 1 })).status, 400, 'unknown field');
    assert.equal((await act(sheet.id, 'explode')).status, 404, 'unknown action');
    assert.equal((await act(MISSING_ID, 'submit')).status, 404, 'missing sheet');
  });

  test("can't submit a sheet with no hours", async () => {
    const empty = (await save([{ taskId: build.id, hours: hours() }])).body.data;
    const res = await act(empty.id, 'submit');
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /hours/);
  });
});

describe('approvals list', () => {
  test('lists sheets with totals and filters by status', async () => {
    const mine = (await save([{ taskId: build.id, hours: hours(8, 8) }, { taskId: internal.id, hours: hours(1) }])).body.data;
    await api('PUT', url(WEEK, other.id), { lines: [{ taskId: othersTask.id, hours: hours(4) }] });
    await save([{ taskId: build.id, hours: hours(2) }], PREV_WEEK);
    await api('POST', `/timesheets/${mine.id}/submit`);

    const all = await api('GET', '/timesheets');
    assert.equal(all.body.total, 3);
    assert.deepEqual(all.body.data.map((s: any) => [s.weekStart, s.resourceName]),
      [[WEEK, 'Dev One'], [WEEK, 'Dev Two'], [PREV_WEEK, 'Dev One']]);

    const queue = await api('GET', '/timesheets?status=submitted');
    assert.equal(queue.body.total, 1);
    assert.equal(queue.body.data[0].totalHours, 17);
    assert.equal(queue.body.data[0].billableHours, 16);
    assert.equal(queue.body.data[0].billValue, 2400);

    assert.equal((await api('GET', `/timesheets?resourceId=${dev.id}&from=${WEEK}`)).body.total, 1);
    assert.equal((await api('GET', '/timesheets?status=pending')).status, 400);
  });
});

describe('copy previous week', () => {
  test('adds last week\'s lines with zero hours', async () => {
    await save([{ taskId: build.id, hours: hours(8) }, { taskId: meet.id, hours: hours(1) }, { taskId: internal.id, hours: hours(1) }], PREV_WEEK);
    await api('PATCH', `/tasks/${internal.id}`, { active: false });
    await save([{ taskId: meet.id, hours: hours(3) }]);

    const res = await api('POST', `${url()}/copy-previous`);
    assert.equal(res.status, 200);
    assert.equal(res.body.added, 1, 'skips the line already here and the inactive task');
    assert.equal(res.body.copiedFrom, PREV_WEEK);
    assert.deepEqual(res.body.data.lines.map((l: any) => [l.taskNumber, l.hours[0]]), [[502, 3], [501, 0]]);
  });

  test('needs an earlier sheet and an editable week', async () => {
    assert.equal((await api('POST', `${url()}/copy-previous`)).status, 404);
    await save([{ taskId: build.id, hours: hours(8) }], PREV_WEEK);
    const sheet = (await save([{ taskId: meet.id, hours: hours(1) }])).body.data;
    await api('POST', `/timesheets/${sheet.id}/submit`);
    assert.equal((await api('POST', `${url()}/copy-previous`)).status, 409);
  });
});

describe('invoiced hours', () => {
  test("can't be changed or removed", async () => {
    const sheet = (await save([{ taskId: build.id, hours: hours(8, 6) }, { taskId: meet.id, hours: hours(1) }])).body.data;
    await invoiceEntry(sheet.id, WEEK);

    const reload = (await api('GET', url())).body.data;
    assert.deepEqual(reload.lines[0].billed, [true, false, false, false, false, false, false]);

    assert.equal((await save([{ taskId: build.id, hours: hours(7, 6) }, { taskId: meet.id, hours: hours(1) }])).status, 409, 'change billed hours');
    assert.equal((await save([{ taskId: build.id, hours: hours(0, 6) }, { taskId: meet.id, hours: hours(1) }])).status, 409, 'zero billed hours');
    assert.equal((await save([{ taskId: meet.id, hours: hours(1) }])).status, 409, 'remove a billed line');
    const ok = await save([{ taskId: build.id, hours: hours(8, 4), note: 'notes are fine' }, { taskId: meet.id, hours: hours(1) }]);
    assert.equal(ok.status, 200, 'other days can still change');
    assert.equal(ok.body.data.totals.hours, 13);

    assert.equal((await api('DELETE', `/timesheets/${sheet.id}`)).status, 409, "can't delete a sheet with billed hours");
  });
});

describe('delete', () => {
  test('deletes a draft but not a submitted sheet', async () => {
    const sheet = (await save([{ taskId: build.id, hours: hours(8) }])).body.data;
    await api('POST', `/timesheets/${sheet.id}/submit`);
    assert.equal((await api('DELETE', `/timesheets/${sheet.id}`)).status, 409);
    await api('POST', `/timesheets/${sheet.id}/recall`);
    assert.equal((await api('DELETE', `/timesheets/${sheet.id}`)).status, 204);
    assert.equal((await api('GET', `/timesheets/${sheet.id}`)).status, 404);
    assert.equal((await api('GET', url())).body.data.id, null);
  });
});
