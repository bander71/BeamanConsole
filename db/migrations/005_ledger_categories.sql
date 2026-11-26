-- Two more expense categories for the ledger:
--   'Wages & payroll'        wages and payroll tax (Gusto)
--   'Income tax payments'    federal and state income tax, including estimates,
--                            kept apart from 'Taxes & licenses' so it shows on its own P&L line
--
-- The category list lives in a CHECK constraint (named ledger_entries_check by
-- Postgres in 001); it is replaced here with a named one.

ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_category_check CHECK (
  (type = 'expense' AND category IN (
    'Contractors (1099)', 'Wages & payroll', 'Software & subscriptions', 'Travel', 'Meals', 'Vehicle & fuel',
    'Office & supplies', 'Insurance', 'Professional fees', 'Marketing', 'Equipment',
    'Taxes & licenses', 'Income tax payments', 'Bank & payment fees', 'Other expense'))
  OR
  (type = 'income' AND category IN (
    'Consulting revenue (outside invoices)', 'Reimbursements', 'Interest', 'Other income'))
);
