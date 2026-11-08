// Builds standard REST routes for a table from a small definition:
//
//   GET    /            list, with ?q= search, filters, ?from=&to= dates, ?limit=&offset=
//   GET    /:id         one record
//   POST   /            create (body checked against `fields`)
//   PATCH  /:id         update some fields
//   DELETE /:id         delete
//
// The API speaks camelCase; columns are the snake_case form of each field name.

import { Router } from 'express';
import { z } from 'zod';
import { ident, query, toSnake } from './db.ts';
import { HttpError, notFound } from './errors.ts';

export type FilterType = 'text' | 'uuid' | 'bool' | 'int';

export interface ResourceDef {
  /** URL path under /api, e.g. "/accounts" */
  path: string;
  table: string;
  /** Singular label for messages, e.g. "Account" */
  label: string;
  /** Writable fields. Required fields are required on create; all are optional on update. */
  fields: z.ZodRawShape;
  /** Fields that can be used as ?field=value filters. */
  filters?: Record<string, FilterType>;
  /** SQL expressions searched by ?q= (case-insensitive substring). */
  search?: string[];
  /** Date column that ?from= and ?to= filter on (inclusive). */
  dateColumn?: string;
  /** ORDER BY clause for lists. */
  orderBy: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z.iso.date();

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseFilter(name: string, type: FilterType, raw: unknown): unknown {
  if (typeof raw !== 'string') throw new HttpError(400, `Filter ${name} must be a single value`);
  switch (type) {
    case 'uuid':
      if (!UUID.test(raw)) throw new HttpError(400, `Filter ${name} must be an id`);
      return raw;
    case 'bool':
      if (raw !== 'true' && raw !== 'false') throw new HttpError(400, `Filter ${name} must be true or false`);
      return raw === 'true';
    case 'int':
      if (!/^-?\d+$/.test(raw)) throw new HttpError(400, `Filter ${name} must be a whole number`);
      return Number(raw);
    default:
      return raw;
  }
}

/** Builds "col1" = $1, "col2" = $2 ... from a camelCase body. */
function columnsFor(body: Record<string, unknown>) {
  const keys = Object.keys(body);
  return { cols: keys.map((k) => ident(toSnake(k))), values: keys.map((k) => body[k]) };
}

export function crudRouter(def: ResourceDef): Router {
  const router = Router();
  const table = ident(def.table);
  const createSchema = z.strictObject(def.fields);
  const updateSchema = createSchema.partial().refine((b) => Object.keys(b).length > 0, 'Send at least one field to change');

  const idParam = (raw: string) => {
    if (!UUID.test(raw)) throw notFound(def.label);
    return raw;
  };

  router.get('/', async (req, res) => {
    const { q, from, to, limit, offset } = listQuery.parse(req.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: (p: string) => string, value: unknown) => {
      values.push(value);
      where.push(sql('$' + values.length));
    };

    for (const [name, type] of Object.entries(def.filters ?? {})) {
      if (req.query[name] === undefined) continue;
      const value = parseFilter(name, type, req.query[name]);
      add((p) => `${ident(toSnake(name))} = ${p}`, value);
    }
    if (q && def.search?.length) {
      add((p) => '(' + def.search!.map((expr) => `${expr} ILIKE ${p}`).join(' OR ') + ')', '%' + q.replace(/[\\%_]/g, '\\$&') + '%');
    }
    if (def.dateColumn) {
      if (from) add((p) => `${ident(def.dateColumn!)} >= ${p}`, from);
      if (to) add((p) => `${ident(def.dateColumn!)} <= ${p}`, to);
    }

    values.push(limit, offset);
    const rows = await query(
      `SELECT *, count(*) OVER () AS crud_total_count FROM ${table}
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY ${def.orderBy}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    // An offset past the end returns no rows, so fall back to counting.
    let total = rows[0]?.crudTotalCount as number | undefined;
    if (total === undefined) {
      total = offset === 0 ? 0 : ((await query(
        `SELECT count(*) AS n FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
        values.slice(0, -2),
      ))[0]!.n as number);
    }
    for (const r of rows) delete r.crudTotalCount;
    res.json({ data: rows, total, limit, offset });
  });

  router.get('/:id', async (req, res) => {
    const [row] = await query(`SELECT * FROM ${table} WHERE id = $1`, [idParam(req.params.id)]);
    if (!row) throw notFound(def.label);
    res.json({ data: row });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.parse(req.body ?? {});
    const { cols, values } = columnsFor(body);
    const [row] = await query(
      cols.length
        ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`
        : `INSERT INTO ${table} DEFAULT VALUES RETURNING *`,
      values,
    );
    res.status(201).location(`/api${def.path}/${row!.id}`).json({ data: row });
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const body = updateSchema.parse(req.body ?? {});
    const { cols, values } = columnsFor(body);
    const [row] = await query(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (!row) throw notFound(def.label);
    res.json({ data: row });
  });

  router.delete('/:id', async (req, res) => {
    const [row] = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [idParam(req.params.id)]);
    if (!row) throw notFound(def.label);
    res.status(204).end();
  });

  return router;
}
