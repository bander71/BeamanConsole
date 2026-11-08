-- Beaman Console: initial schema
--
-- Built from the data the legacy prototype (legacy/Beaman-Console.html) keeps
-- in browser storage. See db/README.md for how each prototype collection maps
-- to these tables.
--
-- Conventions
--   * Every table has a uuid primary key `id`.
--   * Tables imported from the prototype keep the old key in `legacy_id` so the
--     one-time import can resolve references.
--   * Money is numeric(12,2), hours numeric(6,2), miles numeric(8,1).
--   * Fixed lists (stages, types, categories) use CHECK constraints rather than
--     Postgres enums, so adding a value is a one-line migration.
--   * created_at / updated_at on every table; updated_at is kept by a trigger.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Staff of Beaman Consulting (sales reps on opportunities).
CREATE TABLE employees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id   text UNIQUE,
  first_name  text NOT NULL,
  last_name   text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  email       text,
  phone       text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_email_key ON employees (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- Anyone who logs time: employees and 1099 contractors.
CREATE TABLE resources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id    text UNIQUE,
  name         text NOT NULL,
  email        text NOT NULL DEFAULT '',
  phone        text NOT NULL DEFAULT '',
  address      text NOT NULL DEFAULT '',
  city         text NOT NULL DEFAULT '',
  state        text NOT NULL DEFAULT '',
  zip          text NOT NULL DEFAULT '',
  contractor   boolean NOT NULL DEFAULT false,   -- true = 1099 contractor
  employee_id  uuid REFERENCES employees (id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CRM: accounts, contacts, opportunities, activity log
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id      text UNIQUE,
  name           text NOT NULL,
  aliases        text[] NOT NULL DEFAULT '{}',   -- other names used in timesheets / trips
  type           text CHECK (type IN ('Client', 'Prospect', 'Partner', 'Vendor', 'Network', 'Community', 'Internal')),
  category       text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  website        text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  billing_attn   text NOT NULL DEFAULT '',
  billing_email  text NOT NULL DEFAULT '',
  keywords       text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  source         text NOT NULL DEFAULT '',
  follow_up      date,
  date_added     date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_name_key ON accounts (lower(name));
CREATE INDEX accounts_aliases_idx ON accounts USING gin (aliases);

CREATE TABLE contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id         text UNIQUE,
  account_id        uuid REFERENCES accounts (id) ON DELETE SET NULL,
  kind              text NOT NULL DEFAULT 'person',
  name              text NOT NULL DEFAULT '',     -- display name
  first_name        text NOT NULL DEFAULT '',
  last_name         text NOT NULL DEFAULT '',
  nickname          text NOT NULL DEFAULT '',
  title             text NOT NULL DEFAULT '',
  company           text NOT NULL DEFAULT '',     -- free text as entered; account_id is the resolved link
  emails            text[] NOT NULL DEFAULT '{}',
  mobile            text NOT NULL DEFAULT '',
  business_phone    text NOT NULL DEFAULT '',
  home_phone        text NOT NULL DEFAULT '',
  other_phone       text NOT NULL DEFAULT '',
  business_address  text NOT NULL DEFAULT '',
  home_address      text NOT NULL DEFAULT '',
  website           text NOT NULL DEFAULT '',
  birthday          text NOT NULL DEFAULT '',     -- often month/day only, so kept as text
  category          text NOT NULL DEFAULT '',
  relationship      text NOT NULL DEFAULT '',
  tags              text[] NOT NULL DEFAULT '{}',
  keywords          text NOT NULL DEFAULT '',
  notes             text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT '',
  follow_up         date,
  date_added        date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_account_idx ON contacts (account_id);
CREATE INDEX contacts_tags_idx ON contacts USING gin (tags);
CREATE INDEX contacts_emails_idx ON contacts USING gin (emails);

-- Projects are created when an opportunity is won (or directly in Setup).
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,            -- short ID shown in the UI, e.g. MCERP
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'T&M' CHECK (type IN ('T&M', 'Flat Fee')),
  account_id      uuid REFERENCES accounts (id) ON DELETE SET NULL,
  contract_value  numeric(12,2),                   -- fixed value for Flat Fee projects
  start_date      date,
  end_date        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX projects_account_idx ON projects (account_id);

CREATE TABLE opportunities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id     text UNIQUE,
  name          text NOT NULL,
  account_id    uuid REFERENCES accounts (id) ON DELETE SET NULL,
  rep_id        uuid REFERENCES employees (id) ON DELETE SET NULL,
  project_id    uuid REFERENCES projects (id) ON DELETE SET NULL,  -- set when converted
  stage         text NOT NULL DEFAULT 'Lead'
                CHECK (stage IN ('Lead', 'Qualified', 'Scoping', 'Proposal Sent', 'Verbally Committed', 'Won', 'Lost')),
  type          text NOT NULL DEFAULT 'T&M' CHECK (type IN ('T&M', 'Flat Fee')),
  value         numeric(12,2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  target_close  date,
  won_at        date,
  closed_at     date,                              -- date marked Lost
  description   text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES employees (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_account_idx ON opportunities (account_id);
CREATE INDEX opportunities_rep_idx ON opportunities (rep_id);
CREATE INDEX opportunities_stage_idx ON opportunities (stage);

CREATE TABLE opportunity_contacts (
  opportunity_id  uuid NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, contact_id)
);
CREATE INDEX opportunity_contacts_contact_idx ON opportunity_contacts (contact_id);

-- Notes / calls / meetings logged against a contact, account or opportunity.
-- (The prototype's `log` arrays on contacts and accounts, and `notes` on opportunities.)
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES contacts (id) ON DELETE CASCADE,
  account_id      uuid REFERENCES accounts (id) ON DELETE CASCADE,
  opportunity_id  uuid REFERENCES opportunities (id) ON DELETE CASCADE,
  activity_date   date NOT NULL,
  type            text NOT NULL DEFAULT 'Note' CHECK (type IN ('Note', 'Call', 'Meeting', 'Lunch', 'Email', 'Text')),
  body            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES employees (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(contact_id, account_id, opportunity_id) = 1)
);
CREATE INDEX activities_contact_idx ON activities (contact_id, activity_date DESC);
CREATE INDEX activities_account_idx ON activities (account_id, activity_date DESC);
CREATE INDEX activities_opportunity_idx ON activities (opportunity_id, activity_date DESC);

-- ---------------------------------------------------------------------------
-- Time: tasks, timesheets, entries
-- ---------------------------------------------------------------------------

-- A billable assignment: one resource on one project task, with its own rates.
-- (The prototype's `tasks`; taskId like 501 becomes task_number.)
CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number   integer NOT NULL UNIQUE,
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  resource_id   uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  name          text NOT NULL,
  type          text NOT NULL DEFAULT 'T&M' CHECK (type IN ('T&M', 'Flat Fee')),
  bill_rate     numeric(10,2) NOT NULL DEFAULT 0 CHECK (bill_rate >= 0),
  cost_rate     numeric(10,2) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),  -- prototype: rate1099
  budget_hours  numeric(8,2) NOT NULL DEFAULT 0 CHECK (budget_hours >= 0),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_project_idx ON tasks (project_id);
CREATE INDEX tasks_resource_idx ON tasks (resource_id);

-- One timesheet per resource per week (week starts Monday).
CREATE TABLE timesheets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id     text UNIQUE,
  resource_id   uuid NOT NULL REFERENCES resources (id) ON DELETE RESTRICT,
  week_start    date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid REFERENCES employees (id) ON DELETE SET NULL,
  return_note   text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, week_start)
);
CREATE INDEX timesheets_status_idx ON timesheets (status);

-- A row on the weekly grid: one task, with an optional note.
CREATE TABLE timesheet_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id  uuid NOT NULL REFERENCES timesheets (id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks (id) ON DELETE RESTRICT,
  note          text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (timesheet_id, task_id)
);

-- Hours for one day on one line. Only non-zero days are stored.
CREATE TABLE time_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_line_id  uuid NOT NULL REFERENCES timesheet_lines (id) ON DELETE CASCADE,
  work_date          date NOT NULL,
  hours              numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (timesheet_line_id, work_date)
);
CREATE INDEX time_entries_date_idx ON time_entries (work_date);

