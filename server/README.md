# Beaman Console API

Node API between the React frontend and Postgres.

- **Node 24**, which runs TypeScript files directly with no build step
- **Express 5** for routes
- **pg** for Postgres
- **zod** to check request data

## First-time setup

1. Install packages:

   ```bash
   npm install
   ```

2. Create the database. This asks for your `postgres` password:

   ```bash
   createdb -U postgres beaman_console_dev
   ```

3. Copy `.env.example` to `.env` and put your Postgres password in `DATABASE_URL`. `.env` is ignored by git, so the password stays on your machine.

4. Create the tables:

   ```bash
   npm run migrate
   ```

5. Start the API:

   ```bash
   npm run dev
   ```

   It listens on http://localhost:3001/api and restarts when code changes. Check it at http://localhost:3001/api/health.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the API and restart on code changes |
| `npm start` | Start the API |
| `npm run migrate` | Apply any new files in `db/migrations` |
| `npm test` | Run the API tests (needs a test database; see below) |
| `npm run typecheck` | Check types with TypeScript |

## Tests

The tests empty every table between runs, so they only run against a database whose name ends in `_test`.

```bash
createdb -U postgres beaman_console_test
```

Then create `server/.env.test` with:

```
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/beaman_console_test
```

Run `npm test`. The tests create the tables themselves.

## Endpoints

Everything is under `/api`. Requests and responses are JSON, with camelCase field names (`accountId`, `followUp`). Dates are `YYYY-MM-DD` strings.

### Standard resources

| Path | Table | Filters | `?q=` searches | Date range |
|---|---|---|---|---|
| `/employees` | employees | `active` | name, email | |
| `/resources` | resources | `contractor`, `active`, `employeeId` | name, email | |
| `/accounts` | accounts | `type`, `category` | name, aliases, keywords | |
| `/contacts` | contacts | `accountId`, `category`, `kind` | name, company, emails, tags | |
| `/projects` | projects | `accountId`, `type`, `code` | code, name | |
| `/opportunities` | opportunities | `stage`, `accountId`, `repId`, `projectId` | name, description | |
| `/activities` | activities | `contactId`, `accountId`, `opportunityId`, `type` | body | `activity_date` |
| `/tasks` | tasks | `projectId`, `resourceId`, `active`, `taskNumber` | name | |
| `/vehicles` | vehicles | `active` | | |
| `/trips` | trips | `kind`, `resourceId`, `vehicleId`, `accountId` | client, contact, purpose, route | `trip_date` |
| `/ledger` | ledger_entries | `type`, `category`, `resourceId`, `accountId` | payee, memo | `entry_date` |

Each one supports:

| Request | Result |
|---|---|
| `GET /accounts?q=acme&type=Client&limit=50&offset=0` | `{ data: [...], total, limit, offset }` |
| `GET /accounts/:id` | `{ data: {...} }` |
| `POST /accounts` | Creates a record and returns `201` with `{ data }` |
| `PATCH /accounts/:id` | Changes only the fields sent; returns `{ data }` |
| `DELETE /accounts/:id` | `204` |

Date-range resources also take `?from=YYYY-MM-DD&to=YYYY-MM-DD`. `limit` defaults to 100, with a maximum of 500.

The field rules for each resource are in [`src/resources.ts`](src/resources.ts).

### Other endpoints

