import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const WEEK1 = '2026-10-26';
const WEEK2 = '2026-11-02';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const hours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);

let acme: any, beta: any, dev: any, build: any, flat: any, admin: any, betaTask: any, week1: any, week2: any;

beforeEach(async () => {
  await api('PUT', '/settings/invoicing', { numberPrefix: 'BC', taxRate: 0.08, termsDays: 30 });
  acme = await create('/accounts', { name: 'Acme', type: 'Client', billingAttn: 'Pat Payable', billingEmail: 'ap@acme.test', address: '1 Main St' });
  beta = await create('/accounts', { name: 'Beta', type: 'Client' });
  dev = await create('/resources', { name: 'Dev One' });
  const acmeProj = await create('/projects', { code: 'ACME', name: 'Acme Build', accountId: acme.id });
  const acmeFlat = await create('/projects', { code: 'ACMEFF', name: 'Acme Assessment', accountId: acme.id, type: 'Flat Fee' });
  const betaProj = await create('/projects', { code: 'BETA', name: 'Beta Work', accountId: beta.id });
  build = await create('/tasks', { taskNumber: 501, projectId: acmeProj.id, resourceId: dev.id, name: 'Build', billRate: 150 });
  flat = await create('/tasks', { taskNumber: 502, projectId: acmeFlat.id, resourceId: dev.id, name: 'Assessment', billRate: 200, type: 'Flat Fee' });
  admin = await create('/tasks', { taskNumber: 503, projectId: acmeProj.id, resourceId: dev.id, name: 'Admin', billRate: 0 });
  betaTask = await create('/tasks', { taskNumber: 601, projectId: betaProj.id, resourceId: dev.id, name: 'Support', billRate: 100 });

  // Week 1 is approved; week 2 is still a draft.
  week1 = (await api('PUT', `/resources/${dev.id}/timesheets/${WEEK1}`, { lines: [
    { taskId: build.id, hours: hours(8, 8) },
    { taskId: flat.id, hours: hours(0, 0, 4) },
    { taskId: admin.id, hours: hours(1) },
    { taskId: betaTask.id, hours: hours(0, 0, 0, 2) },
  ] })).body.data;
  await api('POST', `/timesheets/${week1.id}/submit`);
  await api('POST', `/timesheets/${week1.id}/approve`);
  week2 = (await api('PUT', `/resources/${dev.id}/timesheets/${WEEK2}`, { lines: [
    { taskId: build.id, hours: hours(4) },
  ] })).body.data;
});

const newInvoice = (body: object) => create('/invoices', { accountId: acme.id, issueDate: '2026-11-08', ...body });

describe('unbilled time', () => {
  test('groups ready-to-invoice time by account and task', async () => {
    const res = await api('GET', '/invoices/unbilled');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((a: any) => [a.accountName, a.hours, a.amount, a.unapprovedHours]),
      [['Acme', 20, 3000, 4], ['Beta', 2, 200, 0]], 'skips non-billable and Flat Fee time by default');
    const acmeLines = res.body.data[0].lines;
    assert.deepEqual(acmeLines.map((l: any) => [l.description, l.quantity, l.rate, l.amount]), [['Build — Dev One', 20, 150, 3000]]);
    assert.equal(res.body.data[0].oldestDate, WEEK1);
  });

  test('options: approved only, Flat Fee, date window', async () => {
    const approved = await api('GET', `/invoices/unbilled?accountId=${acme.id}&includeUnapproved=false`);
    assert.equal(approved.body.data[0].hours, 16);
    const withFlat = await api('GET', `/invoices/unbilled?accountId=${acme.id}&includeFlatFee=true`);
    assert.equal(withFlat.body.data[0].hours, 24);
    const window = await api('GET', `/invoices/unbilled?accountId=${acme.id}&from=${WEEK2}`);
    assert.equal(window.body.data[0].hours, 4);
    assert.equal((await api('GET', '/invoices/unbilled?includeFlatFee=maybe')).status, 400);
  });
});

