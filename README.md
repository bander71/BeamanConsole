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
3. **Frontend.** 🚧 [`client/`](client/README.md) has the app shell, navigation and the Accounts screen. The other screens are still to rebuild.
4. **Migration.** Write a one-time import of existing `localStorage` data into Postgres.
5. **Sign-in and roles.** Replace the prototype's editor/viewer checks with real authentication.

## Run it locally

1. Set up the database and start the API: [server/README.md](server/README.md#first-time-setup).
2. In a second terminal, start the frontend: [client/README.md](client/README.md#run-it).
3. Open http://localhost:5173.

## Local tools

- Node.js 24
- PostgreSQL 18
