-- Smoke test for the schema. Runs inside a transaction and rolls back,
-- so it leaves the database unchanged.
--
--   psql -d beaman_console_dev -v ON_ERROR_STOP=1 -f db/tests/smoke_test.sql

\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;

-- Expect a statement to fail with a given SQLSTATE.
CREATE FUNCTION pg_temp.expect_error(stmt text, code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE EXCEPTION 'expected % but statement succeeded: %', code, stmt;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> code THEN
    RAISE EXCEPTION 'expected % but got % (%) for: %', code, SQLSTATE, SQLERRM, stmt;
  END IF;
END;
$$;

-- Happy path: account -> project -> task -> timesheet -> invoice -> payment
INSERT INTO employees (id, first_name, last_name, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test', 'Rep', 'rep@example.com');
INSERT INTO resources (id, name, contractor) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Test Contractor', true);
INSERT INTO accounts (id, name, aliases, type) VALUES
  ('00000000-0000-0000-0000-000000000003', 'Acme Corp', '{"Acme"}', 'Client');
INSERT INTO projects (id, code, name, account_id) VALUES
  ('00000000-0000-0000-0000-000000000004', 'ACME1', 'Acme Rollout', '00000000-0000-0000-0000-000000000003');
INSERT INTO tasks (id, task_number, project_id, resource_id, name, bill_rate, cost_rate, budget_hours) VALUES
  ('00000000-0000-0000-0000-000000000005', 901, '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000002', 'Build', 150, 90, 40);
INSERT INTO timesheets (id, resource_id, week_start, status) VALUES
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '2026-11-02', 'approved');
INSERT INTO timesheet_lines (id, timesheet_id, task_id) VALUES
  ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005');
INSERT INTO time_entries (id, timesheet_line_id, work_date, hours) VALUES
  ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000007', '2026-11-02', 6),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000007', '2026-11-03', 4);

INSERT INTO invoices (id, number, account_id, issue_date, terms_days, tax_rate) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'BC2026-0001', '00000000-0000-0000-0000-000000000003', '2026-11-07', 30, 0.08);
INSERT INTO invoice_lines (id, invoice_id, line_no, kind, task_id, description, quantity, rate, amount, taxable) VALUES
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 1, 'time',
   '00000000-0000-0000-0000-000000000005', 'Build - Test Contractor', 10, 150, 1500, false),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 2, 'product',
   NULL, 'License', 1, 100, 100, true);
INSERT INTO invoice_line_time_entries (invoice_line_id, time_entry_id, hours) VALUES
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000008', 6),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000009', 4);
INSERT INTO invoice_payments (invoice_id, payment_date, amount, method) VALUES
  ('00000000-0000-0000-0000-00000000000a', '2026-11-20', 1000, 'ACH');

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM invoice_totals WHERE number = 'BC2026-0001';
  ASSERT r.subtotal = 1600, format('subtotal %s', r.subtotal);
  ASSERT r.tax = 8.00,      format('tax %s', r.tax);
  ASSERT r.total = 1608.00, format('total %s', r.total);
  ASSERT r.balance = 608.00, format('balance %s', r.balance);
  ASSERT (SELECT due_date FROM invoices WHERE number = 'BC2026-0001') = '2026-12-07', 'due date';
  ASSERT (SELECT count(*) FROM time_detail WHERE billed) = 2, 'billed entries';
  ASSERT (SELECT sum(hours) FROM time_detail WHERE project_code = 'ACME1') = 10, 'hours';
END;
$$;

-- updated_at trigger
UPDATE accounts SET updated_at = '2000-01-01' WHERE name = 'Acme Corp';
DO $$ BEGIN
  ASSERT (SELECT updated_at > '2001-01-01' FROM accounts WHERE name = 'Acme Corp'), 'updated_at trigger';
END $$;

-- Rules that must reject bad data
SELECT FROM pg_temp.expect_error($$INSERT INTO accounts (name) VALUES ('ACME CORP')$$, '23505');                -- duplicate name, any case
SELECT FROM pg_temp.expect_error($$INSERT INTO accounts (name, type) VALUES ('X', 'Customer')$$, '23514');       -- unknown type
SELECT FROM pg_temp.expect_error($$INSERT INTO opportunities (name, stage) VALUES ('X', 'Maybe')$$, '23514');    -- unknown stage
SELECT FROM pg_temp.expect_error($$INSERT INTO timesheets (resource_id, week_start)
  VALUES ('00000000-0000-0000-0000-000000000002', '2026-11-04')$$, '23514');                                -- week must start Monday
SELECT FROM pg_temp.expect_error($$INSERT INTO timesheets (resource_id, week_start)
  VALUES ('00000000-0000-0000-0000-000000000002', '2026-11-02')$$, '23505');                                -- one sheet per week
SELECT FROM pg_temp.expect_error($$INSERT INTO time_entries (timesheet_line_id, work_date, hours)
  VALUES ('00000000-0000-0000-0000-000000000007', '2026-11-04', 25)$$, '23514');                            -- > 24 hours
SELECT FROM pg_temp.expect_error($$INSERT INTO invoice_lines (id, invoice_id, line_no) VALUES
  ('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-00000000000a', 3);
  INSERT INTO invoice_line_time_entries VALUES
  ('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000008', 6)$$, '23505');          -- billed twice
SELECT FROM pg_temp.expect_error($$INSERT INTO ledger_entries (entry_date, type, category, amount)
  VALUES ('2026-11-07', 'expense', 'Contractors (1099)', 500)$$, '23514');                                  -- 1099 needs a contractor
SELECT FROM pg_temp.expect_error($$INSERT INTO ledger_entries (entry_date, type, category, amount)
  VALUES ('2026-11-07', 'income', 'Travel', 500)$$, '23514');                                               -- expense category on income
SELECT FROM pg_temp.expect_error($$INSERT INTO activities (activity_date, body) VALUES ('2026-11-07', 'orphan')$$, '23514'); -- needs a parent
SELECT FROM pg_temp.expect_error($$DELETE FROM projects WHERE code = 'ACME1'$$, '23001');                        -- has tasks

\echo 'Smoke test passed'
ROLLBACK;
