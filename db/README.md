# Database

PostgreSQL schema for Beaman Console.

```
db/
├── migrations/   Numbered SQL files, applied in order
│   └── 001_initial_schema.sql
└── tests/
    └── smoke_test.sql   Inserts sample data, checks the rules, rolls back
```

## Set up a local database

See [server/README.md](../server/README.md#first-time-setup). In short: create the database, then run `npm run migrate` in `server/`. The runner applies each new file in `migrations/` once, inside a transaction, and records it in a `schema_migrations` table.

New migration files go in `migrations/` with the next number (`002_...sql`). Don't edit a migration after it has been applied to a database you care about; add a new one instead.

To run the smoke test (asks for the `postgres` password; leaves no data behind):

```bash
psql -U postgres -d beaman_console_dev -v ON_ERROR_STOP=1 -f db/tests/smoke_test.sql
```

It should print `Smoke test passed`.

## Conventions

- Every table has a `uuid` primary key named `id`.
- Records imported from the prototype keep their old key in `legacy_id`, so the import can link records together.
- Codes people see and type stay as their own columns: `projects.code` (e.g. `MCERP`), `tasks.task_number` (e.g. `501`), `invoices.number`.
- Money is `numeric(12,2)`. Never use floating point for money.
- Fixed lists (stages, types, categories, methods) are `CHECK` constraints, so adding a value takes a one-line migration.
- Every table that changes has `created_at` and `updated_at`. A trigger keeps `updated_at` current.

## How the prototype maps to tables

The prototype stores one JSON object in browser storage, with one collection per area. Lists nested inside records become their own tables.

| Prototype collection | Table(s) | Notes |
|---|---|---|
| `employees` | `employees` | Staff and sales reps |
| `resources` | `resources` | Anyone who logs time; `contractor` marks 1099s. Can link to an employee |
| `accounts` | `accounts` | `aliases` keep the other spellings that timesheets and trips use |
| `accounts[].log` | `activities` | Shared notes table for accounts, contacts and opportunities |
| `contacts` | `contacts` | `company` keeps the typed text; `account_id` is the resolved link |
| `contacts[].log` | `activities` | |
| `opportunities` | `opportunities` | |
| `opportunities[].contactIds` | `opportunity_contacts` | |
| `opportunities[].notes` | `activities` | |
| `projects` | `projects` | Key (e.g. `MCERP`) becomes `code`; gains `account_id` |
| `tasks` | `tasks` | One resource on one project, with bill and cost rates. `client` text becomes the project's account |
| `timesheets` | `timesheets` | One per resource per week; week must start Monday |
| `timesheets[].rows` | `timesheet_lines` | |
| `timesheets[].rows[].h` (7 days) | `time_entries` | One row per day with hours; zero days are not stored |
| `vehicles` | `vehicles` | |
| `rates` | `mileage_rates` | One row per kind (business, charitable) per effective date |
| `trips` | `trips` | `client` and `contact` text kept, plus resolved links |
| `settings/invoicing` | `invoice_settings` | Single row |
| `invoices` | `invoices` | `billTo` is flattened into `bill_to_*` columns; `due_date` is calculated |
| `invoices[].lines` | `invoice_lines` | |
| `invoices[].lines[].entries` | `invoice_line_time_entries` | Links billed hours to time entries. An hour can be billed only once |
| `invoices[].payments` | `invoice_payments` | |
| `ledger` | `ledger_entries` | Manual income and expenses. Category must match the type |

## Views

- **`time_detail`**: every hour logged, with task, project, account, rates, timesheet status, and whether it has been billed. Budgets, reports and "ready to invoice" build on this.
- **`invoice_totals`**: subtotal, tax, total, paid and balance for each invoice.

## Rules the database enforces

These were checks in the prototype's JavaScript. Now the database enforces them, whatever app or script writes the data:

- Account names are unique, ignoring case.
- One timesheet per resource per week, and the week starts on Monday.
- A day's hours must be above 0 and at most 24.
- A time entry can't be billed on two invoices.
- A ledger entry under "Contractors (1099)" must name the contractor.
- A project that still has tasks can't be deleted.

## Not yet covered

- **Users and sign-in.** The prototype treats everyone as the owner. Users, roles and permissions come with the sign-in step of the roadmap.
- **Data import.** A script to load a prototype backup (the **Back up** button's JSON) into these tables. The prototype's built-in data has been checked against the schema and fits with no conflicts.