| Request | What it does |
|---|---|
| `GET /health` | `{ ok: true }` when the API can reach the database |
| `GET /opportunities/:id/contacts` | Contacts on an opportunity |
| `PUT /opportunities/:id/contacts` | Replace them: `{ "contactIds": [...] }` |
| `GET /opportunity-contacts` | Every opportunity–contact link, as `{ opportunityId, contactId }` (for the pipeline board) |
| `POST /opportunities/:id/convert` | Turn an opportunity into a project: `{ code, name, type?, startDate? }`. Creates the project for the opportunity's account with the opportunity's value as the contract value, links it, and marks the opportunity Won, all in one transaction. `409` if it already has a project or the code is taken |
| `GET /invoice-payments?from=&to=` | Every invoice payment, newest first, with its invoice number and client (for the Accounting ledger) |
| `GET /mileage-rates` | All mileage rates |
| `GET /mileage-rates/lookup?date=&kind=` | The rate in effect on a date (`kind` is `business` or `charitable`) |
| `PUT /mileage-rates/:kind/:effectiveDate` | Set a rate: `{ "ratePerMile": 0.70 }` |
| `DELETE /mileage-rates/:kind/:effectiveDate` | Remove a rate |
| `GET /settings/invoicing` | Invoice settings (company details, numbering, terms, tax) |
| `PUT /settings/invoicing` | Update any of those fields |

### Timesheets

A timesheet is one resource's week, starting on a Monday. The API sends and receives it as a grid. Each line is one task, with seven daily hour values, Monday first:

```json
{
  "id": "…", "resourceId": "…", "resourceName": "Brad Anderson",
  "weekStart": "2026-11-02", "status": "draft",
  "submittedAt": null, "approvedAt": null, "approvedBy": null, "returnNote": "",
  "lines": [{
    "id": "…", "taskId": "…", "taskNumber": 501, "taskName": "MCE ERP",
    "projectCode": "MCERP", "accountName": "McElroy's", "billRate": 195, "costRate": 195,
    "note": "", "hours": [6.5, 6.5, 6.5, 6.5, 2, 0, 0],
    "billed": [false, false, false, false, false, false, false]
  }],
  "totals": { "hours": 28, "billableHours": 28, "billValue": 5460, "cost": 5460, "days": [6.5, 6.5, 6.5, 6.5, 2, 0, 0] }
}
```

| Request | What it does |
|---|---|
| `GET /resources/:resourceId/timesheets/:weekStart` | The sheet for that week, or an empty draft (`id: null`) if none is saved |
| `PUT /resources/:resourceId/timesheets/:weekStart` | Save the grid: `{ "lines": [{ "taskId", "note", "hours": [7 numbers] }] }`. Replaces all lines, in the order sent, and creates the sheet if needed |
| `POST /resources/:resourceId/timesheets/:weekStart/copy-previous` | Add the task lines from the most recent earlier sheet, with zero hours |
| `GET /timesheets?resourceId=&status=&from=&to=` | List sheets with total hours, billable hours, billing value and cost. `status=submitted` is the approvals queue |
| `GET /timesheets/:id` | One sheet as a grid |
| `POST /timesheets/:id/submit` | Draft or returned → submitted (needs some hours) |
| `POST /timesheets/:id/recall` | Submitted → draft |
| `POST /timesheets/:id/approve` | Submitted → approved. Optional `{ "approvedBy": employeeId }` |
| `POST /timesheets/:id/return` | Submitted → returned. Optional `{ "note": "reason" }` |
| `POST /timesheets/:id/reopen` | Approved → draft |
| `DELETE /timesheets/:id` | Delete a draft or returned sheet |

Rules:
- Hours can change only while a sheet is draft or returned. Otherwise the API returns `409`.
- Each task appears once per sheet, must belong to that resource, and must be active to be added. A line already on the sheet keeps working if its task is deactivated later.
- Each day's hours are 0–24 per line, and the day's total across lines can't exceed 24.
- Hours that are on an invoice (`billed: true`) can't be changed or removed, and their sheet can't be deleted.
- Copy-previous skips tasks already on the week and tasks that are now inactive.

### Invoices

An invoice comes back with its lines, the time entries each time line bills, its payments and its totals:

