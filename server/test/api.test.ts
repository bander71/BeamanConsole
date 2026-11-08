import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { api, create, useTestServer } from './helpers.ts';

useTestServer();

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('health', () => {
  test('reports ok', async () => {
    const res = await api('GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test('unknown endpoints return 404 JSON', async () => {
    const res = await api('GET', '/nope');
    assert.equal(res.status, 404);
    assert.match(res.body.error.message, /No endpoint/);
  });
});

describe('accounts CRUD', () => {
  test('create, read, update, delete', async () => {
    const created = await create('/accounts', { name: '  Acme Corp ', type: 'Client', aliases: ['Acme'], followUp: '2026-12-01' });
    assert.equal(created.name, 'Acme Corp', 'trims text');
    assert.equal(created.type, 'Client');
    assert.deepEqual(created.aliases, ['Acme']);
    assert.equal(created.followUp, '2026-12-01', 'dates come back as YYYY-MM-DD');
    assert.equal(created.notes, '', 'database defaults fill omitted fields');
    assert.ok(created.createdAt);

    const got = await api('GET', `/accounts/${created.id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.data.billingEmail, '', 'camelCase keys');

    const patched = await api('PATCH', `/accounts/${created.id}`, { phone: '555-0100' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.phone, '555-0100');
    assert.equal(patched.body.data.name, 'Acme Corp', 'leaves other fields alone');

    assert.equal((await api('DELETE', `/accounts/${created.id}`)).status, 204);
    assert.equal((await api('GET', `/accounts/${created.id}`)).status, 404);
  });

  test('list supports search, filters and paging', async () => {
    await create('/accounts', { name: 'Acme Corp', type: 'Client' });
    await create('/accounts', { name: 'Beta LLC', type: 'Prospect', aliases: ['Smart Pro'] });
    await create('/accounts', { name: 'Gamma Inc', type: 'Client' });

    const all = await api('GET', '/accounts');
    assert.equal(all.body.total, 3);
    assert.deepEqual(all.body.data.map((a: any) => a.name), ['Acme Corp', 'Beta LLC', 'Gamma Inc']);

    const clients = await api('GET', '/accounts?type=Client');
    assert.equal(clients.body.total, 2);

    const byAlias = await api('GET', '/accounts?q=smart');
    assert.deepEqual(byAlias.body.data.map((a: any) => a.name), ['Beta LLC'], 'searches aliases');

    const page = await api('GET', '/accounts?limit=1&offset=1');
    assert.equal(page.body.total, 3);
    assert.deepEqual(page.body.data.map((a: any) => a.name), ['Beta LLC']);

    const pastEnd = await api('GET', '/accounts?offset=10');
    assert.deepEqual(pastEnd.body.data, []);
    assert.equal(pastEnd.body.total, 3, 'total is right even past the last page');

    const wildcard = await api('GET', '/accounts?q=%25');
    assert.equal(wildcard.body.total, 0, 'treats % in search as a literal character');
  });
});

describe('validation and errors', () => {
  test('rejects missing required fields', async () => {
    const res = await api('POST', '/accounts', {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'name');
  });

  test('rejects unknown fields', async () => {
    const res = await api('POST', '/accounts', { name: 'X', nmae: 'typo' });
    assert.equal(res.status, 400);
  });

  test('rejects values outside a fixed list', async () => {
    const res = await api('POST', '/accounts', { name: 'X', type: 'Customer' });
    assert.equal(res.status, 400);
  });

  test('rejects read-only fields', async () => {
    const res = await api('POST', '/accounts', { name: 'X', id: MISSING_ID });
    assert.equal(res.status, 400);
  });

  test('rejects an empty update', async () => {
    const a = await create('/accounts', { name: 'X' });
    assert.equal((await api('PATCH', `/accounts/${a.id}`, {})).status, 400);
  });

  test('rejects malformed JSON', async () => {
    const res = await api('POST', '/accounts', '{"name":');
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /JSON/);
  });

  test('duplicate account name is a 409, ignoring case', async () => {
    await create('/accounts', { name: 'Acme Corp' });
    const res = await api('POST', '/accounts', { name: 'ACME CORP' });
    assert.equal(res.status, 409);
  });

  test('bad or missing ids are 404', async () => {
    assert.equal((await api('GET', '/accounts/not-an-id')).status, 404);
    assert.equal((await api('GET', `/accounts/${MISSING_ID}`)).status, 404);
    assert.equal((await api('PATCH', `/accounts/${MISSING_ID}`, { name: 'Y' })).status, 404);
    assert.equal((await api('DELETE', `/accounts/${MISSING_ID}`)).status, 404);
  });

  test('bad filter values are 400', async () => {
    assert.equal((await api('GET', '/contacts?accountId=nope')).status, 400);
    assert.equal((await api('GET', '/employees?active=yes')).status, 400);
    assert.equal((await api('GET', '/accounts?limit=0')).status, 400);
  });

  test('reference to a missing record is a 400', async () => {
    const res = await api('POST', '/contacts', { name: 'Pat', accountId: MISSING_ID });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /referenced record/);
  });

  test('deleting a record still in use is a 409', async () => {
    const resource = await create('/resources', { name: 'Dev' });
    const project = await create('/projects', { code: 'p1', name: 'Project' });
    await create('/tasks', { taskNumber: 1, projectId: project.id, resourceId: resource.id, name: 'Build' });
    const res = await api('DELETE', `/projects/${project.id}`);
    assert.equal(res.status, 409);
  });

  test('database rules come back as 400', async () => {
    const res = await api('POST', '/ledger', { entryDate: '2026-11-07', type: 'income', category: 'Travel', amount: 10 });
    assert.equal(res.status, 400, 'expense category on an income entry');
    const noContractor = await api('POST', '/ledger', { entryDate: '2026-11-07', type: 'expense', category: 'Contractors (1099)', amount: 10 });
    assert.equal(noContractor.status, 400, '1099 expense needs a contractor');
  });
});

describe('other resources', () => {
  test('projects uppercase their code', async () => {
    const p = await create('/projects', { code: 'mcerp', name: 'MCE ERP', type: 'T&M' });
    assert.equal(p.code, 'MCERP');
    assert.equal((await api('GET', '/projects?code=MCERP')).body.total, 1);
  });

  test('trips filter by date range and keep decimals', async () => {
    await create('/trips', { tripDate: '2026-05-18', miles: 133.6, kind: 'business' });
    await create('/trips', { tripDate: '2026-06-02', miles: 12, kind: 'charitable' });
    const res = await api('GET', '/trips?from=2026-05-01&to=2026-05-31');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data[0].miles, 133.6, 'numbers come back as numbers');
  });

  test('activities need exactly one parent', async () => {
    const a = await create('/accounts', { name: 'Acme' });
    const ok = await create('/activities', { accountId: a.id, activityDate: '2026-11-07', type: 'Call', body: 'Intro' });
    assert.equal(ok.type, 'Call');
    const orphan = await api('POST', '/activities', { activityDate: '2026-11-07' });
    assert.equal(orphan.status, 400);
    const list = await api('GET', `/activities?accountId=${a.id}`);
    assert.equal(list.body.total, 1);
  });

  test('every standard resource lists', async () => {
    for (const path of ['/employees', '/resources', '/accounts', '/contacts', '/projects', '/opportunities',
      '/activities', '/tasks', '/vehicles', '/trips', '/ledger']) {
      const res = await api('GET', path);
      assert.equal(res.status, 200, path);
      assert.deepEqual(res.body.data, [], path);
    }
  });
});

describe('opportunity contacts', () => {
  test('replace and list contacts on an opportunity', async () => {
    const opp = await create('/opportunities', { name: 'Assessment', stage: 'Lead', value: 25000 });
    const c1 = await create('/contacts', { firstName: 'Ann', lastName: 'Able' });
    const c2 = await create('/contacts', { firstName: 'Bob', lastName: 'Baker' });

    const put = await api('PUT', `/opportunities/${opp.id}/contacts`, { contactIds: [c2.id, c1.id, c1.id] });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.data.map((c: any) => c.firstName), ['Ann', 'Bob']);

    const cleared = await api('PUT', `/opportunities/${opp.id}/contacts`, { contactIds: [] });
    assert.deepEqual(cleared.body.data, []);

    assert.equal((await api('GET', `/opportunities/${MISSING_ID}/contacts`)).status, 404);
    assert.equal((await api('PUT', `/opportunities/${opp.id}/contacts`, { contactIds: [MISSING_ID] })).status, 400);
  });
});

describe('mileage rates', () => {
  test('set, look up by date, and delete', async () => {
    await api('PUT', '/mileage-rates/business/2026-01-01', { ratePerMile: 0.725 });
    await api('PUT', '/mileage-rates/business/2026-07-01', { ratePerMile: 0.76 });
    const updated = await api('PUT', '/mileage-rates/business/2026-07-01', { ratePerMile: 0.77 });
    assert.equal(updated.body.data.ratePerMile, 0.77, 'PUT replaces an existing rate');

    const march = await api('GET', '/mileage-rates/lookup?date=2026-03-15&kind=business');
    assert.equal(march.body.data.ratePerMile, 0.725);
    const aug = await api('GET', '/mileage-rates/lookup?date=2026-08-01&kind=business');
    assert.equal(aug.body.data.ratePerMile, 0.77);
    assert.equal((await api('GET', '/mileage-rates/lookup?date=2025-01-01&kind=business')).status, 404);

    assert.equal((await api('GET', '/mileage-rates')).body.data.length, 2);
    assert.equal((await api('DELETE', '/mileage-rates/business/2026-07-01')).status, 204);
    assert.equal((await api('DELETE', '/mileage-rates/business/2026-07-01')).status, 404);
    assert.equal((await api('PUT', '/mileage-rates/commute/2026-01-01', { ratePerMile: 1 })).status, 400);
  });
});

describe('invoice settings', () => {
  test('starts with defaults and saves changes', async () => {
    const first = await api('GET', '/settings/invoicing');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.termsDays, 30);
    assert.equal(first.body.data.id, undefined);

    const saved = await api('PUT', '/settings/invoicing', { company: 'Beaman Consulting', numberPrefix: 'BC', taxRate: 0.0865 });
    assert.equal(saved.body.data.company, 'Beaman Consulting');
    assert.equal(saved.body.data.taxRate, 0.0865);

    const again = await api('GET', '/settings/invoicing');
    assert.equal(again.body.data.numberPrefix, 'BC');
    assert.equal((await api('PUT', '/settings/invoicing', { colour: 'red' })).status, 400);
  });
});
