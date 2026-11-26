import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, beforeEach } from 'node:test';
import { createApp } from '../src/app.ts';
import { ensureDefaultRoles } from '../src/auth/permissions.ts';
import { createSession } from '../src/auth/session.ts';
import { pool } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

// Tests empty every table, so refuse to run against anything but a test database.
const dbName = new URL(process.env.DATABASE_URL ?? 'x://').pathname.slice(1);
if (!dbName.endsWith('_test')) {
  throw new Error(`Tests must run against a database whose name ends in _test (got "${dbName}"). See server/README.md.`);
}

let server: Server;
let baseUrl = '';

export interface ApiResponse {
  status: number;
  body: any;
  type: string;
}

/** The signed-in session `api` uses: an admin by default (set in beforeEach). */
let sessionToken = '';

/** Sends a request as the default admin user. */
export function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  return apiAs(sessionToken, method, path, body);
}

/** Sends a request with a given session token ('' = not signed in). */
export async function apiAs(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { cookie: `bc_session=${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const textBody = await res.text();
  const json = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, body: textBody ? (json ? JSON.parse(textBody) : textBody) : null, type: res.headers.get('content-type') ?? '' };
}

/** Adds a user with the named built-in role (or role id) and returns them with a signed-in session token. */
export async function signInAs(role: string, opts: { resourceId?: string; email?: string } = {}) {
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, name, role_id, resource_id)
     SELECT $1, $2, id, $3 FROM roles WHERE name = $2 OR id::text = $2 RETURNING *`,
    [opts.email ?? `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@example.com`, role, opts.resourceId ?? null],
  );
  if (!user) throw new Error(`No role ${role}`);
  return { user, token: await createSession(user.id) };
}

/** Creates a record and returns it, failing loudly if the API rejects it. */
export async function create(path: string, body: unknown): Promise<any> {
  const res = await api('POST', path, body);
  if (res.status !== 201) throw new Error(`POST ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export function useTestServer() {
  before(async () => {
    await migrate(() => {});
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });

  beforeEach(async () => {
    const { rows } = await pool.query(
      `SELECT string_agg(format('%I', tablename), ', ') AS t FROM pg_tables
       WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'`,
    );
    if (rows[0].t) await pool.query(`TRUNCATE ${rows[0].t} RESTART IDENTITY CASCADE`);
    await ensureDefaultRoles();
    sessionToken = (await signInAs('Admin', { email: 'admin@example.com' })).token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
}
