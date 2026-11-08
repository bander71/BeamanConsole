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
├── client/   React frontend (not started)
├── server/   Node API (not started)
├── db/       Postgres schema, migrations, seed data (not started)
└── docs/     Notes and design docs
```

## Suggested roadmap

1. **Data model.** Turn the prototype's `localStorage` data into a Postgres schema in `db/`.
2. **API.** Build Node endpoints in `server/` for each area (accounts, contacts, time, invoices, …).
3. **Frontend.** Rebuild each screen in React in `client/`, calling the API instead of `localStorage`.
4. **Migration.** Write a one-time import of existing `localStorage` data into Postgres.
5. **Sign-in and roles.** Replace the prototype's editor/viewer checks with real authentication.

## Local tools

- Node.js 24
- PostgreSQL 18