```json
{
  "id": "…", "number": "BC2026-0001", "accountId": "…", "accountName": "McElroy's",
  "status": "sent", "displayStatus": "partial",
  "billToName": "McElroy's", "billToAttn": "Accounts Payable", "billToEmail": "", "billToAddress": "",
  "cadence": "biweekly", "periodStart": "2026-10-26", "periodEnd": "2026-11-08",
  "issueDate": "2026-11-08", "termsDays": 30, "dueDate": "2026-12-08", "taxRate": 0.08, "memo": "",
  "lines": [{ "id": "…", "lineNo": 1, "kind": "time", "taskId": "…", "taskNumber": 501,
              "description": "MCE ERP — Brad Anderson", "quantity": 20, "rate": 195, "amount": 3900,
              "taxable": false, "entries": [{ "timeEntryId": "…", "workDate": "2026-10-26", "hours": 8, "resourceName": "Brad Anderson", "note": "" }] }],
  "payments": [{ "id": "…", "paymentDate": "2026-11-20", "amount": 1000, "method": "Check", "reference": "1042" }],
  "totals": { "subtotal": 3900, "tax": 0, "total": 3900, "paid": 1000, "balance": 2900 }
}
```

`status` is what's stored: `draft`, `sent` or `void`. `displayStatus` is what to show, worked out the same way as the prototype:

| displayStatus | When |
|---|---|
| `draft`, `void` | Same as status |
| `paid` | Sent, and nothing is owed |
| `overdue` | Sent, past the due date, with a balance |
| `partial` | Sent, with some payment |
| `sent` | Sent, with no payment yet |

| Request | What it does |
|---|---|
| `GET /invoices/unbilled?accountId=&from=&to=&includeUnapproved=&includeFlatFee=` | Billable time not yet on an invoice, grouped by account, with the lines a new invoice would get. Unapproved time is included by default; Flat Fee time isn't |
| `POST /invoices` | Create a draft: `{ accountId, from?, to?, cadence?, issueDate?, includeUnapproved?, includeFlatFee?, blank? }`. Pulls in unbilled time, one line per task. Bill-to comes from the account; terms and tax come from invoice settings |
| `GET /invoices?accountId=&status=&from=&to=&q=` | List with totals. `status` is a displayStatus; `from`/`to` filter on issue date; `q` searches number and client |
| `GET /invoices/:id` | One invoice |
| `PATCH /invoices/:id` | Edit a draft: header fields, and optionally `lines` to replace all lines (see below) |
| `POST /invoices/:id/send` | Draft → sent (needs at least one line) |
| `POST /invoices/:id/unsend` | Sent → draft (only with no payments) |
| `POST /invoices/:id/void` | Sent → void (only with no payments). Keeps the lines but frees the hours to bill again |
| `DELETE /invoices/:id` | Delete a draft, freeing its hours |
| `POST /invoices/:id/payments` | Record a payment on a sent invoice: `{ paymentDate?, amount, method?, reference? }`. Can't be more than the balance |
| `DELETE /invoices/:id/payments/:paymentId` | Remove a payment |

Editing lines: send the full list in the order you want.

- **Keep an existing line:** `{ "id", "description"?, "rate"?, "quantity"?, "taxable"? }`. The quantity on time lines comes from timesheets and can't be changed.
- **Add a line:** `{ "kind": "manual" | "expense" | "product", "description", "quantity", "rate", "taxable"? }`. Product lines are taxable by default. Negative rates work for discounts or credits.
- **Remove a line:** leave it out. Removing a time line frees its hours.

The API works out each line's amount (quantity × rate).

Rules:
- Only drafts can be edited or deleted.
- Invoice numbers are `<prefix><year>-0001` and count up per year, starting from `firstNumber` in settings. A number can be edited on a draft, but it must stay unique.
- An hour can be on only one invoice. That holds even if two invoices are created at the same moment.
- Tax applies to taxable lines only. **Tax rates are fractions: `0.0865` means 8.65%.** The prototype stored percentages.

### Reports

These are read-only, and the math matches the prototype's screens. Periods are `from`/`to` dates and include both ends. Leave them out for all time. The React app turns choices like "This month" or "Q3" into dates.

