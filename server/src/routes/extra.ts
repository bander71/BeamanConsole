// Endpoints that don't fit the standard CRUD shape.

import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../db.ts';
import { notFound } from '../errors.ts';
import { TRIP_KINDS } from '../resources.ts';

export const extraRoutes = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Opportunity contacts ----------------------------------------------------
// GET /opportunities/:id/contacts       -> contacts on the opportunity
// PUT /opportunities/:id/contacts       -> replace the list: { contactIds: [...] }

async function requireOpportunity(id: string) {
  if (!UUID.test(id)) throw notFound('Opportunity');
  const [opp] = await query('SELECT id FROM opportunities WHERE id = $1', [id]);
  if (!opp) throw notFound('Opportunity');
}

const listOppContacts = (id: string) =>
  query(
    `SELECT c.* FROM opportunity_contacts oc JOIN contacts c ON c.id = oc.contact_id
     WHERE oc.opportunity_id = $1 ORDER BY lower(c.last_name), lower(c.first_name)`,
    [id],
  );

extraRoutes.get('/opportunities/:id/contacts', async (req, res) => {
  await requireOpportunity(req.params.id);
  res.json({ data: await listOppContacts(req.params.id) });
});

extraRoutes.put('/opportunities/:id/contacts', async (req, res) => {
  const { contactIds } = z.strictObject({ contactIds: z.array(z.uuid()).max(200) }).parse(req.body ?? {});
  await requireOpportunity(req.params.id);
  await transaction(async (client) => {
    await client.query('DELETE FROM opportunity_contacts WHERE opportunity_id = $1', [req.params.id]);
    if (contactIds.length) {
      await client.query(
        `INSERT INTO opportunity_contacts (opportunity_id, contact_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [req.params.id, contactIds],
      );
    }
  });
  res.json({ data: await listOppContacts(req.params.id) });
});

// ---- Mileage rates -------------------------------------------------------------
// GET    /mileage-rates                       -> all rates, newest first
// GET    /mileage-rates/lookup?date=&kind=    -> the rate in effect on a date
// PUT    /mileage-rates/:kind/:effectiveDate  -> set a rate { ratePerMile }
// DELETE /mileage-rates/:kind/:effectiveDate

const rateKey = z.object({ kind: z.enum(TRIP_KINDS), effectiveDate: z.iso.date() });

extraRoutes.get('/mileage-rates', async (_req, res) => {
  res.json({ data: await query('SELECT * FROM mileage_rates ORDER BY effective_date DESC, kind') });
});

extraRoutes.get('/mileage-rates/lookup', async (req, res) => {
  const { date, kind } = z.object({ date: z.iso.date(), kind: z.enum(TRIP_KINDS) }).parse(req.query);
  const [row] = await query(
    'SELECT * FROM mileage_rates WHERE kind = $1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1',
    [kind, date],
  );
  if (!row) throw notFound('Mileage rate');
  res.json({ data: row });
});

extraRoutes.put('/mileage-rates/:kind/:effectiveDate', async (req, res) => {
  const { kind, effectiveDate } = rateKey.parse(req.params);
  const { ratePerMile } = z.strictObject({ ratePerMile: z.number().min(0).max(99) }).parse(req.body ?? {});
  const [row] = await query(
    `INSERT INTO mileage_rates (kind, effective_date, rate_per_mile) VALUES ($1, $2, $3)
     ON CONFLICT (kind, effective_date) DO UPDATE SET rate_per_mile = EXCLUDED.rate_per_mile
     RETURNING *`,
    [kind, effectiveDate, ratePerMile],
  );
  res.json({ data: row });
});

extraRoutes.delete('/mileage-rates/:kind/:effectiveDate', async (req, res) => {
  const { kind, effectiveDate } = rateKey.parse(req.params);
  const [row] = await query(
    'DELETE FROM mileage_rates WHERE kind = $1 AND effective_date = $2 RETURNING kind',
    [kind, effectiveDate],
  );
  if (!row) throw notFound('Mileage rate');
  res.status(204).end();
});

// ---- Invoice settings (single record) ------------------------------------------
// GET /settings/invoicing
// PUT /settings/invoicing   -> update any fields

const settingsFields = z.strictObject({
  company: z.string().max(200),
  tagline: z.string().max(200),
  address: z.string().max(500),
  phone: z.string().max(50),
  email: z.string().max(320),
  website: z.string().max(500),
  fromAttn: z.string().max(200),
  remitTo: z.string().max(1000),
  footer: z.string().max(2000),
  logo: z.string().max(2_000_000),
  numberPrefix: z.string().max(20),
  firstNumber: z.number().int().min(1),
  termsDays: z.number().int().min(0).max(365),
  taxRate: z.number().min(0).max(1),
  periodAnchor: z.iso.date().nullable(),
}).partial();

const SETTINGS_COLUMNS: Record<string, string> = {
  company: 'company', tagline: 'tagline', address: 'address', phone: 'phone', email: 'email',
  website: 'website', fromAttn: 'from_attn', remitTo: 'remit_to', footer: 'footer', logo: 'logo',
  numberPrefix: 'number_prefix', firstNumber: 'first_number', termsDays: 'terms_days',
  taxRate: 'tax_rate', periodAnchor: 'period_anchor',
};

export async function getSettings() {
  const [row] = await query('SELECT * FROM invoice_settings WHERE id');
  if (row) return row;
  const [created] = await query('INSERT INTO invoice_settings DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING *');
  return created ?? (await query('SELECT * FROM invoice_settings WHERE id'))[0];
}

const publicSettings = (row: Record<string, unknown> | undefined) => {
  if (!row) return row;
  const { id: _id, ...rest } = row;
  return rest;
};

extraRoutes.get('/settings/invoicing', async (_req, res) => {
  res.json({ data: publicSettings(await getSettings()) });
});

extraRoutes.put('/settings/invoicing', async (req, res) => {
  const body = settingsFields.parse(req.body ?? {});
  await getSettings();
  const keys = Object.keys(body);
  if (!keys.length) return void res.json({ data: publicSettings(await getSettings()) });
  const sets = keys.map((k, i) => `${SETTINGS_COLUMNS[k]} = $${i + 1}`);
  const [row] = await query(
    `UPDATE invoice_settings SET ${sets.join(', ')} WHERE id RETURNING *`,
    keys.map((k) => body[k as keyof typeof body]),
  );
  res.json({ data: publicSettings(row) });
});
