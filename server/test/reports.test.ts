// Report numbers are checked against a small, fixed set of data worked out by hand.
//
//   Brad (employee)    501 Build   ACME   T&M       $150/h, cost $0,   budget 40   10/26: 8   11/02: 8  11/03: 8
//                      503 Admin   INT    internal  $0/h                           11/02: 1
//   Carl (contractor)  502 Assess  ACMEFF Flat Fee  $200/h, cost $100, budget 10   11/02-11/04: 4 each
//                      601 Support BETA   T&M       $100/h, cost $60               11/02: 2
//
//   Invoice A (Acme): time through 11/02 = 16h x 150 = 2400, issued 10/01, due 10/31, sent, paid 1000 on 11/05
//   Invoice B (Beta): 2h x 100 = 200, issued 11/07, due 12/07, sent
//   Ledger: Software 300 (11/03), Contractors (1099) Carl 500 (11/06), Interest income 12.50 (11/04), Travel 99 (2025-12-31)
//   Trips: 3/10 business 100mi Acme (Acura); 11/04 business 50mi Beta; 11/05 charitable 10mi; 2025-06-01 business 20mi
//   Rates: business 0.725 from 2026-01-01, 0.70 from 2026-07-01; charitable 0.14 from 2026-01-01

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const hours = (...h: number[]) => [...h, 0, 0, 0, 0, 0, 0, 0].slice(0, 7);
const NOV = 'from=2026-11-01&to=2026-11-30';
let brad: any, carl: any, acme: any, beta: any, invA: any, invB: any;

beforeEach(async () => {
  acme = await create('/accounts', { name: 'Acme', type: 'Client' });
  beta = await create('/accounts', { name: 'Beta', type: 'Client' });
  brad = await create('/resources', { name: 'Brad' });
  carl = await create('/resources', { name: 'Carl', contractor: true });
  const pAcme = await create('/projects', { code: 'ACME', name: 'Acme Build', accountId: acme.id });
  const pFlat = await create('/projects', { code: 'ACMEFF', name: 'Acme Assessment', accountId: acme.id, type: 'Flat Fee' });
  const pBeta = await create('/projects', { code: 'BETA', name: 'Beta Work', accountId: beta.id });
  const pInt = await create('/projects', { code: 'INT', name: 'Internal' });
  const build = await create('/tasks', { taskNumber: 501, projectId: pAcme.id, resourceId: brad.id, name: 'Build', billRate: 150, budgetHours: 40 });
  const admin = await create('/tasks', { taskNumber: 503, projectId: pInt.id, resourceId: brad.id, name: 'Admin' });
  const assess = await create('/tasks', { taskNumber: 502, projectId: pFlat.id, resourceId: carl.id, name: 'Assess', type: 'Flat Fee', billRate: 200, costRate: 100, budgetHours: 10 });
  const support = await create('/tasks', { taskNumber: 601, projectId: pBeta.id, resourceId: carl.id, name: 'Support', billRate: 100, costRate: 60 });

  const sheet = (r: any, week: string, lines: object[]) => api('PUT', `/resources/${r.id}/timesheets/${week}`, { lines });
  await sheet(brad, '2026-10-26', [{ taskId: build.id, hours: hours(8) }]);
  await sheet(brad, '2026-11-02', [{ taskId: build.id, hours: hours(8, 8) }, { taskId: admin.id, hours: hours(1) }]);
  await sheet(carl, '2026-11-02', [{ taskId: assess.id, hours: hours(4, 4, 4) }, { taskId: support.id, hours: hours(2) }]);

  invA = await create('/invoices', { accountId: acme.id, to: '2026-11-02', issueDate: '2026-10-01' });
  invB = await create('/invoices', { accountId: beta.id, issueDate: '2026-11-07' });
  await api('POST', `/invoices/${invA.id}/send`);
  await api('POST', `/invoices/${invB.id}/send`);
  await api('POST', `/invoices/${invA.id}/payments`, { paymentDate: '2026-11-05', amount: 1000 });

  await create('/ledger', { entryDate: '2026-11-03', type: 'expense', category: 'Software & subscriptions', amount: 300 });
  await create('/ledger', { entryDate: '2026-11-06', type: 'expense', category: 'Contractors (1099)', amount: 500, resourceId: carl.id });
  await create('/ledger', { entryDate: '2026-11-04', type: 'income', category: 'Interest', amount: 12.5 });
  await create('/ledger', { entryDate: '2025-12-31', type: 'expense', category: 'Travel', amount: 99 });

  await api('PUT', '/mileage-rates/business/2026-01-01', { ratePerMile: 0.725 });
  await api('PUT', '/mileage-rates/business/2026-07-01', { ratePerMile: 0.7 });
  await api('PUT', '/mileage-rates/charitable/2026-01-01', { ratePerMile: 0.14 });
  const acura = await create('/vehicles', { name: 'Acura' });
  await create('/trips', { tripDate: '2026-03-10', kind: 'business', miles: 100, accountId: acme.id, vehicleId: acura.id });
  await create('/trips', { tripDate: '2026-11-04', kind: 'business', miles: 50, accountId: beta.id });
  await create('/trips', { tripDate: '2026-11-05', kind: 'charitable', miles: 10 });
  await create('/trips', { tripDate: '2025-06-01', kind: 'business', miles: 20 });
});

