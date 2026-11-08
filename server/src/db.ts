import pg from 'pg';
import { config } from './config.ts';

// numeric -> JS number (money is numeric(12,2), well inside float precision)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
// date -> 'YYYY-MM-DD' string, so dates never shift with the server's time zone
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// bigint (e.g. count(*)) -> number
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export type Row = Record<string, unknown>;

export const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
export const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Converts a database row's snake_case keys to camelCase for the API. */
export function camelRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

/** Quotes a SQL identifier. Only ever called with names defined in code. */
export const ident = (name: string) => '"' + name.replace(/"/g, '""') + '"';

export async function query(text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await pool.query(text, values);
  return result.rows.map(camelRow);
}

/** Runs fn inside a transaction on one connection. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
