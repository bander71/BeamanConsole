// LinkedIn import: merge a Connections export into Contacts.
//
// POST /contacts/import/linkedin   { rows: [...], apply?: false }
//
// Each connection is matched to an existing contact by LinkedIn profile link
// (in the website or notes), then by email, then by name. A matched contact only
// gets blanks filled in (title, company and its account, email, profile link) and
// a "LinkedIn" tag; nothing already there is overwritten. Connections with no
// match become new contacts with source "LinkedIn". Connections with no name
// (LinkedIn hides some) are skipped.
//
// The preview (apply: false) runs exactly the same steps and then rolls them back,
// so it always says what Import will do.

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.ts';

export const contactImportRoutes = Router();

const str = (max: number) => z.string().trim().max(max).default('');
const rowSchema = z.object({
  firstName: str(100),
  lastName: str(100),
  url: str(500),
  email: str(320),
  company: str(200),
  position: str(200),
  connectedOn: z.iso.date().nullable().default(null),
});
const body = z.strictObject({
  rows: z.array(rowSchema).max(30_000),
  apply: z.boolean().default(false),
});

type Row = z.infer<typeof rowSchema>;
const TAG = 'LinkedIn';

const lc = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
/** Name key: case, accents, spaces and punctuation ignored. */
const nameKey = (s: string) => lc(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** Company-to-account matching, the same rule the Contacts screen uses. */
const norm = (s: string) => lc(s).replace(/\b(inc|llc|co|corp|technologies|technology|group|the)\b/g, '');
/** linkedin.com/in/jane-doe, without protocol, www or trailing slash. */
const profileKey = (url: string) => lc(url).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const isEmail = (s: string) => z.email().safeParse(s).success;

interface Existing {
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
}

export interface ImportResult {
  applied: boolean;
  connections: number;
  skippedNoName: number;
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

contactImportRoutes.post('/contacts/import/linkedin', async (req, res) => {
  const { rows, apply } = body.parse(req.body ?? {});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await merge(client, rows, apply);
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    res.json({ data: result });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

async function merge(client: import('pg').PoolClient, rows: Row[], apply: boolean): Promise<ImportResult> {
  const { rows: contactRows } = await client.query(
    `SELECT id, name, first_name AS "firstName", last_name AS "lastName", nickname, title, company, account_id AS "accountId",
            emails, website, notes, tags FROM contacts`);
  const contacts = contactRows as Existing[];
  const { rows: accounts } = await client.query('SELECT id, name, aliases FROM accounts');
  const accountIdx = new Map<string, string>();
  for (const a of accounts) for (const n of [a.name, ...a.aliases]) if (norm(n) && !accountIdx.has(norm(n))) accountIdx.set(norm(n), a.id);
  const accountFor = (company: string) => (company ? (accountIdx.get(norm(company)) ?? null) : null);

  const byEmail = new Map<string, Existing>();
  const byName = new Map<string, Existing[]>();
  for (const c of contacts) {
    for (const e of c.emails) byEmail.set(lc(e), c);
    const keys = new Set([c.name, `${c.firstName} ${c.lastName}`, `${c.nickname} ${c.lastName}`].map(nameKey).filter(Boolean));
    for (const k of keys) byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const byLink = (url: string) => {
    const k = profileKey(url);
    return k ? contacts.find((c) => lc(c.website).includes(k) || lc(c.notes).includes(k)) : undefined;
  };

  const r: ImportResult = {
    applied: apply, connections: rows.length, skippedNoName: 0, matchedByLink: 0, matchedByEmail: 0, matchedByName: 0,
    updated: 0, unchanged: 0, added: 0, linkedToAccount: 0, updates: [], additions: [],
  };
  const used = new Set<string>(); // a contact matches one connection at most
  const free = (c: Existing | undefined) => (c && !used.has(c.id) ? c : undefined);

  // Profile links are the surest match, so they claim their contacts first.
  const linked = new Map<Row, Existing>();
  for (const row of rows) {
    const c = `${row.firstName}${row.lastName}`.trim() && row.url ? free(byLink(row.url)) : undefined;
    if (c) {
      linked.set(row, c);
      used.add(c.id);
    }
  }

  for (const row of rows) {
    const name = `${row.firstName} ${row.lastName}`.trim();
    if (!name) {
      r.skippedNoName++;
      continue;
    }
    const email = isEmail(row.email) ? row.email : '';

    let c = linked.get(row);
    if (c) r.matchedByLink++;
    else if ((c = free(email ? byEmail.get(lc(email)) : undefined))) r.matchedByEmail++;
    else {
      // Only a single, unused contact with that name counts as a match.
      const same = (byName.get(nameKey(name)) ?? []).filter((x) => !used.has(x.id));
      if (same.length === 1) {
        c = same[0];
        r.matchedByName++;
      }
    }

    if (c) {
      used.add(c.id);
      const set: Record<string, unknown> = {};
      if (!c.title && row.position) set.title = row.position;
      if (!c.company && row.company) {
        set.company = row.company;
        const a = c.accountId ? null : accountFor(row.company);
        if (a) set.account_id = a;
      }
      if (email && !c.emails.some((e) => lc(e) === lc(email))) set.emails = [...c.emails, email];
      const k = profileKey(row.url);
      if (k && !lc(c.website).includes(k) && !lc(c.notes).includes(k)) {
        if (!c.website) set.website = row.url;
        else set.notes = [c.notes, `LinkedIn: ${row.url}`].filter(Boolean).join('\n');
      }
      const fields = Object.keys(set).map((f) => (f === 'account_id' ? 'account' : f === 'emails' ? 'email' : f === 'website' ? 'LinkedIn link' : f));
      if (!c.tags.includes(TAG)) set.tags = [...c.tags, TAG];
      if (fields.length) {
        r.updated++;
        r.updates.push({ contactId: c.id, name: c.name || `${c.firstName} ${c.lastName}`.trim(), fields });
      } else r.unchanged++;
      if (set.account_id) r.linkedToAccount++;
      const cols = Object.keys(set);
      if (cols.length) {
        await client.query(`UPDATE contacts SET ${cols.map((col, i) => `${col} = $${i + 2}`).join(', ')} WHERE id = $1`, [c.id, ...cols.map((col) => set[col])]);
      }
    } else {
      const accountId = accountFor(row.company);
      if (accountId) r.linkedToAccount++;
      r.added++;
      r.additions.push({ name, company: row.company, title: row.position });
      await client.query(
        `INSERT INTO contacts (kind, name, first_name, last_name, company, title, emails, website, source, tags, date_added, account_id)
         VALUES ('person', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [name, row.firstName, row.lastName, row.company, row.position, email ? [email] : [], row.url, TAG, [TAG], row.connectedOn, accountId],
      );
    }
  }
  return r;
}
