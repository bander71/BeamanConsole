// Outlook import: merge contacts exported from Outlook into Contacts.
//
// POST /contacts/import/outlook   { rows: [...], ownEmails?: [...], includeAutomated?: false, apply?: false }
//
// The app reads the file (an .xlsx contact list or Outlook's own CSV export) and
// sends one row per entry: name, email addresses, company, title and phones.
//
// - Your own addresses (ownEmails, plus employees' emails and names) are skipped.
// - Automated senders and shared inboxes (no-reply, notifications, support@,
//   billing@, ap@, newsletters…) are skipped unless includeAutomated is true.
// - Rows with the same name are one person, with all their addresses.
// - People already in Contacts are matched by email, then by a single contact with
//   that name; they only get blanks filled in and an "Outlook" tag.
// - Everyone else is added with source "Outlook". When there's no company, a work
//   email domain links them to an account when most contacts at that domain (at
//   least two, and three quarters or more) belong to it.
//
// The preview (apply: false) runs the same steps and rolls them back.

import { Router } from 'express';
import { z } from 'zod';
import { emptyResult, fieldLabel, isEmail, lc, loadIndex, nameKey, runImport, updateContact, type Existing } from '../importHelpers.ts';

export const outlookImportRoutes = Router();

const str = (max: number) => z.string().trim().max(max).default('');
const rowSchema = z.object({
  name: str(300),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  company: str(300),
  title: str(300),
  mobile: str(200),
  businessPhone: str(200),
  homePhone: str(200),
  signaturePhones: str(1000),
});
const body = z.strictObject({
  rows: z.array(rowSchema).max(30_000),
  ownEmails: z.array(z.string().trim().max(320)).max(200).default([]),
  includeAutomated: z.boolean().default(false),
  apply: z.boolean().default(false),
});
type Row = z.infer<typeof rowSchema>;
const TAG = 'Outlook';

// Automated senders and shared inboxes, by the part before the @…
const AUTO_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|notice|alerts?|info|news(letter)?|marketing|webinars?|system|registration|ship|security|automation|mailer(-daemon)?|bounces?|updates?|hello|team|support|help|billing|invoices?|receipts?|accounts?|admin|service(desk)?|feedback|events?|digest|reply|postmaster|calendar|orders?|sales|contact|social|ap|ar)([-_.+].*)?$/i;
const AUTO_LOCAL_ANYWHERE = /no-?reply|notif|alert|reminder|invite|productinfo|replies|verify|errors|feedback|statements|automation/i;
// …by the sending domain (bulk-mail subdomains like mail.example.com)…
const AUTO_DOMAIN = /(^|\.)(mail|e|info|email|updates|em|em\d+|m|news|notify)\.[a-z0-9-]+\.[a-z]+$|shippingalerts|notificationhandler/i;
// …and by the display name.
const AUTO_NAME = /\bvia\b|no-?reply|notification|newsletter|team$|support$/i;
const isAutomated = (email: string) => {
  const [local = '', domain = ''] = lc(email).split('@');
  return AUTO_LOCAL.test(local) || AUTO_LOCAL_ANYWHERE.test(local) || AUTO_DOMAIN.test(domain);
};
// Personal mail services: their domains say nothing about someone's company.
const PUBLIC =
  /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|att|sbcglobal|everestkc|kc\.rr|swbell|cox|charter|verizon|proton(mail)?|gmx)\.(com|net|org)$/i;
const domainOf = (email: string) => lc(email.split('@')[1]);

/** "Daniel Hinchman (ScanForce)" -> "Daniel Hinchman" */
const plainName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();
/** The "Direct:" number from an email signature, or its first number. */
const signatureNumber = (s: string) => {
  const m = /direct:\s*([^;]+)/i.exec(s) ?? /(?:^|;|:)\s*([+()\d][\d\s().+-]{6,})/.exec(s);
  return m ? m[1]!.trim().slice(0, 50) : '';
};
const clip = (s: string, n: number) => s.slice(0, n);