-- ---------------------------------------------------------------------------
-- Mileage
-- ---------------------------------------------------------------------------

CREATE TABLE vehicles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id        text UNIQUE,
  name             text NOT NULL,
  start_odometer   numeric(9,1),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- IRS mileage rates, effective from a date until the next row of the same kind.
CREATE TABLE mileage_rates (
  effective_date  date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('business', 'charitable')),
  rate_per_mile   numeric(6,3) NOT NULL CHECK (rate_per_mile >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, effective_date)
);

CREATE TABLE trips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id       text UNIQUE,
  trip_date       date NOT NULL,
  kind            text NOT NULL DEFAULT 'business' CHECK (kind IN ('business', 'charitable')),
  resource_id     uuid REFERENCES resources (id) ON DELETE SET NULL,
  vehicle_id      uuid REFERENCES vehicles (id) ON DELETE SET NULL,
  account_id      uuid REFERENCES accounts (id) ON DELETE SET NULL,
  client_name     text NOT NULL DEFAULT '',   -- as entered; account_id is the resolved link
  contact_id      uuid REFERENCES contacts (id) ON DELETE SET NULL,
  contact_name    text NOT NULL DEFAULT '',   -- as entered
  purpose         text NOT NULL DEFAULT '',
  route           text NOT NULL DEFAULT '',
  odometer_start  numeric(9,1),
  odometer_end    numeric(9,1),
  miles           numeric(8,1) NOT NULL CHECK (miles >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (odometer_end IS NULL OR odometer_start IS NULL OR odometer_end >= odometer_start)
);
CREATE INDEX trips_date_idx ON trips (trip_date);
CREATE INDEX trips_account_idx ON trips (account_id);
CREATE INDEX trips_vehicle_idx ON trips (vehicle_id, trip_date);

