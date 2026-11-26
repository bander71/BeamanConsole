# Beaman Console

Internal operations console for Beaman Consulting: accounts, contacts, employees, pipeline, project budgets, approvals, time, invoices and payments, mileage, and reports.

## Status

The working prototype is a single HTML file, [`legacy/Beaman-Console.html`](legacy/Beaman-Console.html). It runs in the browser with plain JavaScript and saves its data to browser `localStorage`. Open it directly in a browser to use it.

The goal is to rebuild it as a full application:

| Layer    | Technology  | Folder    |
|----------|-------------|-----------|
| Frontend | React       | `client/` |
| API      | Node.js     | `server/` |
| Database | PostgreSQL  | `db/`     |

## Layout

```
beaman-console/
├── legacy/   Original single-file prototype (reference for features and UI)
├── client/   React frontend (see client/README.md)
├── server/   Node API (see server/README.md)
├── db/       Postgres schema and migrations (see db/README.md)
└── docs/     Notes and design docs
```

## Suggested roadmap

1. **Data model.** ✅ Postgres schema in [`db/`](db/README.md), built from the prototype's data.
2. **API.** ✅ [`server/`](server/README.md) has endpoints for every area of the prototype: accounts, contacts, opportunities, people, projects, tasks, timesheets, invoices, mileage, the ledger and reports.
3. **Frontend.** ✅ [`client/`](client/README.md) has every screen from the prototype: Timesheet, Approvals, Budgets, Mileage, Pipeline, Accounts, Contacts, Invoices, Accounting, Reports, Employees and Setup.
4. **Migration.** Write a one-time import of existing `localStorage` data into Postgres.
5. **Sign-in and roles.** Replace the prototype's editor/viewer checks with real authentication.

## Run it locally

**Every day:** double-click **`Start Beaman Console.cmd`** in this folder. It starts the app's database if it isn't running, opens two windows (the API and the web app), and opens http://localhost:5173 when it's ready. Close the two windows to stop the app; the database stops when Windows shuts down.

**Once, first:** run the setup in PowerShell from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1
```

It gives the app its own database, using the PostgreSQL programs already installed but without needing the `postgres` password:

- The data lives in `%USERPROFILE%\BeamanConsoleData\pgdata`, on port 5433, reachable only from this computer. Backups from the Harvest import go in `%USERPROFILE%\BeamanConsoleData\backups`.
  - It's outside OneDrive, so syncing can't damage it.
  - It's outside AppData on purpose: apps like Claude Desktop can give programs they start a private copy of AppData, which would hide the database from the launcher you double-click.
- It makes up a password for the app's database user and saves it in `server/.env`, which git ignores.
- It installs packages if needed and creates the tables. Add `-CopyFrom "postgres://user@host:port/dbname"` to copy all data from another database into the new one.
- Running it again is safe: it keeps the database and its data.

To run the pieces by hand instead (for development), see [server/README.md](server/README.md#first-time-setup) and [client/README.md](client/README.md#run-it).

## Local tools

- Node.js 24
- PostgreSQL 18