outlookImportRoutes.post('/contacts/import/outlook', async (req, res) => {
  const { rows, ownEmails, includeAutomated, apply } = body.parse(req.body ?? {});
  await runImport(res, apply, async (client) => {
    const { contacts, byEmail, byName, accountFor, accounts } = await loadIndex(client);
    const r = emptyResult(apply, rows.length);
    const skip = new Map<string, number>();
    const skipRow = (reason: string, row: Row) => {
      skip.set(reason, (skip.get(reason) ?? 0) + 1);
      if (r.skippedExamples.length < 300) r.skippedExamples.push(`${row.name || '(no name)'}${row.emails.length ? ` <${row.emails.join(', ')}>` : ''} · ${reason}`);
    };

    // You and your team.
    const { rows: team } = await client.query<{ name: string; email: string | null }>(
      `SELECT trim(first_name || ' ' || last_name) AS name, email FROM employees`);
    const own = new Set([...ownEmails, ...team.map((t) => t.email ?? '')].map(lc).filter(Boolean));
    const ownNames = new Set(team.map((t) => nameKey(t.name)).filter(Boolean));

    // Work email domain -> how many contacts at that domain belong to each account.
    const domainAccounts = new Map<string, Map<string, number>>();
    const noteDomain = (email: string, accountId: string) => {
      const d = domainOf(email);
      if (!d || PUBLIC.test(d)) return;
      const votes = domainAccounts.get(d) ?? new Map<string, number>();
      votes.set(accountId, (votes.get(accountId) ?? 0) + 1);
      domainAccounts.set(d, votes);
    };
    for (const c of contacts) if (c.accountId) for (const e of c.emails) noteDomain(e, c.accountId);

    // Keep people: drop own addresses and (unless asked) automated ones; join rows by name.
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const emails = [...new Set(row.emails.filter(isEmail).map((e) => e.trim()))];
      if (emails.some((e) => own.has(lc(e))) || (row.name && ownNames.has(nameKey(plainName(row.name))))) {
        skipRow('your own address', row);
        continue;
      }
      if (!row.name && !emails.length) {
        skipRow('no name or email', row);
        continue;
      }
      const kept = includeAutomated ? emails : emails.filter((e) => !isAutomated(e));
      if (!includeAutomated && ((emails.length && !kept.length) || AUTO_NAME.test(row.name))) {
        skipRow('automated sender or shared inbox', row);
        continue;
      }
      const key = row.name ? 'n:' + nameKey(plainName(row.name)) : 'e:' + lc(kept[0]);
      groups.set(key, [...(groups.get(key) ?? []), { ...row, emails: kept }]);
    }
    // Companies named in the file teach the domain map too (so colleagues without a company still link).
    for (const rs of groups.values()) {
      const a = accountFor(rs.map((x) => x.company).find(Boolean) ?? '');
      if (a) for (const x of rs) for (const e of x.emails) noteDomain(e, a.id);
    }
    const accountByDomain = (emails: string[]) => {
      for (const e of emails) {
        const votes = [...(domainAccounts.get(domainOf(e)) ?? [])].sort((x, y) => y[1] - x[1]);
        const total = votes.reduce((n, [, v]) => n + v, 0);
        const [top] = votes;
        // One account clearly owns the domain (a stray contact with an old address doesn't count against it).
        if (top && (total === 1 || (top[1] >= 2 && top[1] >= total * 0.75))) return accounts.find((a) => a.id === top[0]);
      }
      return undefined;
    };

    const used = new Set<string>();
    const free = (c: Existing | undefined) => (c && !used.has(c.id) ? c : undefined);
    for (const rs of groups.values()) {
      const first = (k: keyof Row) => (rs.map((x) => x[k]).find((v) => typeof v === 'string' && v) as string | undefined) ?? '';
      const emails = [...new Set(rs.flatMap((x) => x.emails))];
      const rawName = first('name');
      const name = clip(rawName || emails[0] || '', 200);
      const company = clip(first('company'), 200);
      const title = clip(first('title'), 200);
      const signature = [...new Set(rs.map((x) => x.signaturePhones).filter(Boolean))].join('; ');
      const phones = {
        mobile: clip(first('mobile'), 50),
        business_phone: clip(first('businessPhone'), 50) || signatureNumber(signature),
        home_phone: clip(first('homePhone'), 50),
      };
      const account = company ? accountFor(company) : accountByDomain(emails);

      let c = emails.map((e) => free(byEmail.get(lc(e)))).find(Boolean);
      if (c) r.matchedByEmail++;
      else if (rawName) {
        const same = (byName.get(nameKey(plainName(rawName))) ?? []).filter((x) => !used.has(x.id));
        if (same.length === 1) {
          c = same[0];
          r.matchedByName++;
        }
      }

      if (c) {
        used.add(c.id);
        const set: Record<string, unknown> = {};
        if (!c.title && title) set.title = title;
        if (!c.company && (company || account)) {
          set.company = company || account!.name;
          if (!c.accountId && account) set.account_id = account.id;
        }
        const extra = emails.filter((e) => !c.emails.some((x) => lc(x) === lc(e)));
        if (extra.length) set.emails = [...c.emails, ...extra];
        if (!c.mobile && phones.mobile) set.mobile = phones.mobile;
        if (!c.businessPhone && phones.business_phone) set.business_phone = phones.business_phone;
        if (!c.homePhone && phones.home_phone) set.home_phone = phones.home_phone;
        const fields = Object.keys(set).map(fieldLabel);
        if (!c.tags.includes(TAG)) set.tags = [...c.tags, TAG];
        if (fields.length) {
          r.updated++;
          r.updates.push({ contactId: c.id, name: c.name || `${c.firstName} ${c.lastName}`.trim(), fields });
        } else r.unchanged++;
        if (set.account_id) r.linkedToAccount++;
        await updateContact(client, c.id, set);
      } else {
        const parts = rawName ? plainName(rawName).split(/\s+/) : [];
        if (account) r.linkedToAccount++;
        r.added++;
        r.additions.push({ name, company: company || account?.name || '', title });
        await client.query(
          `INSERT INTO contacts (kind, name, first_name, last_name, company, title, emails, mobile, business_phone, home_phone, notes, source, tags, account_id)
           VALUES ('person', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            name, clip(parts[0] ?? '', 100), clip(parts.slice(1).join(' '), 100), company || account?.name || '', title, emails,
            phones.mobile, phones.business_phone, phones.home_phone,
            signature && signature !== phones.business_phone ? `Phones from email signatures: ${signature}` : '',
            TAG, [TAG], account?.id ?? null,
          ],
        );
      }
    }
    r.skipped = [...skip].map(([reason, count]) => ({ reason, count }));
    return r;
  });
});