describe('creating drafts', () => {
  test('pulls unbilled time into a numbered draft', async () => {
    const inv = await newInvoice({ from: WEEK1, to: '2026-11-08', cadence: 'biweekly' });
    assert.equal(inv.number, 'BC2026-0001');
    assert.equal(inv.status, 'draft');
    assert.equal(inv.displayStatus, 'draft');
    assert.equal(inv.accountName, 'Acme');
    assert.equal(inv.billToName, 'Acme');
    assert.equal(inv.billToAttn, 'Pat Payable');
    assert.equal(inv.billToEmail, 'ap@acme.test');
    assert.equal(inv.billToAddress, '1 Main St');
    assert.equal(inv.cadence, 'biweekly');
    assert.equal(inv.periodStart, WEEK1, 'first day with time');
    assert.equal(inv.periodEnd, '2026-11-08', 'end of the window');
    assert.equal(inv.termsDays, 30);
    assert.equal(inv.dueDate, '2026-12-08');
    assert.equal(inv.taxRate, 0.08);

    assert.equal(inv.lines.length, 1);
    const line = inv.lines[0];
    assert.equal(line.kind, 'time');
    assert.equal(line.taskNumber, 501);
    assert.equal(line.quantity, 20);
    assert.equal(line.amount, 3000);
    assert.deepEqual(line.entries.map((e: any) => [e.workDate, e.hours]), [[WEEK1, 8], ['2026-10-27', 8], [WEEK2, 4]]);
    assert.deepEqual(inv.totals, { subtotal: 3000, tax: 0, total: 3000, paid: 0, balance: 3000 }, 'time is not taxable');

    const sheet = (await api('GET', `/timesheets/${week1.id}`)).body.data;
    assert.deepEqual(sheet.lines[0].billed.slice(0, 2), [true, true], 'timesheet shows billed hours');

    const next = await newInvoice({});
    assert.equal(next.number, 'BC2026-0002');
    assert.equal(next.lines.length, 0, "hours can't be billed twice");
    const left = (await api('GET', `/invoices/unbilled?accountId=${acme.id}`)).body.data;
    assert.deepEqual(left, []);
  });

  test('two invoices created at once never bill the same hours', async () => {
    const results = await Promise.all([1, 2, 3].map(() => api('POST', '/invoices', { accountId: acme.id })));
    for (const r of results) assert.equal(r.status, 201);
    const billed = results.map((r) => r.body.data.lines.reduce((s: number, l: any) => s + l.quantity, 0));
    assert.deepEqual(billed.sort(), [0, 0, 20]);
    assert.equal(new Set(results.map((r) => r.body.data.number)).size, 3, 'each gets its own number');
  });

  test('options and blank drafts', async () => {
    const approvedOnly = await newInvoice({ includeUnapproved: false, includeFlatFee: true });
    assert.deepEqual(approvedOnly.lines.map((l: any) => [l.taskNumber, l.quantity]), [[501, 16], [502, 4]]);
    const blank = await create('/invoices', { accountId: beta.id, blank: true });
    assert.equal(blank.lines.length, 0);
    assert.equal(blank.billToAttn, 'Accounts Payable', 'default attention line');
    assert.equal((await api('GET', `/invoices/unbilled?accountId=${beta.id}`)).body.data[0].hours, 2, 'blank leaves time unbilled');
  });

  test('numbering respects the starting number and the year', async () => {
    await api('PUT', '/settings/invoicing', { firstNumber: 120 });
    assert.equal((await newInvoice({ blank: true })).number, 'BC2026-0120');
    assert.equal((await newInvoice({ blank: true })).number, 'BC2026-0121');
    assert.equal((await newInvoice({ blank: true, issueDate: '2027-01-04' })).number, 'BC2027-0120');
  });

  test('rejects bad requests', async () => {
    assert.equal((await api('POST', '/invoices', { accountId: MISSING_ID })).status, 400);
    assert.equal((await api('POST', '/invoices', {})).status, 400);
    assert.equal((await api('POST', '/invoices', { accountId: acme.id, from: '2026-11-08', to: '2026-11-01' })).status, 400);
    assert.equal((await api('GET', `/invoices/${MISSING_ID}`)).status, 404);
    assert.equal((await api('GET', '/invoices/nope')).status, 404);
  });
});

