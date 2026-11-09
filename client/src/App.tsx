import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { api } from './api/client.ts'
import { AccountsView } from './views/accounts/AccountsView.tsx'
import { ApprovalsView } from './views/approvals/ApprovalsView.tsx'
import { NotBuiltYet } from './views/NotBuiltYet.tsx'
import { useSubmittedCount } from './views/timesheet/data.ts'
import { TimesheetView } from './views/timesheet/TimesheetView.tsx'

// Same views and order as the prototype's top bar. `built` marks the ones rebuilt in React so far.
const NAV: { path: string; label: string; built?: boolean }[][] = [
  [
    { path: 'timesheet', label: 'Timesheet', built: true },
    { path: 'approvals', label: 'Approvals', built: true },
    { path: 'budgets', label: 'Budgets' },
    { path: 'mileage', label: 'Mileage' },
  ],
  [
    { path: 'pipeline', label: 'Pipeline' },
    { path: 'accounts', label: 'Accounts', built: true },
    { path: 'contacts', label: 'Contacts' },
  ],
  [
    { path: 'invoices', label: 'Invoices' },
    { path: 'accounting', label: 'Accounting' },
    { path: 'reports', label: 'Reports' },
  ],
  [
    { path: 'employees', label: 'Employees' },
    { path: 'setup', label: 'Setup' },
  ],
]

function ConnectionStatus() {
  const { isSuccess, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ ok: boolean }>('/health'),
    refetchInterval: 30_000,
    retry: false,
  })
  return <div className="sync">{isError ? "Can't reach the server" : isSuccess ? 'Connected' : 'Connecting…'}</div>
}

export function App() {
  const navigate = useNavigate()
  const section = useLocation().pathname.split('/')[1]
  const waiting = useSubmittedCount().data ?? 0
  const badges: Record<string, number> = { approvals: waiting }

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <b>Beaman</b>
            <span>Console</span>
          </div>
          <nav aria-label="Views">
            {NAV.map((group, i) => (
              <Fragment key={i}>
                {i > 0 && <i className="navsep" aria-hidden="true" />}
                {group.map((v) => (
                  <button key={v.path} aria-current={section === v.path ? 'page' : undefined} onClick={() => navigate('/' + v.path)}>
                    {v.label}
                    {!!badges[v.path] && <span className="badge" aria-label={`${badges[v.path]} waiting`}>{badges[v.path]}</span>}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>
          <ConnectionStatus />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/timesheet" replace />} />
          <Route path="/timesheet" element={<TimesheetView />} />
          <Route path="/approvals" element={<ApprovalsView />} />
          <Route path="/accounts" element={<AccountsView />} />
          <Route path="/accounts/:id" element={<AccountsView />} />
          {NAV.flat()
            .filter((v) => !v.built)
            .map((v) => (
              <Route key={v.path} path={`/${v.path}/*`} element={<NotBuiltYet label={v.label} />} />
            ))}
          <Route path="*" element={<NotBuiltYet label="This page" />} />
        </Routes>
      </main>
    </>
  )
}