| Request | What it returns |
|---|---|
| `GET /reports/budgets` | Each project and its tasks: budget vs actual hours (all statuses, all time), remaining, burn, value, cost and margin. Flat Fee value is budget hours × rate, so overruns show up as lower margin. Projects with no billable task are `internal` and show no value |
| `GET /reports/time?from=&to=&groupBy=` | Hours, billable hours, utilization, billing value, contractor cost, margin and margin %, grouped by `client` (default), `project`, `resource` or `task`, plus totals |
| `GET /reports/time/entries?from=&to=&limit=&offset=` | The day-lines behind that report, newest first, with value, cost, timesheet status and whether each has been billed |
| `GET /reports/pnl?from=&to=&basis=` | Profit and loss with income and expense lines, totals, net and net margin, plus the mileage deduction for the period. See bases below |
| `GET /reports/pnl/monthly?year=&basis=` | Income, expenses and net for each month of a year |
| `GET /reports/receivables?asOf=` | Open invoice balances by client and by days past due: Current, 1–30, 31–60, 61–90, Over 90 |
| `GET /reports/contractors?year=` | Each 1099 contractor: hours, cost and payments in the year, what's still owed (all time), and whether a 1099-NEC is needed (paid $2,000 or more in the year) |
| `GET /reports/invoicing?year=` | Outstanding and overdue balances, unbilled T&M time, amount invoiced and collected in the year |
| `GET /reports/accounts?year=` | For every account: linked people, hours (all time and in the year), billing value and miles in the year, and last activity (latest of work, notes and trips). Feeds the Accounts list |
| `GET /reports/accounts/:id?year=` | The same for one account, plus its tasks with hours in the year and all time |
| `GET /reports/contacts` | For every contact: the last date they were contacted (latest logged note or trip). Feeds the Contacts list's "Last contacted" sort and CSV |
| `GET /reports/contacts/:id` | The same for one contact, plus their trips (newest first) and opportunities. Trips match like the prototype: linked to the contact, or for a person, the trip's contact text contains their full name; for a company, the trip's purpose or contact text contains the company name |
| `GET /reports/mileage?from=&to=` | Trips, miles and deduction value (miles × IRS rate on the trip date) by month, client, vehicle and kind |

Profit and loss bases (`basis=cash` is the default):

- **Cash:**
  - Income is invoice payments received, by client, plus manual ledger income.
  - Expenses are ledger expenses.
- **Accrual:**
  - Income is sent invoices by issue date, by client, plus manual ledger income.
  - Expenses are ledger expenses, but contractor cost comes from timesheet hours × cost rate instead of payments.
- On both bases, draft and void invoices are never revenue. The mileage deduction is shown alongside but isn't counted as an expense.

### Errors

Errors look like `{ "error": { "message": "...", "details": ... } }`.

| Status | When |
|---|---|
| 400 | Bad or missing fields, unknown fields, a value not in an allowed list, malformed JSON, or a link to a record that doesn't exist |
| 404 | The record or endpoint doesn't exist |
| 409 | A duplicate (e.g. same account name), or deleting a record other records still use |

## Code layout

```
src/
├── index.ts        Starts the server
├── app.ts          Builds the Express app and mounts routes
├── config.ts       Reads settings from the environment
├── db.ts           Postgres pool, type handling, camelCase conversion
├── errors.ts       Turns validation and database errors into HTTP responses
├── migrate.ts      Migration runner (npm run migrate)
├── crud.ts         Builds standard routes from a resource definition
├── resources.ts    Field rules for each standard resource
└── routes/
    ├── extra.ts       Endpoints that don't fit the standard pattern
    ├── timesheets.ts  Weekly grid, status flow, copy-previous
    ├── invoices.ts    Unbilled time, drafts, lines, send/void, payments
    └── reports.ts     Budgets, time, P&L, receivables, contractors, mileage
test/
├── helpers.ts           Starts the app against the test database
├── api.test.ts
├── timesheets.test.ts
├── invoices.test.ts
└── reports.test.ts      Checks every report against hand-worked numbers
```

To add a simple table, add a definition to `resources.ts`.

## Not built yet

- **Sign-in and permissions.** Right now anyone who can reach the API can change anything, so run it only on your own machine until sign-in is added.