describe('editing drafts', () => {
  test('edit header and lines; totals and tax follow', async () => {
    const inv = await newInvoice({});
    const timeLine = inv.lines[0];
    const res = await api('PATCH', `/invoices/${inv.id}`, {
      memo: 'Thanks!',
      termsDays: 15,
      lines: [
        { kind: 'product', description: 'License', quantity: 2, rate: 50 },
        { id: timeLine.id, rate: 160, description: 'Build work' },
        { kind: 'manual', description: 'Milestone: phase 1', quantity: 1, rate: 1000 },
        { kind: 'expense', description: 'Parking', quantity: 1, rate: -25 },
      ],
    });
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.memo, 'Thanks!');
    assert.equal(d.dueDate, '2026-11-23');
    assert.deepEqual(d.lines.map((l: any) => [l.lineNo, l.kind, l.description, l.quantity, l.rate, l.amount, l.taxable]), [
      [1, 'product', 'License', 2, 50, 100, true],
      [2, 'time', 'Build work', 20, 160, 3200, false],
      [3, 'manual', 'Milestone: phase 1', 1, 1000, 1000, false],
      [4, 'expense', 'Parking', 1, -25, -25, false],
    ]);
    assert.equal(d.lines[1].entries.length, 3, 'time line keeps its entries');
    assert.deepEqual(d.totals, { subtotal: 4275, tax: 8, total: 4283, paid: 0, balance: 4283 }, 'tax only on the product line');
  });

  test('removing a time line frees its hours', async () => {
    const inv = await newInvoice({});
    const res = await api('PATCH', `/invoices/${inv.id}`, { lines: [] });
    assert.equal(res.body.data.lines.length, 0);
    assert.equal((await api('GET', `/invoices/unbilled?accountId=${acme.id}`)).body.data[0].hours, 20);
  });

  test('rejects bad line edits', async () => {
    const inv = await newInvoice({});
    const id = inv.lines[0].id;
    const patch = (body: object) => api('PATCH', `/invoices/${inv.id}`, body);
    assert.equal((await patch({ lines: [{ id, quantity: 5 }] })).status, 400, "time line hours can't change");
    assert.equal((await patch({ lines: [{ id, kind: 'manual' }] })).status, 400, "kind can't change");
    assert.equal((await patch({ lines: [{ kind: 'time', description: 'x' }] })).status, 400, "can't add time lines by hand");
    assert.equal((await patch({ lines: [{ description: 'x' }] })).status, 400, 'new lines need a kind');
    assert.equal((await patch({ lines: [{ id }, { id }] })).status, 400, 'duplicate line');
    assert.equal((await patch({ lines: [{ id: MISSING_ID }] })).status, 400, 'line from elsewhere');
    assert.equal((await patch({})).status, 400, 'empty patch');
    assert.equal((await patch({ taxRate: 8 })).status, 400, 'tax rate is a fraction');
    const still = (await api('GET', `/invoices/${inv.id}`)).body.data;
    assert.equal(still.lines[0].amount, 3000, 'failed edits change nothing');
  });

  test('invoice numbers stay unique', async () => {
    const a = await newInvoice({ blank: true });
    const b = await newInvoice({ blank: true });
    assert.equal((await api('PATCH', `/invoices/${b.id}`, { number: a.number })).status, 409);
    assert.equal((await api('PATCH', `/invoices/${b.id}`, { number: 'SPECIAL-1' })).body.data.number, 'SPECIAL-1');
  });
});

describe('sending and payments', () => {
  test('full life: send, partial payment, paid, remove payment', async () => {
    const inv = await newInvoice({});
    const sent = await api('POST', `/invoices/${inv.id}/send`);
    assert.equal(sent.body.data.status, 'sent');
    assert.equal(sent.body.data.displayStatus, 'sent');
    assert.ok(sent.body.data.sentAt);
    assert.equal((await api('PATCH', `/invoices/${inv.id}`, { memo: 'x' })).status, 409, 'sent invoices are locked');

    const part = await api('POST', `/invoices/${inv.id}/payments`, { paymentDate: '2026-11-20', amount: 1000, method: 'Check', reference: '1042' });
    assert.equal(part.status, 201);
    assert.equal(part.body.data.displayStatus, 'partial');
    assert.equal(part.body.data.totals.balance, 2000);
    assert.equal(part.body.data.payments[0].reference, '1042');

    assert.equal((await api('POST', `/invoices/${inv.id}/payments`, { amount: 2000.01 })).status, 400, 'more than the balance');
    const paid = await api('POST', `/invoices/${inv.id}/payments`, { amount: 2000 });
    assert.equal(paid.body.data.displayStatus, 'paid');
    assert.equal(paid.body.data.totals.balance, 0);

    assert.equal((await api('POST', `/invoices/${inv.id}/unsend`)).status, 409, "can't unsend with payments");
    assert.equal((await api('POST', `/invoices/${inv.id}/void`)).status, 409, "can't void with payments");

    const payId = paid.body.data.payments[1].id;
    const removed = await api('DELETE', `/invoices/${inv.id}/payments/${payId}`);
    assert.equal(removed.body.data.displayStatus, 'partial');
    assert.equal((await api('DELETE', `/invoices/${inv.id}/payments/${payId}`)).status, 404);
  });

  test('unsend returns to draft', async () => {
    const inv = await newInvoice({});
    await api('POST', `/invoices/${inv.id}/send`);
    const back = await api('POST', `/invoices/${inv.id}/unsend`);
    assert.equal(back.body.data.status, 'draft');
    assert.equal(back.body.data.sentAt, null);
  });

  test('overdue when past due with a balance', async () => {
    const inv = await newInvoice({ issueDate: '2026-01-05' });
    await api('POST', `/invoices/${inv.id}/send`);
    const got = (await api('GET', `/invoices/${inv.id}`)).body.data;
    assert.equal(got.dueDate, '2026-02-04');
    assert.equal(got.displayStatus, 'overdue');
    assert.equal((await api('GET', '/invoices?status=overdue')).body.total, 1);
    assert.equal((await api('GET', '/invoices?status=sent')).body.total, 0);
  });

  test('rules for sending and payments', async () => {
    const empty = await newInvoice({ blank: true });
    assert.equal((await api('POST', `/invoices/${empty.id}/send`)).status, 409, 'needs a line');
    assert.equal((await api('POST', `/invoices/${empty.id}/payments`, { amount: 10 })).status, 409, 'no payments on drafts');
    assert.equal((await api('POST', `/invoices/${empty.id}/unsend`)).status, 409);
    const inv = await newInvoice({});
    await api('POST', `/invoices/${inv.id}/send`);
    assert.equal((await api('POST', `/invoices/${inv.id}/send`)).status, 409, 'send twice');
    assert.equal((await api('POST', `/invoices/${inv.id}/payments`, { amount: 0 })).status, 400);
    assert.equal((await api('POST', `/invoices/${inv.id}/payments`, { amount: 10, method: 'Bitcoin' })).status, 400);
  });
});

