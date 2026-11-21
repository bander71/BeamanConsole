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
import { emptyResult, fieldLabel, isEmail, lc, loadIndex, nameKey, runImport, updateContact, type Existing } from '../importHelpers.ts';

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

/** linkedin.com/in/jane-doe, without protocol, www or trailing slash. */
const profileKey = (url: string) => lc(url).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

contactImportRoutes.post('/contacts/import/linkedin', async (req, res) => {
  const { rows, apply } = body.parse(req.body ?? {});
  await runImport(res, apply, async (client) => {
    const { contacts, byEmail, byName, accountFor } = await loadIndex(client);
    const byLink = (url: string) => {
      const k = profileKey(url);
      return k ? contacts.find((c) => lc(c.website).includes(k) || lc(c.notes).includes(k)) : undefined;
    };

    const r = emptyResult(apply, rows.length);
    let noName = 0;
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
        noName++;
        if (r.skippedExamples.length < 200) r.skippedExamples.push(row.url || '(no name or link)');
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
          const a = c.accountId ? undefined : accountFor(row.company);
          if (a) set.account_id = a.id;
        }
        if (email && !c.emails.some((e) => lc(e) === lc(email))) set.emails = [...c.emails, email];
        const k = profileKey(row.url);
        if (k && !lc(c.website).includes(k) && !lc(c.notes).includes(k)) {
          if (!c.website) set.website = row.url;
          else set.notes = [c.notes, `LinkedIn: ${row.url}`].filter(Boolean).join('\n');
        }
        const fields = Object.keys(set).map(fieldLabel);
        if (!c.tags.includes(TAG)) set.tags = [...c.tags, TAG];
        if (fields.length) {
          r.updated++;
          r.updates.push({ contactId: c.id, name: c.name || `${c.firstName} ${c.lastName}`.trim(), fields });
        } else r.unchanged++;
        if (set.account_id) r.linkedToAccount++;
        await updateContact(client, c.id, set);
      } else {
        const accountId = accountFor(row.company)?.id ?? null;
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
    if (noName) r.skipped.push({ reason: 'LinkedIn hid their name', count: noName });
    return r;
  });
});
