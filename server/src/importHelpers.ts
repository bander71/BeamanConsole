// Shared pieces for the contact imports (LinkedIn, Outlook): matching rules,
// the existing-contact index, and running an import as a preview or for real.

import type { Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { pool } from './db.ts';

export const lc = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
/** Name key: case, accents, spaces and punctuation ignored. */
export const nameKey = (s: string) => lc(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** Company-to-account matching, the same rule the Contacts screen uses. */
export const norm = (s: string) => lc(s).replace(/\b(inc|llc|co|corp|technologies|technology|group|the)\b/g, '');
export const isEmail = (s: string) => z.email().safeParse(s).success;

/** What every import returns. The preview returns the same, with applied: false. */
export interface ImportResult {
  applied: boolean;
  rows: number;
  /** Rows left out, by reason. */
  skipped: { reason: string; count: number }[];
  /** A few of the skipped rows, so the preview can show what was left out. */
  skippedExamples: string[];
  matchedByLink: number;
  matchedByEmail: number;
  matchedByName: number;
  updated: number;
  unchanged: number;
  added: number;
  linkedToAccount: number;
  updates: { contactId: string; name: string; fields: string[] }[];
  additions: { name: string; company: string; title: string }[];
}

export const emptyResult = (applied: boolean, rows: number): ImportResult => ({
  applied, rows, skipped: [], skippedExamples: [], matchedByLink: 0, matchedByEmail: 0, matchedByName: 0,
  updated: 0, unchanged: 0, added: 0, linkedToAccount: 0, updates: [], additions: [],
});

export interface Existing {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  nickname: string;
  title: string;
  company: string;
  accountId: string | null;
  emails: string[];
  website: string;
  notes: string;
  tags: string[];
  mobile: string;
  businessPhone: string;
  homePhone: string;
}

/** Every contact and account, with lookups by email, name and company. */
export async function loadIndex(client: pg.PoolClient) {
  const { rows } = await client.query(
    `SELECT id, name, first_name AS "firstName", last_name AS "lastName", nickname, title, company, account_id AS "accountId",
            emails, website, notes, tags, mobile, business_phone AS "businessPhone", home_phone AS "homePhone" FROM contacts`);
  const contacts = rows as Existing[];
  const { rows: accounts } = await client.query<{ id: string; name: string; aliases: string[] }>('SELECT id, name, aliases FROM accounts');
  const accountIdx = new Map<string, { id: string; name: string }>();
  for (const a of accounts) for (const n of [a.name, ...a.aliases]) if (norm(n) && !accountIdx.has(norm(n))) accountIdx.set(norm(n), a);
  const byEmail = new Map<string, Existing>();
  const byName = new Map<string, Existing[]>();
  for (const c of contacts) {
    for (const e of c.emails) byEmail.set(lc(e), c);
    const keys = new Set([c.name, `${c.firstName} ${c.lastName}`, `${c.nickname} ${c.lastName}`].map(nameKey).filter(Boolean));
    for (const k of keys) byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  return {
    contacts,
    accounts,
    byEmail,
    byName,
    /** The account a company name points to, or undefined. */
    accountFor: (company: string) => (company ? accountIdx.get(norm(company)) : undefined),
  };
}

/** Changes the given columns (snake_case) on one contact. */
export async function updateContact(client: pg.PoolClient, id: string, set: Record<string, unknown>) {
  const cols = Object.keys(set);
  if (!cols.length) return;
  await client.query(`UPDATE contacts SET ${cols.map((col, i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((col) => set[col])]);
}

/** Field names people see, for the preview's "fills in" column. */
export const fieldLabel = (col: string) =>
  ({ account_id: 'account', emails: 'email', website: 'LinkedIn link', business_phone: 'business phone', home_phone: 'home phone' })[col] ?? col;

/**
 * Runs an import inside one transaction. With apply false it rolls back, so the
 * preview is exactly what Import would do.
 */
export async function runImport(res: Response, apply: boolean, fn: (client: pg.PoolClient) => Promise<ImportResult>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    res.json({ data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
