-- Invoices brought in from elsewhere, and their original files.
--
-- source:    '' for invoices made in the app; 'harvest' for past invoices imported from Harvest.
--            The Invoices screen lists those separately, under "Past invoices (Harvest)".
-- file_name: the original PDF, stored in the app's data folder under invoice-files/
--            (see BEAMAN_DATA_DIR in server/src/config.ts). Null when there's no file.

ALTER TABLE invoices
  ADD COLUMN source text NOT NULL DEFAULT '',
  ADD COLUMN file_name text;

CREATE INDEX invoices_source_idx ON invoices (source) WHERE source <> '';
