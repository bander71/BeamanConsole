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
| Timesheet | ✅ Weekly grid for any resource and week, saved as you type. Hours take decimals (1.5) or h:mm (1:30); invalid entries are flagged and not saved. Up, Down and Enter move between rows. Add and remove lines, notes per line, copy lines from last week, daily and weekly totals, and submit, approve, return (with a note), recall and reopen. Hours already on an invoice show as locked cells. The Approvals tab shows how many sheets are waiting |
| Approvals | ✅ Timesheets waiting for approval with hours, billable hours, billing value and cost; approve, or return with a note; Open jumps to the sheet. "Show every timesheet" lists all sheets with their status (and the reason for any returned sheet), and the choice is remembered |
| Mileage | ✅ Log or edit a trip: start reading fills in from the vehicle's last trip, both readings fill in the miles, live value preview at the IRS rate for the date, and "Repeat a frequent trip" buttons. Period, vehicle and type filters; trips, business and charitable miles and deduction value; by month (with bars) and by client; each vehicle's year with business-use share; the trips list (click to edit, delete with confirmation); CSV export |
| Pipeline | ✅ Board of opportunities by stage with counts, totals and win likelihood; stats (open, weighted, closing this quarter, won this year, win rate); search and sales rep filter; drag cards between stages (Won and Lost record the date). Opportunity panel: details, linked contacts (grouped by "At this account"), notes, delete, and Convert to project, which suggests a project ID, creates the project and marks the deal Won in one step. Opportunity lists on Accounts and Contacts open the panel, and their "New opportunity" buttons pre-fill the account and contact |
| Setup | ✅ Edit-in-place tables for Tasks (the client comes from the project's account), Projects (with their account), Resources (with an Active switch that hides people from the Timesheet), Vehicles and Mileage rates (business and charitable side by side by date). Add rows; new tasks get the next number |
| Employees | ✅ Edit-in-place employee table, and pipeline by sales rep (open deals and value, weighted, won this year) |
| Contacts | ✅ List with search, "Show" filter (people, linked to a client, follow-ups, possible duplicates, relationship), source filter and five sorts including group by company; detail with linked account, follow-ups, emails and phones with Copy, notes and activity, opportunities, mileage trips with the person, and "People here" for company entries; add, edit and delete; CSV export. Typing a company name links the contact to the matching account (by name or alias), as the prototype does |
| Accounts | ✅ List with search, type filter and sorting; detail with stats, follow-ups, notes and activity, people, opportunities and timesheet work; add, edit (renaming keeps the old name as an alias, like the prototype), delete; CSV export |
| Budgets | ✅ Read-only budget vs actual hours for every project and its tasks: remaining hours (red when over), burn bar (amber past 80%, red past 100%), value, cost and margin. Flat Fee value is the fixed contract value, so overruns show as lower margin; internal projects show no money. Reloads each visit |
| Invoices | ✅ Stats (outstanding, overdue, unbilled T&M time, invoiced and collected this year); invoice settings (tax rate entered as a percent); Ready to invoice by client, split at the end of the last full bi-weekly period, with "Invoice through" and "Ad hoc" buttons; New invoice panel with client, bi-weekly period or date range, unapproved and Flat Fee options and a preview of the lines; list with status and client filters and CSV export. Invoice page: the printable invoice, editable while a draft (number, date, terms, bill-to, lines, taxable flags, notes, sales tax), with add line, milestone, product (taxable) and expense; save, mark as sent, back to draft, void and delete with confirmation; record and remove payments; payments and time detail tables; Download invoice (an HTML file to print or save as PDF, with the time detail on page 2) and Time detail (CSV) |
| Accounting | ✅ Period (this month to all time, or custom) and cash or accrual basis. Stats (revenue, expenses, net income and margin, receivables, owed to contractors); profit and loss with the mileage deduction alongside; revenue and expenses by month with bars; receivables aging by client; contractors with hours, cost, payments, what's owed, a Pay button and the 1099-NEC flag; the ledger of invoice payments (added automatically; click to open the invoice) and manual income and expenses (click to edit or delete); record income or expense; ledger CSV export |
| Reports | ✅ Period and group by client, project, resource or task. Stats (hours, billable hours, utilization, billing value, contractor cost, margin), the grouped table with totals, and the newest 300 day-lines with timesheet status. Export entries (CSV) includes every day-line in the period |

### How the timesheet saves

Edits are kept on screen and saved 0.7 seconds after you stop typing. Adding or removing a line saves right away, and so does leaving the week or person, so a quick edit isn't lost. The panel shows "Unsaved changes…", "Saving…" or "Saved 3:42 PM". If the server refuses a save (for example, the sheet was submitted from another window, or the hours are on an invoice), the screen says why and reloads the sheet. Closing the tab with unsaved changes asks you to confirm first.

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
│   ├── periods.ts        Period choices (this month, Q1, year to date, …) as date ranges
│   └── csv.ts            CSV download
├── components/           Shared pieces: toast messages, detail-panel fields, follow-up box, notes and activity log, edit-in-place table
├── views/
│   ├── accounts/         Accounts screen: list, detail, form, data hooks
│   ├── timesheet/        Timesheet screen: person and week picker, grid with autosave, hour cells
│   ├── approvals/        Approvals screen
│   ├── accounting/       Accounting: profit and loss, by month, receivables aging, contractors, ledger and entry form
│   ├── budgets/          Budgets screen (read-only)
│   ├── invoices/         Invoices: list and new-invoice panel, invoice page, the invoice paper and its styles, downloads
│   ├── contacts/         Contacts screen: list, detail, form, data hooks
│   ├── mileage/          Mileage screen: trip form, totals, vehicles, trips list
│   ├── pipeline/         Pipeline board and the opportunity panel
│   ├── setup/            Setup tables: tasks, projects, resources, vehicles, mileage rates
│   ├── employees/        Employees table and pipeline by sales rep
│   ├── reports/          Time report by client, project, resource or task, and its CSV
│   └── NotBuiltYet.tsx   Placeholder for screens still to rebuild
└── styles/console.css    The prototype's stylesheet
```

Each screen keeps its API calls in a `data.ts` file next to it, using TanStack Query hooks. After a save, the hooks refresh the lists and reports the change affects.
