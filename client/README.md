# Beaman Console frontend

React app for Beaman Console. It calls the Node API in `../server`.

- **React 19 and TypeScript**, built with **Vite**
- **React Router** for screens (`/accounts`, `/accounts/:id`, …)
- **TanStack Query** for loading and saving data, with caching
- The prototype's stylesheet, copied unchanged into [`src/styles/console.css`](src/styles/console.css), so screens look the same

## Run it

The API has to be running first; see [server/README.md](../server/README.md). Then, in `client/`:

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server passes `/api` requests to the API on port 3001. To use a different API address, set `API_URL`, for example `API_URL=http://localhost:4000 npm run dev`.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server, which reloads as you edit |
| `npm run build` | Type-check and build to `dist/` |
| `npm run lint` | Check the code with oxlint |
| `npm run preview` | Serve the built `dist/` locally |

## Screens

| Screen | Status |
|---|---|
| Accounts | ✅ List with search, type filter and sorting; detail with stats, follow-ups, notes and activity, people, opportunities and timesheet work; add, edit (renaming keeps the old name as an alias, like the prototype), delete; CSV export |
| Timesheet, Approvals, Budgets, Mileage, Pipeline, Contacts, Invoices, Accounting, Reports, Employees, Setup | Not rebuilt yet. Each shows a placeholder; use the prototype for now |

## Code layout

```
src/
├── main.tsx              Starts React with the router, data cache and toasts
├── App.tsx               Top bar, navigation and routes
├── api/
│   ├── client.ts         fetch wrapper: errors, query strings, paging through lists
│   └── types.ts          Shapes the API returns
├── lib/
│   ├── format.ts         Money, hours, miles and date formatting (matches the prototype)
│   └── csv.ts            CSV download
├── components/           Shared pieces (toast messages)
├── views/
│   ├── accounts/         Accounts screen: list, detail, form, data hooks
│   └── NotBuiltYet.tsx   Placeholder for screens still to rebuild
└── styles/console.css    The prototype's stylesheet
```

Each screen keeps its API calls in a `data.ts` file next to it, using TanStack Query hooks. After a save, the hooks refresh the lists and reports the change affects.