test('fixture invoices came out as planned', () => {
  assert.equal(invA.totals.total, 2400);
  assert.equal(invB.totals.total, 200);
});

describe('budgets', () => {
  test('budget vs actual, value, cost and margin per task and project', async () => {
    const { data } = (await api('GET', '/reports/budgets')).body;
    assert.deepEqual(data.map((p: any) => [p.code, p.internal]),
      [['ACMEFF', false], ['ACME', false], ['BETA', false], ['INT', true]], 'billable projects first, then by name');

    const [flat, build, beta, internal] = data;
    assert.deepEqual(flat.tasks[0], {
      taskId: flat.tasks[0].taskId, taskNumber: 502, name: 'Assess', type: 'Flat Fee', active: true, resourceName: 'Carl',
      billRate: 200, costRate: 100, billable: true, budgetHours: 10, actualHours: 12, remainingHours: -2, burn: 1.2,
      value: 2000, cost: 1200, margin: 800,
    }, 'Flat Fee value is the fixed budget; overruns lower the margin');
    assert.deepEqual(build.totals, { budgetHours: 40, actualHours: 24, remainingHours: 16, burn: 0.6, value: 3600, cost: 0, margin: 3600 });
    assert.equal(build.accountName, 'Acme');
    assert.deepEqual(beta.totals, { budgetHours: 0, actualHours: 2, remainingHours: null, burn: null, value: 200, cost: 120, margin: 80 });
    assert.deepEqual(internal.totals, { budgetHours: 0, actualHours: 1, remainingHours: null, burn: null, value: null, cost: null, margin: null });
    assert.equal(internal.tasks[0].value, null);
  });
});

describe('time', () => {
  test('groups a period by client', async () => {
    const { data } = (await api('GET', '/reports/time?from=2026-11-02&to=2026-11-08')).body;
    assert.deepEqual(data.totals, { hours: 31, billableHours: 30, utilization: 0.9677, value: 5000, cost: 1320, margin: 3680, marginPct: 0.736 });
    assert.deepEqual(data.groups.map((g: any) => [g.name, g.hours, g.billableHours, g.value, g.cost, g.margin, g.marginPct]), [
      ['Acme', 28, 28, 4800, 1200, 3600, 0.75],
      ['Beta', 2, 2, 200, 120, 80, 0.4],
      ['—', 1, 0, 0, 0, 0, null],
    ]);
  });

  test('other groupings and all time', async () => {
    const byRes = (await api('GET', '/reports/time?groupBy=resource&from=2026-11-02&to=2026-11-08')).body.data;
    assert.deepEqual(byRes.groups.map((g: any) => [g.name, g.hours]), [['Brad', 17], ['Carl', 14]]);
    const byTask = (await api('GET', '/reports/time?groupBy=task')).body.data;
    assert.deepEqual(byTask.groups.map((g: any) => [g.name, g.hours]),
      [['Build · Acme', 24], ['Assess · Acme', 12], ['Support · Beta', 2], ['Admin · —', 1]]);
    const byProject = (await api('GET', '/reports/time?groupBy=project')).body.data;
    assert.equal(byProject.totals.hours, 39);
    assert.equal((await api('GET', '/reports/time?groupBy=vehicle')).status, 400);
    assert.equal((await api('GET', '/reports/time?from=2026-12-01&to=2026-11-01')).status, 400);
  });

  test('entries list the day-lines, newest first', async () => {
    const res = (await api('GET', '/reports/time/entries?from=2026-11-02&to=2026-11-08')).body;
    assert.equal(res.total, 7);
    const first = res.data[0];
    assert.equal(first.workDate, '2026-11-04');
    assert.equal(first.resourceName, 'Carl');
    assert.equal(first.projectCode, 'ACMEFF');
    assert.equal(first.value, 800);
    assert.equal(first.cost, 400);
    const billedBuild = res.data.find((e: any) => e.taskNumber === 501 && e.workDate === '2026-11-02');
    assert.equal(billedBuild.billed, true);
    const unbilledBuild = res.data.find((e: any) => e.taskNumber === 501 && e.workDate === '2026-11-03');
    assert.equal(unbilledBuild.billed, false);
    assert.equal((await api('GET', '/reports/time/entries?limit=2')).body.data.length, 2);
  });
});

