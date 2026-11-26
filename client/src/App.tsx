import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { canDo, type Me, useMe } from './api/auth.ts'
import { api } from './api/client.ts'
import { AccountingView } from './views/accounting/AccountingView.tsx'
import { AccountsView } from './views/accounts/AccountsView.tsx'
import { ApprovalsView } from './views/approvals/ApprovalsView.tsx'
import { BudgetsView } from './views/budgets/BudgetsView.tsx'
import { ContactsView } from './views/contacts/ContactsView.tsx'
import { EmployeesView } from './views/employees/EmployeesView.tsx'
import { InvoicesView } from './views/invoices/InvoicesView.tsx'
import { MileageView } from './views/mileage/MileageView.tsx'
import { NotBuiltYet } from './views/NotBuiltYet.tsx'
import { PipelineView } from './views/pipeline/PipelineView.tsx'
import { ReportsView } from './views/reports/ReportsView.tsx'
import { SetupView } from './views/setup/SetupView.tsx'
import { useSubmittedCount } from './views/timesheet/data.ts'
import { TimesheetView } from './views/timesheet/TimesheetView.tsx'
import { UsersView } from './views/users/UsersView.tsx'

// Same views and order as the prototype's top bar. `area` is the permission area
// (server/src/auth/permissions.ts) whose Read right shows the view. Users & roles
// (admins only) is linked from the signed-in strip above the nav.
const NAV: { path: string; label: string; area: string; built?: boolean }[][] = [
  [
    { path: 'timesheet', label: 'Timesheet', area: 'timesheets', built: true },
    { path: 'approvals', label: 'Approvals', area: 'approvals', built: true },
    { path: 'budgets', label: 'Budgets', area: 'budgets', built: true },
    { path: 'mileage', label: 'Mileage', area: 'mileage', built: true },
  ],
  [
    { path: 'pipeline', label: 'Pipeline', area: 'pipeline', built: true },
    { path: 'accounts', label: 'Accounts', area: 'accounts', built: true },
    { path: 'contacts', label: 'Contacts', area: 'contacts', built: true },
  ],
  [
    { path: 'invoices', label: 'Invoices', area: 'invoices', built: true },
    { path: 'accounting', label: 'Accounting', area: 'accounting', built: true },
    { path: 'reports', label: 'Reports', area: 'reports', built: true },
  ],
  [
    { path: 'employees', label: 'Employees', area: 'employees', built: true },
    { path: 'setup', label: 'Setup', area: 'setup', built: true },
  ],
]

const canSee = (me: Me, area: string) => (area === 'admin' ? me.permissions.isAdmin : canDo(me, area, 'read'))

function ConnectionStatus() {
  const { isSuccess, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ ok: boolean }>('/health'),
    refetchInterval: 30_000,
    retry: false,
  })
  return <div className="sync">{isError ? "Can't reach the server" : isSuccess ? 'Connected' : 'Connecting…'}</div>
}

function WhoAmI() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const onUsers = useLocation().pathname.startsWith('/users')
  async function signOut() {
    await api.post('/auth/logout').catch(() => {})
    qc.clear()
    window.location.href = '/'
  }
  return (
    <div className="whoami">
      <span><b>{me.user.name || me.user.email}</b> · {me.user.roleName}</span>
      {me.permissions.isAdmin && (
        <button className="btn quiet sm" aria-current={onUsers ? 'page' : undefined} onClick={() => navigate('/users')}>Users &amp; roles</button>
      )}
      <button className="btn quiet sm" onClick={signOut}>Sign out</button>
    </div>
  )
}

/** Shows a view only if the role may read its area, with a note when it can't change anything there. */
function Guarded({ area, children }: { area: string; children: ReactNode }) {
  const me = useMe()
  if (!canSee(me, area)) {
    return (
      <section className="panel">
        <div className="empty">Your role ({me.user.roleName}) doesn't include this page. Ask an admin if you need it.</div>
      </section>
    )
  }
  const def = me.areas.find((a) => a.key === area)
  const writes = (def?.actions ?? []).filter((a) => a !== 'read')
  const readOnly = area !== 'admin' && writes.length > 0 && !writes.some((a) => canDo(me, area, a))
  const own = area !== 'admin' && !me.permissions.isAdmin && me.permissions.areas[area]?.ownOnly
  return (
    <>
      {readOnly && <p className="note readonly-note">View only: your role ({me.user.roleName}) can't make changes here.</p>}
      {own && <p className="note readonly-note">You see and change only your own records here.</p>}
      {children}
    </>
  )
}

export function App() {
  const me = useMe()
  const navigate = useNavigate()
  const section = useLocation().pathname.split('/')[1]
  const waiting = useSubmittedCount(canDo(me, 'approvals', 'read')).data ?? 0
  const badges: Record<string, number> = { approvals: waiting }
  const nav = NAV.map((group) => group.filter((v) => canSee(me, v.area))).filter((g) => g.length)
  const home = nav[0]?.[0]?.path

  const guarded = (area: string, el: ReactNode) => <Guarded area={area}>{el}</Guarded>

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <b>Beaman</b>
            <span>Console</span>
          </div>
          <nav aria-label="Views">
            {nav.map((group, i) => (
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
          <WhoAmI />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={home ? <Navigate to={'/' + home} replace /> : <NoPages />} />
          <Route path="/timesheet" element={guarded('timesheets', <TimesheetView />)} />
          <Route path="/approvals" element={guarded('approvals', <ApprovalsView />)} />
          <Route path="/budgets" element={guarded('budgets', <BudgetsView />)} />
          <Route path="/mileage" element={guarded('mileage', <MileageView />)} />
          <Route path="/pipeline" element={guarded('pipeline', <PipelineView />)} />
          <Route path="/pipeline/:id" element={guarded('pipeline', <PipelineView />)} />
          <Route path="/invoices" element={guarded('invoices', <InvoicesView />)} />
          <Route path="/invoices/:id" element={guarded('invoices', <InvoicesView />)} />
          <Route path="/accounting" element={guarded('accounting', <AccountingView />)} />
          <Route path="/reports" element={guarded('reports', <ReportsView />)} />
          <Route path="/employees" element={guarded('employees', <EmployeesView />)} />
          <Route path="/setup" element={guarded('setup', <SetupView />)} />
          <Route path="/users" element={guarded('admin', <UsersView />)} />
          <Route path="/accounts" element={guarded('accounts', <AccountsView />)} />
          <Route path="/accounts/:id" element={guarded('accounts', <AccountsView />)} />
          <Route path="/contacts" element={guarded('contacts', <ContactsView />)} />
          <Route path="/contacts/:id" element={guarded('contacts', <ContactsView />)} />
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

function NoPages() {
  const me = useMe()
  return (
    <section className="panel">
      <div className="empty">Your role ({me.user.roleName}) doesn't include any pages yet. Ask an admin to give it access.</div>
    </section>
  )
}
