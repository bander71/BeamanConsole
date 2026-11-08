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
| `GET /timesheets?resourceId=&status=&from=&to=` | List sheets with total, billable hours and value. `status=submitted` is the approvals queue |
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
    └── timesheets.ts  Weekly grid, status flow, copy-previous
test/
├── helpers.ts           Starts the app against the test database
├── api.test.ts
└── timesheets.test.ts
```

To add a simple table, add a definition to `resources.ts`.

## Not built yet

- **Invoices:** generate from unbilled time, lines, payments, send and void
- **Reports:** budgets, P&L and contractor 1099 totals
- **Sign-in and permissions.** Right now anyone who can reach the API can change anything, so run it only on your own machine until sign-in is added.
