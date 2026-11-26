// Areas of the app, which permission each API endpoint needs, and the built-in roles.
//
// Every request under /api is checked against RULES (see `ruleFor`). Anything
// no rule covers is refused for everyone except admins, so a new endpoint is
// closed until it's given a rule here.

import type pg from 'pg';
import { pool } from '../db.ts';

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export interface AreaDef {
  key: string;
  label: string;
  /** Which of create/read/update/delete mean anything here. */
  actions: readonly Action[];
  /** Whether "own records only" applies (records tied to the user's resource). */
  ownOnly?: boolean;
  /** Shown next to the area on the Users & roles page. */
  note?: string;
}

const CRUD = ACTIONS;

export const AREAS: readonly AreaDef[] = [
  { key: 'timesheets', label: 'Timesheet', actions: CRUD, ownOnly: true, note: 'Update = enter hours, submit and recall' },
  { key: 'approvals', label: 'Approvals', actions: ['read', 'update'], note: "Read = see everyone's timesheets. Update = approve, return and reopen" },
  { key: 'budgets', label: 'Budgets', actions: ['read'] },
  { key: 'mileage', label: 'Mileage', actions: CRUD, ownOnly: true },
  { key: 'pipeline', label: 'Pipeline', actions: CRUD },
  { key: 'accounts', label: 'Accounts', actions: CRUD },
  { key: 'contacts', label: 'Contacts', actions: CRUD, note: 'Create includes importing contacts' },
  { key: 'invoices', label: 'Invoices', actions: CRUD, note: 'Update includes sending, voiding and recording payments' },
  { key: 'accounting', label: 'Accounting', actions: CRUD, note: 'Includes the P&L, receivables and contractor reports' },
  { key: 'reports', label: 'Reports', actions: ['read'] },
  { key: 'employees', label: 'Employees', actions: CRUD },
  { key: 'setup', label: 'Setup', actions: CRUD, note: 'Projects, tasks and rates, people who log time, vehicles, mileage rates' },
];

export const AREA_KEYS = AREAS.map((a) => a.key);
export type Area = string;

export interface AreaPermission {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  ownOnly: boolean;
}

export interface Permissions {
  isAdmin: boolean;
  areas: Record<Area, AreaPermission>;
}

export const can = (p: Permissions, area: Area, action: Action) => p.isAdmin || !!p.areas[area]?.[action];

// ---- endpoint rules -------------------------------------------------------------

export type Rule =
  | { kind: 'public' }
  | { kind: 'signedIn' }
  | { kind: 'admin' }
  /** Allowed if the user may do `action` in any one of `areas`. */
  | { kind: 'area'; areas: Area[]; action: Action };