-- ---------------------------------------------------------------------------
-- Invoicing
-- ---------------------------------------------------------------------------

-- Single-row table: company details printed on invoices.
CREATE TABLE invoice_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  company        text NOT NULL DEFAULT '',
  tagline        text NOT NULL DEFAULT '',
  address        text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  website        text NOT NULL DEFAULT '',
  from_attn      text NOT NULL DEFAULT '',
  remit_to       text NOT NULL DEFAULT '',
  footer         text NOT NULL DEFAULT '',
  logo           text NOT NULL DEFAULT '',          -- image data URL or path
  number_prefix  text NOT NULL DEFAULT '',          -- invoice numbers: <prefix><year>-0001
  first_number   integer NOT NULL DEFAULT 1,
  terms_days     integer NOT NULL DEFAULT 30 CHECK (terms_days >= 0),
  tax_rate       numeric(6,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  period_anchor  date,                              -- start of a biweekly billing period
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE,
  account_id      uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'void')),
  bill_to_name    text NOT NULL DEFAULT '',
  bill_to_attn    text NOT NULL DEFAULT '',
  bill_to_email   text NOT NULL DEFAULT '',
  bill_to_address text NOT NULL DEFAULT '',
  cadence         text,                              -- e.g. 'biweekly', 'monthly'
  period_start    date,
  period_end      date,
  issue_date      date NOT NULL DEFAULT current_date,
  terms_days      integer NOT NULL DEFAULT 30 CHECK (terms_days >= 0),
  due_date        date GENERATED ALWAYS AS (issue_date + terms_days) STORED,
  tax_rate        numeric(6,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  memo            text NOT NULL DEFAULT '',
  sent_at         timestamptz,
  voided_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_account_idx ON invoices (account_id);
CREATE INDEX invoices_status_idx ON invoices (status, issue_date);

CREATE TABLE invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  line_no      integer NOT NULL,
  kind         text NOT NULL DEFAULT 'manual' CHECK (kind IN ('time', 'manual', 'expense', 'product')),
  task_id      uuid REFERENCES tasks (id) ON DELETE SET NULL,   -- for kind = 'time'
  description  text NOT NULL DEFAULT '',
  quantity     numeric(10,2) NOT NULL DEFAULT 1,
  rate         numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  taxable      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_no)
);

-- Which time entries a time line bills. A time entry can be billed only once.
CREATE TABLE invoice_line_time_entries (
  invoice_line_id  uuid NOT NULL REFERENCES invoice_lines (id) ON DELETE CASCADE,
  time_entry_id    uuid NOT NULL UNIQUE REFERENCES time_entries (id) ON DELETE RESTRICT,
  hours            numeric(5,2) NOT NULL,            -- snapshot at billing time
  PRIMARY KEY (invoice_line_id, time_entry_id)
);

