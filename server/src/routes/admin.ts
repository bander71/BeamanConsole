// Users, roles and the change log. Admins only (see the /admin rule in auth/permissions.ts).
//
// GET    /admin/users             PATCH /admin/users/:id      DELETE /admin/users/:id
// POST   /admin/users             { email, name?, roleId, resourceId?, active? }
// GET    /admin/roles             with each role's permissions and how many users have it
// POST   /admin/roles             { name, description?, permissions: { <area>: { create, read, update, delete, ownOnly } } }
// PATCH  /admin/roles/:id         same fields, all optional; permissions replace the role's whole grid
// DELETE /admin/roles/:id         not built-in roles, and only when no user has the role
// GET    /admin/audit             latest changes (?limit=, default 200)
//
// There must always be at least one active admin, so changes that would leave
// none are refused.

import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { query, transaction } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { AREAS, AREA_KEYS } from '../auth/permissions.ts';

export const adminRoutes = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = (raw: string, what: string) => {
  if (!UUID.test(raw)) throw notFound(what);
  return raw;
};

async function assertAnAdminLeft(client: pg.PoolClient) {
  const { rows: [{ n }] } = await client.query(
    'SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active AND r.is_admin',
  );
  if (!n) throw new HttpError(409, 'There must always be at least one active admin');
}

// ---- users ------------------------------------------------------------------------

const userFields = {
  email: z.email().max(320).transform((e) => e.toLowerCase()),
  name: z.string().trim().max(200).optional(),
  roleId: z.uuid(),
  resourceId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
};
const createUser = z.strictObject(userFields);
const updateUser = z.strictObject(userFields).partial().refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.role_id, r.name AS role_name, r.is_admin, u.resource_id, res.name AS resource_name,
         u.active, u.entra_oid IS NOT NULL AS linked, u.last_sign_in_at, u.created_at, u.updated_at
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN resources res ON res.id = u.resource_id`;

const oneUser = async (id: string) => (await query(`${USER_SELECT} WHERE u.id = $1`, [id]))[0];

adminRoutes.get('/admin/users', async (_req, res) => {
  res.json({ data: await query(`${USER_SELECT} ORDER BY u.active DESC, lower(u.name), u.email`) });
});

adminRoutes.post('/admin/users', async (req, res) => {
  const b = createUser.parse(req.body ?? {});
  const [row] = await query(
    `INSERT INTO users (email, name, role_id, resource_id, active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [b.email, b.name ?? '', b.roleId, b.resourceId ?? null, b.active ?? true],
  );
  res.status(201).json({ data: await oneUser(row!.id as string) });
});

adminRoutes.patch('/admin/users/:id', async (req, res) => {
  const id = idParam(req.params.id, 'User');
  const b = updateUser.parse(req.body ?? {});
  await transaction(async (client) => {
    const { rows: [before] } = await client.query('SELECT email FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!before) throw notFound('User');
    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    };
    if (b.email !== undefined) {
      set('email', b.email);
      // A new email means a new person: the old Microsoft account link no longer applies.
      if (b.email !== before.email.toLowerCase()) sets.push('entra_oid = NULL');
    }
    if (b.name !== undefined) set('name', b.name);
    if (b.roleId !== undefined) set('role_id', b.roleId);
    if (b.resourceId !== undefined) set('resource_id', b.resourceId);
    if (b.active !== undefined) set('active', b.active);
    await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, values);
    if (b.active === false) await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await assertAnAdminLeft(client);
  });
  res.json({ data: await oneUser(id) });
});

adminRoutes.delete('/admin/users/:id', async (req, res) => {
  const id = idParam(req.params.id, 'User');
  if (id === req.auth?.user.id) throw new HttpError(409, "You can't delete yourself");
  await transaction(async (client) => {
    const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw notFound('User');
    await assertAnAdminLeft(client);
  });
  res.status(204).end();
});

// ---- roles ------------------------------------------------------------------------

