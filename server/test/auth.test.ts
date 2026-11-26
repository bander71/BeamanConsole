import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { pool } from '../src/db.ts';
import { ruleFor } from '../src/auth/permissions.ts';
import { api, apiAs, create, signInAs, useTestServer } from './helpers.ts';

useTestServer();

const WEEK = '2026-11-02'; // a Monday

let me: any, someoneElse: any, task: any;
let employee: string, viewer: string, manager: string, accounting: string;

beforeEach(async () => {
  me = await create('/resources', { name: 'Erin Employee' });
  someoneElse = await create('/resources', { name: 'Other Person' });
  const acct = await create('/accounts', { name: 'Acme', type: 'Client' });
  const project = await create('/projects', { code: 'ACME', name: 'Acme Build', accountId: acct.id });
  task = await create('/tasks', { taskNumber: 501, projectId: project.id, resourceId: me.id, name: 'Build', billRate: 150 });
  await create('/tasks', { taskNumber: 601, projectId: project.id, resourceId: someoneElse.id, name: 'Build', billRate: 150 });
  employee = (await signInAs('Employee', { resourceId: me.id })).token;
  viewer = (await signInAs('Viewer')).token;
  manager = (await signInAs('Manager')).token;
  accounting = (await signInAs('Accounting')).token;
});

