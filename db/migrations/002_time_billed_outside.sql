-- Time billed outside the app, and where imported time came from.
--
-- billed_outside: hours already invoiced somewhere else (for example in Harvest,
--   before Beaman Console). They count in reports and budgets like any hours, but
--   they're treated as billed: they never show as ready to invoice and can't be changed.
-- source: '' for time entered in the app; 'harvest' for time imported from Harvest.
--   Re-running an import uses it to skip what's already there.

ALTER TABLE time_entries
  ADD COLUMN billed_outside boolean NOT NULL DEFAULT false,
  ADD COLUMN source text NOT NULL DEFAULT '';

CREATE INDEX time_entries_source_idx ON time_entries (source) WHERE source <> '';

-- "billed" now also covers time billed outside the app. New columns go at the end
-- (CREATE OR REPLACE VIEW can only add columns there).
CREATE OR REPLACE VIEW time_detail AS
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
  (ilte.time_entry_id IS NOT NULL OR te.billed_outside) AS billed,
  te.billed_outside,
  te.source
FROM time_entries te
JOIN timesheet_lines tl ON tl.id = te.timesheet_line_id
JOIN timesheets ts      ON ts.id = tl.timesheet_id
JOIN tasks t            ON t.id = tl.task_id
JOIN projects p         ON p.id = t.project_id
JOIN resources r        ON r.id = ts.resource_id
LEFT JOIN invoice_line_time_entries ilte ON ilte.time_entry_id = te.id;