const areaPermission = z.strictObject({
  create: z.boolean().optional(),
  read: z.boolean().optional(),
  update: z.boolean().optional(),
  delete: z.boolean().optional(),
  ownOnly: z.boolean().optional(),
});
const permissionsField = z.partialRecord(z.enum(AREA_KEYS as [string, ...string[]]), areaPermission);
const roleFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  permissions: permissionsField.optional(),
};
const createRole = z.strictObject(roleFields);
const updateRole = z.strictObject(roleFields).partial().refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

async function listRoles(where = '', values: unknown[] = []) {
  const roles = await query(
    `SELECT r.*, (SELECT count(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ${where}
     ORDER BY r.is_admin DESC, r.built_in DESC, lower(r.name)`,
    values,
  );
  const perms = await query('SELECT * FROM role_permissions');
  return roles.map((r) => {
    const permissions: Record<string, unknown> = {};
    for (const a of AREAS) {
      const p = perms.find((x) => x.roleId === r.id && x.area === a.key);
      permissions[a.key] = {
        create: !!p?.canCreate, read: !!p?.canRead, update: !!p?.canUpdate, delete: !!p?.canDelete, ownOnly: !!p?.ownOnly,
      };
    }
    return { ...r, permissions };
  });
}

async function writePermissions(client: pg.PoolClient, roleId: string, permissions: z.infer<typeof permissionsField>) {
  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  for (const area of AREAS) {
    const p = permissions[area.key];
    if (!p) continue;
    // Only the actions that mean something in the area are kept.
    const keep = (a: 'create' | 'read' | 'update' | 'delete') => area.actions.includes(a) && !!p[a];
    await client.query(
      `INSERT INTO role_permissions (role_id, area, can_create, can_read, can_update, can_delete, own_only)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roleId, area.key, keep('create'), keep('read'), keep('update'), keep('delete'), !!area.ownOnly && !!p.ownOnly],
    );
  }
}

adminRoutes.get('/admin/roles', async (_req, res) => {
  res.json({ data: await listRoles(), areas: AREAS });
});

adminRoutes.post('/admin/roles', async (req, res) => {
  const b = createRole.parse(req.body ?? {});
  const id = await transaction(async (client) => {
    const { rows: [row] } = await client.query('INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id', [b.name, b.description ?? '']);
    await writePermissions(client, row.id, b.permissions ?? {});
    return row.id as string;
  });
  res.status(201).json({ data: (await listRoles('WHERE r.id = $1', [id]))[0] });
});

adminRoutes.patch('/admin/roles/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Role');
  const b = updateRole.parse(req.body ?? {});
  await transaction(async (client) => {
    const { rows: [role] } = await client.query('SELECT is_admin FROM roles WHERE id = $1 FOR UPDATE', [id]);
    if (!role) throw notFound('Role');
    if (b.permissions && role.is_admin) throw new HttpError(409, 'Admin roles can do everything; their permissions can’t be changed');
    if (b.name !== undefined || b.description !== undefined) {
      await client.query('UPDATE roles SET name = coalesce($2, name), description = coalesce($3, description) WHERE id = $1', [id, b.name ?? null, b.description ?? null]);
    }
    if (b.permissions) await writePermissions(client, id, b.permissions);
  });
  res.json({ data: (await listRoles('WHERE r.id = $1', [id]))[0] });
});

adminRoutes.delete('/admin/roles/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Role');
  const [role] = await query('SELECT built_in FROM roles WHERE id = $1', [id]);
  if (!role) throw notFound('Role');
  if (role.builtIn) throw new HttpError(409, 'Built-in roles can’t be deleted');
  await query('DELETE FROM roles WHERE id = $1', [id]); // users still on it -> 409 from the foreign key
  res.status(204).end();
});

// ---- change log -------------------------------------------------------------------------

adminRoutes.get('/admin/audit', async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(1000).default(200).parse(req.query.limit);
  res.json({ data: (await query('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT $1', [limit])) });
});