describe('void and delete', () => {
  test('voiding keeps the record and frees the hours', async () => {
    const inv = await newInvoice({});
    await api('POST', `/invoices/${inv.id}/send`);
    const voided = await api('POST', `/invoices/${inv.id}/void`);
    assert.equal(voided.body.data.status, 'void');
    assert.equal(voided.body.data.displayStatus, 'void');
    assert.ok(voided.body.data.voidedAt);
    assert.equal(voided.body.data.lines.length, 1, 'lines stay for the record');
    assert.equal((await api('GET', `/invoices/unbilled?accountId=${acme.id}`)).body.data[0].hours, 20);
    const sheet = (await api('GET', `/timesheets/${week1.id}`)).body.data;
    assert.deepEqual(sheet.lines[0].billed.slice(0, 2), [false, false]);

    assert.equal((await api('POST', `/invoices/${inv.id}/void`)).status, 409, 'already void');
    assert.equal((await api('POST', `/invoices/${inv.id}/payments`, { amount: 1 })).status, 409);
    assert.equal((await api('DELETE', `/invoices/${inv.id}`)).status, 409, "can't delete a voided invoice");

    const rebill = await newInvoice({});
    assert.equal(rebill.lines[0].quantity, 20, 'freed hours can be billed again');
  });

  test('deleting a draft frees the hours; drafts are not voided', async () => {
    const inv = await newInvoice({});
    assert.equal((await api('POST', `/invoices/${inv.id}/void`)).status, 409);
    assert.equal((await api('DELETE', `/invoices/${inv.id}`)).status, 204);
    assert.equal((await api('GET', `/invoices/${inv.id}`)).status, 404);
    assert.equal((await api('GET', `/invoices/unbilled?accountId=${acme.id}`)).body.data[0].hours, 20);
  });

  test('billed hours lock the timesheet until freed', async () => {
    const inv = await newInvoice({});
    const change = () => api('PUT', `/resources/${dev.id}/timesheets/${WEEK2}`, { lines: [{ taskId: build.id, hours: hours(6) }] });
    assert.equal((await change()).status, 409);
    await api('DELETE', `/invoices/${inv.id}`);
    assert.equal((await change()).status, 200);
  });
});

describe('list', () => {
  test('filters by account, status, dates and search', async () => {
    const a = await newInvoice({});
    await create('/invoices', { accountId: beta.id, issueDate: '2026-10-01' });
    await api('POST', `/invoices/${a.id}/send`);

    const all = await api('GET', '/invoices');
    assert.equal(all.body.total, 2);
    assert.deepEqual(all.body.data.map((i: any) => i.accountName), ['Acme', 'Beta'], 'newest first');
    assert.equal(all.body.data[0].total, 3000);
    assert.equal(all.body.data[0].displayStatus, 'sent');

    assert.equal((await api('GET', `/invoices?accountId=${beta.id}`)).body.total, 1);
    assert.equal((await api('GET', '/invoices?status=draft')).body.total, 1);
    assert.equal((await api('GET', '/invoices?from=2026-11-01')).body.total, 1);
    assert.equal((await api('GET', '/invoices?q=beta')).body.total, 1);
    assert.equal((await api('GET', '/invoices?q=0001')).body.total, 1);
    assert.equal((await api('GET', '/invoices?status=late')).status, 400);
  });
});