CREATE TABLE invoice_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  payment_date  date NOT NULL,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  method        text NOT NULL DEFAULT 'ACH' CHECK (method IN ('ACH', 'Check', 'Card', 'Wire', 'Cash', 'Other')),
  reference     text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_payments_invoice_idx ON invoice_payments (invoice_id);
CREATE INDEX invoice_payments_date_idx ON invoice_payments (payment_date);

-- ---------------------------------------------------------------------------
-- Accounting: manual income / expense entries
-- (Invoice payments are income too; reports combine both, as the prototype does.)
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id    text UNIQUE,
  entry_date   date NOT NULL,
  type         text NOT NULL CHECK (type IN ('income', 'expense')),
  category     text NOT NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  payee        text NOT NULL DEFAULT '',
  resource_id  uuid REFERENCES resources (id) ON DELETE SET NULL,   -- contractor paid
  account_id   uuid REFERENCES accounts (id) ON DELETE SET NULL,
  method       text NOT NULL DEFAULT 'ACH' CHECK (method IN ('ACH', 'Check', 'Card', 'Wire', 'Cash', 'Other')),
  memo         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (type = 'expense' AND category IN (
      'Contractors (1099)', 'Software & subscriptions', 'Travel', 'Meals', 'Vehicle & fuel',
      'Office & supplies', 'Insurance', 'Professional fees', 'Marketing', 'Equipment',
      'Taxes & licenses', 'Bank & payment fees', 'Other expense'))
    OR
    (type = 'income' AND category IN (
      'Consulting revenue (outside invoices)', 'Reimbursements', 'Interest', 'Other income'))
  ),
  CHECK (category <> 'Contractors (1099)' OR resource_id IS NOT NULL)
);
CREATE INDEX ledger_entries_date_idx ON ledger_entries (entry_date);
CREATE INDEX ledger_entries_resource_idx ON ledger_entries (resource_id);

-- ---------------------------------------------------------------------------
-- Views used by reports
-- ---------------------------------------------------------------------------

-- Every hour logged, with task, project, account and rates attached.
CREATE VIEW time_detail AS
SELECT
  te.id            AS time_entry_id,
  te.work_date,
  te.hours,
  ts.id            AS timesheet_id,
  ts.status        AS timesheet_status,
  r.id             AS resource_id,
  r.name           AS resource_name,
  r.contractor,
  t.id             AS task_id,
  t.task_number,
  t.name           AS task_name,
  t.type           AS task_type,
  t.bill_rate,
  t.cost_rate,
  p.id             AS project_id,
  p.code           AS project_code,
  p.account_id,
  tl.note,
  (ilte.time_entry_id IS NOT NULL) AS billed
FROM time_entries te
JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
JOIN timesheets ts      ON ts.id = tl.timesheet_id
JOIN tasks t            ON t.id = tl.task_id
JOIN projects p         ON p.id = t.project_id
JOIN resources r        ON r.id = ts.resource_id
LEFT JOIN invoice_line_time_entries ilte ON ilte.time_entry_id = te.id;

-- Invoice totals and balance due.
CREATE VIEW invoice_totals AS
SELECT
  i.id AS invoice_id,
  i.number,
  i.status,
  coalesce(l.subtotal, 0)                                         AS subtotal,
  round(coalesce(l.taxable, 0) * i.tax_rate, 2)                   AS tax,
  coalesce(l.subtotal, 0) + round(coalesce(l.taxable, 0) * i.tax_rate, 2) AS total,
  coalesce(pm.paid, 0)                                            AS paid,
  coalesce(l.subtotal, 0) + round(coalesce(l.taxable, 0) * i.tax_rate, 2) - coalesce(pm.paid, 0) AS balance
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, sum(amount) AS subtotal, sum(amount) FILTER (WHERE taxable) AS taxable
  FROM invoice_lines GROUP BY invoice_id
) l ON l.invoice_id = i.id
LEFT JOIN (
  SELECT invoice_id, sum(amount) AS paid FROM invoice_payments GROUP BY invoice_id
) pm ON pm.invoice_id = i.id;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'updated_at'
      AND table_name IN (SELECT table_name FROM information_schema.tables
                         WHERE table_schema = current_schema() AND table_type = 'BASE TABLE')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END;
$$;

COMMIT;