describe('signing in', () => {
  test('everything but health and sign-in needs a session', async () => {
    assert.equal((await apiAs('', 'GET', '/health')).status, 200);
    assert.equal((await apiAs('', 'GET', '/auth/options')).status, 200);
    for (const [m, p] of [['GET', '/accounts'], ['POST', '/accounts'], ['GET', '/reports/pnl'], ['GET', '/admin/users'], ['GET', '/auth/me']]) {
      const res = await apiAs('', m!, p!, m === 'POST' ? { name: 'x' } : undefined);
      assert.equal(res.status, 401, `${m} ${p}`);
      assert.equal(res.body.error.message, 'Please sign in');
    }
  });

  test('a made-up session token is not signed in', async () => {
    assert.equal((await apiAs('not-a-real-token', 'GET', '/accounts')).status, 401);
  });

  test('/auth/me returns the user, role and permissions', async () => {
    const res = await apiAs(employee, 'GET', '/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.roleName, 'Employee');
    assert.equal(res.body.data.user.resourceId, me.id);
    assert.equal(res.body.data.permissions.isAdmin, false);
    assert.deepEqual(res.body.data.permissions.areas.timesheets, { create: true, read: true, update: true, delete: true, ownOnly: true });
    assert.equal(res.body.data.permissions.areas.accounting.read, false);
    assert.ok(res.body.data.areas.some((a: any) => a.key === 'invoices'));
  });

  test('signing out ends the session', async () => {
    assert.equal((await apiAs(viewer, 'POST', '/auth/logout')).status, 204);
    assert.equal((await apiAs(viewer, 'GET', '/accounts')).status, 401);
  });

  test('a turned-off user is signed out at once', async () => {
    const { user, token } = await signInAs('Viewer');
    const res = await api('PATCH', `/admin/users/${user.id}`, { active: false });
    assert.equal(res.status, 200);
    assert.equal((await apiAs(token, 'GET', '/accounts')).status, 401);
  });

  test('an expired session is not signed in', async () => {
    const { token } = await signInAs('Viewer');
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`);
    assert.equal((await apiAs(token, 'GET', '/accounts')).status, 401);
  });

  test('sessions are stored as hashes, not the token itself', async () => {
    const { rows } = await pool.query('SELECT token_hash FROM sessions');
    assert.ok(rows.length);
    for (const r of rows) assert.notEqual(r.token_hash, employee);
  });

  test('"sign in as" for development is off unless AUTH_DEV_LOGIN is set', async () => {
    assert.equal((await apiAs('', 'GET', '/auth/dev/users')).status, 404);
    assert.equal((await apiAs('', 'POST', '/auth/dev/login', { email: 'x@example.com' })).status, 404);
  });

  test('changes sent from another website are refused', async () => {
    const res = await apiAs(manager, 'POST', '/accounts', { name: 'Evil', type: 'Client' }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal((await apiAs(manager, 'GET', '/accounts', undefined, { origin: 'https://evil.example' })).status, 200, 'reads are fine');
  });
});

describe('create / read / update / delete rights', () => {
  test('a viewer can read but not change', async () => {
    assert.equal((await apiAs(viewer, 'GET', '/accounts')).status, 200);
    assert.equal((await apiAs(viewer, 'GET', '/ledger')).status, 200);
    const res = await apiAs(viewer, 'POST', '/accounts', { name: 'New', type: 'Client' });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /Viewer.*can't create Accounts/);
    const [acct] = (await apiAs(viewer, 'GET', '/accounts')).body.data;
    assert.equal((await apiAs(viewer, 'PATCH', `/accounts/${acct.id}`, { phone: '1' })).status, 403);
    assert.equal((await apiAs(viewer, 'DELETE', `/accounts/${acct.id}`)).status, 403);
  });

  test('each action is checked on its own', async () => {
    const roleRes = await api('POST', '/admin/roles', {
      name: 'Contacts clerk',
      permissions: { contacts: { read: true, create: true } },
    });
    assert.equal(roleRes.status, 201);
    const { token } = await signInAs(roleRes.body.data.id);
    const made = await apiAs(token, 'POST', '/contacts', { firstName: 'Cal' });
    assert.equal(made.status, 201);
    assert.equal((await apiAs(token, 'GET', `/contacts/${made.body.data.id}`)).status, 200);
    assert.equal((await apiAs(token, 'PATCH', `/contacts/${made.body.data.id}`, { title: 'X' })).status, 403);
    assert.equal((await apiAs(token, 'DELETE', `/contacts/${made.body.data.id}`)).status, 403);
    assert.equal((await apiAs(token, 'GET', '/accounts')).status, 403);
  });

  test('financial screens are closed to employees', async () => {
    for (const p of ['/ledger', '/invoices', '/reports/pnl', '/reports/receivables', '/invoice-payments', '/reports/time']) {
      assert.equal((await apiAs(employee, 'GET', p)).status, 403, p);
    }
    assert.equal((await apiAs(accounting, 'GET', '/ledger')).status, 200);
    assert.equal((await apiAs(accounting, 'GET', '/reports/pnl')).status, 200);
  });

  test('drop-down lists are readable by anyone signed in, but only Setup changes them', async () => {
    for (const p of ['/projects', '/tasks', '/resources', '/vehicles', '/employees', '/mileage-rates']) {
      assert.equal((await apiAs(employee, 'GET', p)).status, 200, p);
    }
    assert.equal((await apiAs(employee, 'POST', '/projects', { code: 'X', name: 'X' })).status, 403);
    assert.equal((await apiAs(manager, 'PATCH', `/tasks/${task.id}`, { billRate: 1 })).status, 403, 'Manager reads Setup only');
  });

  test('invoice actions count as updates', async () => {
    assert.deepEqual(ruleFor('POST', '/invoices/abc/send'), { kind: 'area', areas: ['invoices'], action: 'update' });
    assert.deepEqual(ruleFor('DELETE', '/invoices/abc/payments/def'), { kind: 'area', areas: ['invoices'], action: 'update' });
    assert.deepEqual(ruleFor('POST', '/invoices'), { kind: 'area', areas: ['invoices'], action: 'create' });
  });

  test('endpoints without a rule are for admins only', async () => {
    assert.equal(ruleFor('GET', '/something-new'), null);
    assert.equal((await apiAs(manager, 'GET', '/something-new')).status, 403);
    assert.equal((await api('GET', '/something-new')).status, 404);
  });
});

describe('own records only', () => {
  test('employees see and log only their own mileage', async () => {
    await create('/trips', { tripDate: '2026-11-03', miles: 10, resourceId: someoneElse.id });
    const mine = await apiAs(employee, 'POST', '/trips', { tripDate: '2026-11-04', miles: 12 });
    assert.equal(mine.status, 201);
    assert.equal(mine.body.data.resourceId, me.id, 'filled in with their own resource');

    const list = await apiAs(employee, 'GET', '/trips');
    assert.deepEqual(list.body.data.map((t: any) => t.miles), [12]);
    assert.equal(list.body.total, 1);
    assert.equal((await api('GET', '/trips')).body.total, 2, 'admin sees all');

    const theirs = (await api('GET', '/trips?resourceId=' + someoneElse.id)).body.data[0];
    assert.equal((await apiAs(employee, 'GET', `/trips/${theirs.id}`)).status, 404);
    assert.equal((await apiAs(employee, 'PATCH', `/trips/${theirs.id}`, { miles: 1 })).status, 404);
    assert.equal((await apiAs(employee, 'DELETE', `/trips/${theirs.id}`)).status, 404);
    assert.equal((await apiAs(employee, 'POST', '/trips', { tripDate: '2026-11-04', miles: 5, resourceId: someoneElse.id })).status, 403);
    assert.equal((await apiAs(employee, 'PATCH', `/trips/${mine.body.data.id}`, { resourceId: someoneElse.id })).status, 403);
    assert.equal((await apiAs(employee, 'PATCH', `/trips/${mine.body.data.id}`, { miles: 13 })).status, 200);
  });

  test('employees fill in and submit only their own timesheets', async () => {
    const lines = [{ taskId: task.id, hours: [8, 0, 0, 0, 0, 0, 0] }];
    const saved = await apiAs(employee, 'PUT', `/resources/${me.id}/timesheets/${WEEK}`, { lines });
    assert.equal(saved.status, 200);
    assert.equal((await apiAs(employee, 'GET', `/resources/${someoneElse.id}/timesheets/${WEEK}`)).status, 403);
    assert.equal((await apiAs(employee, 'PUT', `/resources/${someoneElse.id}/timesheets/${WEEK}`, { lines: [] })).status, 403);

    const other = await api('PUT', `/resources/${someoneElse.id}/timesheets/${WEEK}`, { lines: [] });
    assert.equal((await apiAs(employee, 'GET', `/timesheets/${other.body.data.id}`)).status, 403);
    assert.equal((await apiAs(employee, 'POST', `/timesheets/${other.body.data.id}/submit`)).status, 403);
    assert.equal((await apiAs(employee, 'DELETE', `/timesheets/${other.body.data.id}`)).status, 403);

    const list = await apiAs(employee, 'GET', '/timesheets');
    assert.deepEqual(list.body.data.map((s: any) => s.resourceId), [me.id]);

    assert.equal((await apiAs(employee, 'POST', `/timesheets/${saved.body.data.id}/submit`)).status, 200);
    assert.equal((await apiAs(employee, 'POST', `/timesheets/${saved.body.data.id}/approve`)).status, 403, 'no approving');
  });

  test('a user with no linked resource sees no own records', async () => {
    const { token } = await signInAs('Employee');
    await create('/trips', { tripDate: '2026-11-03', miles: 10, resourceId: me.id });
    assert.equal((await apiAs(token, 'GET', '/trips')).body.total, 0);
    assert.equal((await apiAs(token, 'POST', '/trips', { tripDate: '2026-11-04', miles: 1 })).status, 403);
    assert.equal((await apiAs(token, 'GET', `/resources/${me.id}/timesheets/${WEEK}`)).status, 403);
  });

  test('managers see everyone and approve', async () => {
    const saved = await apiAs(employee, 'PUT', `/resources/${me.id}/timesheets/${WEEK}`, { lines: [{ taskId: task.id, hours: [8, 0, 0, 0, 0, 0, 0] }] });
    await apiAs(employee, 'POST', `/timesheets/${saved.body.data.id}/submit`);
    const queue = await apiAs(manager, 'GET', '/timesheets?status=submitted');
    assert.equal(queue.body.total, 1);
    assert.equal((await apiAs(manager, 'POST', `/timesheets/${saved.body.data.id}/approve`, {})).status, 200);
  });

  test('saving a new week needs create, not just update', async () => {
    const role = await api('POST', '/admin/roles', { name: 'Editor only', permissions: { timesheets: { read: true, update: true } } });
    const { token } = await signInAs(role.body.data.id, { resourceId: someoneElse.id });
    const res = await apiAs(token, 'PUT', `/resources/${me.id}/timesheets/${WEEK}`, { lines: [] });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /can't create Timesheet/);
    await api('PUT', `/resources/${me.id}/timesheets/${WEEK}`, { lines: [] });
    assert.equal((await apiAs(token, 'PUT', `/resources/${me.id}/timesheets/${WEEK}`, { lines: [] })).status, 200);
  });
});

describe('users and roles', () => {
  test('only admins manage users and roles', async () => {
    for (const t of [manager, viewer, accounting, employee]) {
      assert.equal((await apiAs(t, 'GET', '/admin/users')).status, 403);
      assert.equal((await apiAs(t, 'POST', '/admin/roles', { name: 'Sneaky' })).status, 403);
    }
  });

  test('add, change and remove a user', async () => {
    const roles = (await api('GET', '/admin/roles')).body.data;
    const viewerRole = roles.find((r: any) => r.name === 'Viewer');
    const managerRole = roles.find((r: any) => r.name === 'Manager');
    const made = await api('POST', '/admin/users', { email: 'Pat@Example.com', name: 'Pat', roleId: viewerRole.id, resourceId: someoneElse.id });
    assert.equal(made.status, 201);
    assert.equal(made.body.data.email, 'pat@example.com');
    assert.equal(made.body.data.roleName, 'Viewer');
    assert.equal(made.body.data.resourceName, 'Other Person');
    assert.equal((await api('POST', '/admin/users', { email: 'pat@example.com', roleId: viewerRole.id })).status, 409);
    const changed = await api('PATCH', `/admin/users/${made.body.data.id}`, { roleId: managerRole.id });
    assert.equal(changed.body.data.roleName, 'Manager');
    assert.equal((await api('DELETE', `/admin/users/${made.body.data.id}`)).status, 204);
  });

  test('a role change applies on the next request', async () => {
    const { user, token } = await signInAs('Viewer');
    assert.equal((await apiAs(token, 'POST', '/accounts', { name: 'A', type: 'Client' })).status, 403);
    const managerRole = (await api('GET', '/admin/roles')).body.data.find((r: any) => r.name === 'Manager');
    await api('PATCH', `/admin/users/${user.id}`, { roleId: managerRole.id });
    assert.equal((await apiAs(token, 'POST', '/accounts', { name: 'A', type: 'Client' })).status, 201);
  });

  test('there is always an active admin', async () => {
    const { rows: [admin] } = await pool.query(`SELECT id FROM users WHERE email = 'admin@example.com'`);
    const viewerRole = (await api('GET', '/admin/roles')).body.data.find((r: any) => r.name === 'Viewer');
    assert.equal((await api('PATCH', `/admin/users/${admin.id}`, { roleId: viewerRole.id })).status, 409);
    assert.equal((await api('PATCH', `/admin/users/${admin.id}`, { active: false })).status, 409);
    assert.equal((await api('DELETE', `/admin/users/${admin.id}`)).status, 409, "can't delete yourself");
  });

  test('edit a role’s grid; keep only actions that exist in each area', async () => {
    const viewerRole = (await api('GET', '/admin/roles')).body.data.find((r: any) => r.name === 'Viewer');
    const res = await api('PATCH', `/admin/roles/${viewerRole.id}`, {
      permissions: { accounts: { read: true, update: true }, reports: { read: true, delete: true }, pipeline: { read: true, ownOnly: true } },
    });
    assert.equal(res.status, 200);
    const p = res.body.data.permissions;
    assert.deepEqual(p.accounts, { create: false, read: true, update: true, delete: false, ownOnly: false });
    assert.equal(p.reports.delete, false, 'reports are read-only');
    assert.equal(p.pipeline.ownOnly, false, 'own-only only applies to timesheets and mileage');
    assert.equal(p.contacts.read, false, 'the grid is replaced');
  });

  test('admin roles and built-in roles are protected', async () => {
    const roles = (await api('GET', '/admin/roles')).body.data;
    const adminRole = roles.find((r: any) => r.isAdmin);
    assert.equal((await api('PATCH', `/admin/roles/${adminRole.id}`, { permissions: {} })).status, 409);
    assert.equal((await api('DELETE', `/admin/roles/${roles.find((r: any) => r.name === 'Viewer').id}`)).status, 409);

    const custom = await api('POST', '/admin/roles', { name: 'Temp' });
    const { user } = await signInAs(custom.body.data.id);
    assert.equal((await api('DELETE', `/admin/roles/${custom.body.data.id}`)).status, 409, 'still has a user');
    await api('DELETE', `/admin/users/${user.id}`);
    assert.equal((await api('DELETE', `/admin/roles/${custom.body.data.id}`)).status, 204);
  });

  test('changes are written to the audit log with who made them', async () => {
    await apiAs(manager, 'POST', '/accounts', { name: 'Logged', type: 'Client' });
    await apiAs(viewer, 'DELETE', `/accounts/${(await api('GET', '/accounts')).body.data[0].id}`);
    await new Promise((r) => setTimeout(r, 100)); // written after the response
    const log = (await api('GET', '/admin/audit')).body.data;
    const created = log.find((e: any) => e.method === 'POST' && e.path === '/api/accounts' && e.status === 201);
    assert.match(created.userEmail, /^manager-/);
    assert.ok(log.find((e: any) => e.method === 'DELETE' && e.status === 403 && /^viewer-/.test(e.userEmail)), 'refused attempts too');
  });
});