describe('profit and loss', () => {
  test('cash basis: payments received and ledger entries', async () => {
    const { data } = (await api('GET', `/reports/pnl?${NOV}`)).body;
    assert.equal(data.basis, 'cash');
    assert.deepEqual(data.income, [{ category: 'Consulting revenue · Acme', amount: 1000 }, { category: 'Interest', amount: 12.5 }]);
    assert.deepEqual(data.expenses, [{ category: 'Contractors (1099)', amount: 500 }, { category: 'Software & subscriptions', amount: 300 }]);
    assert.equal(data.totalIncome, 1012.5);
    assert.equal(data.totalExpenses, 800);
    assert.equal(data.net, 212.5);
    assert.equal(data.mileageDeduction, 36.4, '50mi x 0.70 + 10mi x 0.14');
  });

  test('accrual basis: invoices sent, contractor cost from hours', async () => {
    const { data } = (await api('GET', `/reports/pnl?${NOV}&basis=accrual`)).body;
    assert.deepEqual(data.income, [{ category: 'Consulting revenue · Beta', amount: 200 }, { category: 'Interest', amount: 12.5 }]);
    assert.deepEqual(data.expenses, [{ category: 'Contractors (1099)', amount: 1320 }, { category: 'Software & subscriptions', amount: 300 }]);
    assert.equal(data.net, -1407.5);
  });

  test('voided and draft invoices are not revenue', async () => {
    const draft = await create('/invoices', { accountId: beta.id, blank: true, issueDate: '2026-11-10' });
    await api('PATCH', `/invoices/${draft.id}`, { lines: [{ kind: 'manual', description: 'x', quantity: 1, rate: 999 }] });
    await api('POST', `/invoices/${invB.id}/void`);
    const { data } = (await api('GET', `/reports/pnl?${NOV}&basis=accrual`)).body;
    assert.deepEqual(data.income, [{ category: 'Interest', amount: 12.5 }]);
  });

  test('monthly totals for a year', async () => {
    const { data } = (await api('GET', '/reports/pnl/monthly?year=2026&basis=accrual')).body;
    assert.equal(data.months.length, 12);
    assert.deepEqual(data.months[9], { month: 10, from: '2026-10-01', to: '2026-10-31', income: 2400, expenses: 0, net: 2400 });
    assert.equal(data.months[10].net, -1407.5);
    assert.equal(data.months[1].to, '2026-02-28');
    const cash2025 = (await api('GET', '/reports/pnl/monthly?year=2025')).body.data;
    assert.equal(cash2025.months[11].expenses, 99);
    assert.equal((await api('GET', '/reports/pnl?basis=tax')).status, 400);
  });
});

