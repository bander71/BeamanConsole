import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, beforeEach } from 'node:test';
import { createApp } from '../src/app.ts';
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
}

export async function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const textBody = await res.text();
  return { status: res.status, body: textBody ? JSON.parse(textBody) : null };
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
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
}