const METHOD_ACTION: Record<string, Action> = { GET: 'read', HEAD: 'read', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
const READ = ['GET', 'HEAD'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const ANY = [...READ, ...WRITE];

type RuleRow = [methods: string[], path: RegExp, rule: Rule | { areas: Area[]; action?: Action }];

const under = (...prefixes: string[]) => new RegExp(`^/(${prefixes.join('|')})(/|$)`);

// First match wins. Paths are relative to /api, without the query string.
const RULES: RuleRow[] = [
  [READ, /^\/health$/, { kind: 'public' }],
  [ANY, /^\/admin(\/|$)/, { kind: 'admin' }],

  // Timesheets and approvals
  [['POST'], /^\/timesheets\/[^/]+\/(approve|return|reopen)$/, { areas: ['approvals'], action: 'update' }],
  [['POST'], /^\/timesheets\/[^/]+\/(submit|recall)$/, { areas: ['timesheets'], action: 'update' }],
  [READ, under('timesheets'), { areas: ['timesheets', 'approvals'] }],
  // Saving a week's grid: also needs "create" when the week has no sheet yet (checked in the route).
  [['PUT', 'POST'], /^\/resources\/[^/]+\/timesheets\//, { areas: ['timesheets'], action: 'update' }],
  [READ, /^\/resources\/[^/]+\/timesheets\//, { areas: ['timesheets'] }],
  [ANY, under('timesheets'), { areas: ['timesheets'] }],

  // Lists other screens need for their drop-downs: anyone signed in may read them.
  [READ, under('projects', 'tasks', 'resources', 'vehicles', 'mileage-rates', 'employees', 'settings/invoicing'), { kind: 'signedIn' }],
  [WRITE, under('projects', 'tasks', 'resources', 'vehicles', 'mileage-rates'), { areas: ['setup'] }],
  [WRITE, under('settings/invoicing'), { areas: ['invoices'], action: 'update' }],
  [WRITE, under('employees'), { areas: ['employees'] }],

  [ANY, under('trips'), { areas: ['mileage'] }],

  [['POST'], /^\/opportunities\/[^/]+\/convert$/, { areas: ['pipeline'], action: 'update' }],
  [ANY, under('opportunities', 'opportunity-contacts'), { areas: ['pipeline'] }],
  [ANY, under('accounts'), { areas: ['accounts'] }],
  [ANY, under('contacts'), { areas: ['contacts'] }],
  // Activity notes sit on a contact, an account or an opportunity.
  [ANY, under('activities'), { areas: ['contacts', 'accounts', 'pipeline'] }],

  [['POST'], /^\/invoices\/[^/]+\/(send|unsend|void|payments)$/, { areas: ['invoices'], action: 'update' }],
  [['DELETE'], /^\/invoices\/[^/]+\/payments\/[^/]+$/, { areas: ['invoices'], action: 'update' }],
  [ANY, under('invoices', 'invoice-payments'), { areas: ['invoices'] }],
  [ANY, under('ledger'), { areas: ['accounting'] }],

  // Reports belong to the screen that shows them.
  [READ, under('reports/budgets'), { areas: ['budgets'] }],
  [READ, under('reports/pnl', 'reports/receivables', 'reports/contractors'), { areas: ['accounting'] }],
  [READ, under('reports/accounts'), { areas: ['accounts'] }],
  [READ, under('reports/contacts'), { areas: ['contacts'] }],
  [READ, under('reports/invoicing'), { areas: ['invoices'] }],
  [READ, under('reports/mileage'), { areas: ['reports', 'mileage'] }],
  [READ, under('reports'), { areas: ['reports'] }],
];

/** The rule for a request, or null if no rule covers it (admins only). */
export function ruleFor(method: string, path: string): Rule | null {
  const m = method.toUpperCase();
  for (const [methods, re, rule] of RULES) {
    if (!methods.includes(m) || !re.test(path)) continue;
    if ('kind' in rule) return rule;
    const action = rule.action ?? METHOD_ACTION[m];
    return action ? { kind: 'area', areas: rule.areas, action } : null;
  }
  return null;
}

export function allows(p: Permissions, rule: Rule | null): boolean {
  if (p.isAdmin) return true;
  if (!rule) return false;
  switch (rule.kind) {
    case 'public':
    case 'signedIn':
      return true;
    case 'admin':
      return false;
    case 'area':
      return rule.areas.some((a) => can(p, a, rule.action));
  }
}

// ---- loading a role's permissions -------------------------------------------------

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export async function loadPermissions(roleId: string, db: Queryable = pool): Promise<Permissions> {
  const { rows: [role] } = await db.query('SELECT is_admin FROM roles WHERE id = $1', [roleId]);
  const { rows } = await db.query('SELECT * FROM role_permissions WHERE role_id = $1', [roleId]);
  const areas: Record<Area, AreaPermission> = {};
  for (const key of AREA_KEYS) areas[key] = { create: false, read: false, update: false, delete: false, ownOnly: false };
  for (const r of rows) {
    if (!areas[r.area]) continue; // an area that no longer exists
    areas[r.area] = { create: r.can_create, read: r.can_read, update: r.can_update, delete: r.can_delete, ownOnly: r.own_only };
  }
  return { isAdmin: !!role?.is_admin, areas };
}

// ---- built-in roles -----------------------------------------------------------------

type Grant = string; // letters from "crud", plus "o" for own records only

interface DefaultRole {
  name: string;
  description: string;
  isAdmin?: boolean;
  grants: Record<Area, Grant>;
}

const readAll = Object.fromEntries(AREA_KEYS.map((k) => [k, 'r']));

export const DEFAULT_ROLES: DefaultRole[] = [
  { name: 'Admin', description: 'Everything, including users and roles', isAdmin: true, grants: {} },
  {
    name: 'Manager',
    description: 'Runs projects and clients, approves time',
    grants: {
      timesheets: 'crud', approvals: 'ru', budgets: 'r', mileage: 'crud', pipeline: 'crud', accounts: 'crud',
      contacts: 'crud', invoices: 'r', reports: 'r', employees: 'r', setup: 'r',
    },
  },
  {
    name: 'Accounting',
    description: 'Invoices, payments and the books',
    grants: {
      timesheets: 'r', approvals: 'r', budgets: 'r', mileage: 'r', accounts: 'r', contacts: 'r',
      invoices: 'crud', accounting: 'crud', reports: 'r',
    },
  },
  {
    name: 'Employee',
    description: 'Own time and mileage; can look up clients',
    grants: { timesheets: 'crudo', mileage: 'crudo', pipeline: 'r', accounts: 'r', contacts: 'r' },
  },
  { name: 'Viewer', description: 'Can look at everything, change nothing', grants: readAll },
];

/** Adds any built-in role that's missing. Never changes a role that exists, so edits stick. */
export async function ensureDefaultRoles(db: Queryable = pool): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    const { rows: [row] } = await db.query(
      `INSERT INTO roles (name, description, is_admin, built_in) VALUES ($1, $2, $3, true)
       ON CONFLICT ((lower(name))) DO NOTHING RETURNING id`,
      [r.name, r.description, !!r.isAdmin],
    );
    if (!row) continue;
    for (const [area, g] of Object.entries(r.grants)) {
      await db.query(
        `INSERT INTO role_permissions (role_id, area, can_create, can_read, can_update, can_delete, own_only)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [row.id, area, g.includes('c'), g.includes('r'), g.includes('u'), g.includes('d'), g.includes('o')],
      );
    }
  }
}