describe('receivables', () => {
  test('open balances by days past due', async () => {
    const { data } = (await api('GET', '/reports/receivables?asOf=2026-11-08')).body;
    assert.deepEqual(data.totals, { current: 200, days1to30: 1400, days31to60: 0, days61to90: 0, over90: 0, total: 1600 });
    assert.deepEqual(data.clients.map((c: any) => [c.accountName, c.total]), [['Acme', 1400], ['Beta', 200]]);
    assert.deepEqual(data.invoices.map((i: any) => [i.number, i.daysLate, i.bucket, i.balance]),
      [[invA.number, 8, 'days1to30', 1400], [invB.number, -29, 'current', 200]]);
    assert.equal(data.buckets.length, 5);

    const later = (await api('GET', '/reports/receivables?asOf=2027-02-15')).body.data;
    assert.equal(later.totals.over90, 1400);
    assert.equal(later.totals.days61to90, 200);
  });

  test('paid invoices drop off', async () => {
    await api('POST', `/invoices/${invA.id}/payments`, { amount: 1400 });
    const { data } = (await api('GET', '/reports/receivables?asOf=2026-11-08')).body;
    assert.equal(data.totals.total, 200);
  });
});

describe('contractors', () => {
  test('hours, cost, paid, owed and 1099 status', async () => {
    const { data } = (await api('GET', '/reports/contractors?year=2026')).body;
    assert.equal(data.threshold, 2000);
    assert.deepEqual(data.contractors.map((c: any) => [c.name, c.hours, c.cost, c.paid, c.owed, c.needs1099]),
      [['Carl', 14, 1320, 500, 820, false]], 'only contractors are listed');
    assert.equal(data.totalOwed, 820);

    await create('/ledger', { entryDate: '2026-11-07', type: 'expense', category: 'Contractors (1099)', amount: 1500, resourceId: carl.id });
    const after = (await api('GET', '/reports/contractors?year=2026')).body.data.contractors[0];
    assert.equal(after.paid, 2000);
    assert.equal(after.needs1099, true, 'paid $2,000 or more');
    assert.equal(after.owed, 0, 'never negative');

    const other = (await api('GET', '/reports/contractors?year=2025')).body.data.contractors[0];
    assert.deepEqual([other.hours, other.paid, other.owed], [0, 0, 0]);
  });
});

describe('invoicing summary', () => {
  test('outstanding, overdue, unbilled, invoiced and collected', async () => {
    const { data } = (await api('GET', '/reports/invoicing?year=2026')).body;
    assert.deepEqual(data.outstanding, { amount: 1600, count: 2 });
    // Invoice A was due 2026-10-31; invoice B is due 2026-12-07.
    const today = new Date().toISOString().slice(0, 10);
    const expectOverdue = today > '2026-12-07' ? { amount: 1600, count: 2 } : today > '2026-10-31' ? { amount: 1400, count: 1 } : { amount: 0, count: 0 };
    assert.deepEqual(data.overdue, expectOverdue);
    assert.deepEqual(data.unbilled, { amount: 1200, hours: 8 }, 'Brad 11/03; Flat Fee time is left out');
    assert.equal(data.invoiced, 2600);
    assert.equal(data.collected, 1000);
  });
});

describe('mileage', () => {
  test('miles and deduction by month, client, vehicle and kind', async () => {
    const { data } = (await api('GET', '/reports/mileage?from=2026-01-01&to=2026-12-31')).body;
    assert.deepEqual(data.totals, { trips: 3, miles: 160, value: 108.9 });
    assert.deepEqual(data.byMonth.map((m: any) => [m.name, m.miles, m.value]), [['2026-03', 100, 72.5], ['2026-11', 60, 36.4]]);
    assert.deepEqual(data.byClient.map((c: any) => [c.name, c.miles]), [['Acme', 100], ['Beta', 50], ['—', 10]]);
    assert.deepEqual(data.byVehicle.map((v: any) => [v.name, v.miles]), [['Acura', 100], ['—', 60]]);
    assert.deepEqual(data.byKind.map((k: any) => [k.name, k.miles, k.value]), [['business', 150, 107.5], ['charitable', 10, 1.4]]);

    const old = (await api('GET', '/reports/mileage?from=2025-01-01&to=2025-12-31')).body.data;
    assert.deepEqual(old.totals, { trips: 1, miles: 20, value: 0 }, 'no rate set yet, so no deduction');
    const empty = (await api('GET', '/reports/mileage?from=2030-01-01&to=2030-12-31')).body.data;
    assert.deepEqual(empty.totals, { trips: 0, miles: 0, value: 0 });
  });
});
