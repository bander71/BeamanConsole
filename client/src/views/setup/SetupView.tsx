import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, getAll } from '../../api/client.ts'
import type { Project, Resource, Task, Vehicle } from '../../api/types.ts'
import { EditableTable, type Column } from '../../components/EditableTable.tsx'
import { numberFrom, text, type Draft } from '../../components/editable.ts'
import { fh2, fm, frate, odo, shortDate, today } from '../../lib/format.ts'
import { useAccounts } from '../accounts/data.ts'
import { useRates, useVehicles } from '../mileage/data.ts'
import { useProjects, useResources } from '../timesheet/data.ts'

const TYPES = [{ value: 'T&M', label: 'T&M' }, { value: 'Flat Fee', label: 'Flat Fee' }]
const chip = (label: string, bill = false) => <span className={'chip' + (bill ? ' bill' : '')}>{label}</span>
const activeChip = (active: boolean) => (active ? chip('Active', true) : chip('Inactive'))
const nullIfBlank = (s: string) => s || null

/** All tasks, for every resource (the Timesheet only loads one person's). */
const useAllTasks = () => useQuery({ queryKey: ['tasks', 'all'], queryFn: () => getAll<Task>('/tasks') })

/** Rates are stored per kind; Setup shows business and charitable side by side by date, like the prototype. */
interface RateRow { date: string; business: number | null; charitable: number | null }

export function SetupView() {
  const qc = useQueryClient()
  const tasks = useAllTasks().data ?? []
  const projects = useProjects().data ?? []
  const resources = useResources().data ?? []
  const vehicles = useVehicles().data ?? []
  const rates = useRates().data
  const accounts = useAccounts().data ?? []

  const projectById = new Map(projects.map((p) => [p.id, p]))
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const resourceById = new Map(resources.map((r) => [r.id, r]))
  const byName = <X extends { name: string }>(a: X, b: X) => a.name.localeCompare(b.name)

  const rateRows = useMemo(() => {
    const m = new Map<string, RateRow>()
    for (const r of rates ?? []) {
      const row = m.get(r.effectiveDate) ?? { date: r.effectiveDate, business: null, charitable: null }
      row[r.kind] = r.ratePerMile
      m.set(r.effectiveDate, row)
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [rates])

  // After a change, refresh every screen that shows this kind of record.
  const refresh = (...keys: string[]) => {
    for (const k of keys) qc.invalidateQueries({ queryKey: [k] })
    qc.invalidateQueries({ queryKey: ['reports'] })
  }

  // ---- tasks ----
  const taskColumns: Column<Task>[] = [
    { key: 'taskNumber', label: 'ID', edit: 'readonly', view: (t) => <span className="num">{t.taskNumber}</span>, value: (t) => String(t.taskNumber) },
    { key: 'name', label: 'Task', edit: 'text', view: (t) => t.name, value: (t) => t.name },
    {
      key: 'client', label: 'Client', edit: 'readonly',
      view: (t) => accountById.get(projectById.get(t.projectId)?.accountId ?? '')?.name ?? '—', value: () => '',
    },
    {
      key: 'projectId', label: 'Project', edit: 'select',
      options: [...projects].sort(byName).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
      view: (t) => { const p = projectById.get(t.projectId); return <>{p?.name}<span className="sub">{p?.code}</span></> },
      value: (t) => t.projectId,
    },
    { key: 'billRate', label: 'Bill rate', edit: 'number', numeric: true, view: (t) => fm(t.billRate), value: (t) => String(t.billRate) },
    { key: 'costRate', label: '1099 rate', edit: 'number', numeric: true, view: (t) => fm(t.costRate), value: (t) => String(t.costRate) },
    { key: 'budgetHours', label: 'Budget h', edit: 'number', numeric: true, view: (t) => fh2(t.budgetHours), value: (t) => String(t.budgetHours) },
    { key: 'type', label: 'Type', edit: 'select', options: TYPES, view: (t) => chip(t.type), value: (t) => t.type },
    {
      key: 'resourceId', label: 'Resource', edit: 'select',
      options: [...resources].sort(byName).map((r) => ({ value: r.id, label: r.name })),
      view: (t) => resourceById.get(t.resourceId)?.name ?? '—', value: (t) => t.resourceId,
    },
    { key: 'active', label: 'Active', edit: 'checkbox', view: (t) => activeChip(t.active), value: (t) => t.active },
  ]

  async function saveTask(d: Draft, t: Task | null) {
    const name = text(d, 'name')
    if (!name) throw new Error('Give the task a name.')
    if (!d.projectId) throw new Error('Pick a project. Add one below first if needed.')
    if (!d.resourceId) throw new Error('Pick a resource. Add one below first if needed.')
    const body = {
      name, projectId: d.projectId, resourceId: d.resourceId, type: d.type, active: !!d.active,
      billRate: numberFrom(d, 'billRate', 'Bill rate'), costRate: numberFrom(d, 'costRate', '1099 rate'),
      budgetHours: numberFrom(d, 'budgetHours', 'Budget hours'),
    }
    if (t) await api.patch(`/tasks/${t.id}`, body)
    else await api.post('/tasks', { ...body, taskNumber: Number(d.taskNumber) })
    refresh('tasks', 'timesheet')
  }

  // ---- projects ----
  const projectColumns: Column<Project>[] = [
    { key: 'code', label: 'Project ID', edit: 'text', newOnly: true, placeholder: 'e.g. ACME', view: (p) => <span className="num">{p.code}</span>, value: (p) => p.code },
    { key: 'name', label: 'Project', edit: 'text', view: (p) => p.name, value: (p) => p.name },
    {
      key: 'accountId', label: 'Account', edit: 'select',
      options: [{ value: '', label: 'No account' }, ...[...accounts].sort(byName).map((a) => ({ value: a.id, label: a.name }))],
      view: (p) => accountById.get(p.accountId ?? '')?.name ?? '—', value: (p) => p.accountId ?? '',
    },
    { key: 'type', label: 'Type', edit: 'select', options: TYPES, view: (p) => chip(p.type), value: (p) => p.type },
    { key: 'startDate', label: 'Start date', edit: 'date', view: (p) => <span className="num">{shortDate(p.startDate)}</span>, value: (p) => p.startDate ?? '' },
    { key: 'endDate', label: 'End date', edit: 'date', view: (p) => <span className="num">{shortDate(p.endDate)}</span>, value: (p) => p.endDate ?? '' },
  ]

  async function saveProject(d: Draft, p: Project | null) {
    const name = text(d, 'name')
    const body = {
      name, type: d.type, accountId: nullIfBlank(String(d.accountId)),
      startDate: nullIfBlank(text(d, 'startDate')), endDate: nullIfBlank(text(d, 'endDate')),
    }
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw new Error('The end date is before the start date.')
    if (p) {
      if (!name) throw new Error('Give the project a name.')
      await api.patch(`/projects/${p.id}`, body)
    } else {
      const code = text(d, 'code').toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      if (!code) throw new Error('Give the project a short ID, like ACME.')
      if (projects.some((x) => x.code === code)) throw new Error(`Project ID ${code} already exists.`)
      if (!name) throw new Error('Give the project a name.')
      await api.post('/projects', { ...body, code })
    }
    refresh('projects', 'tasks', 'timesheet')
  }

  // ---- resources ----
  const resourceColumns: Column<Resource>[] = [
    { key: 'name', label: 'Name', edit: 'text', view: (r) => r.name, value: (r) => r.name },
    { key: 'contractor', label: '1099 contractor', edit: 'checkbox', view: (r) => (r.contractor ? chip('Yes', true) : chip('No')), value: (r) => r.contractor },
    { key: 'email', label: 'Email', edit: 'text', view: (r) => r.email, value: (r) => r.email },
    { key: 'phone', label: 'Phone', edit: 'text', view: (r) => r.phone, value: (r) => r.phone },
    { key: 'address', label: 'Address', edit: 'text', view: (r) => r.address, value: (r) => r.address },
    { key: 'city', label: 'City', edit: 'text', view: (r) => r.city, value: (r) => r.city },
    { key: 'state', label: 'State', edit: 'text', view: (r) => r.state, value: (r) => r.state },
    { key: 'zip', label: 'Zip', edit: 'text', view: (r) => r.zip, value: (r) => r.zip },
    { key: 'active', label: 'Active', edit: 'checkbox', view: (r) => activeChip(r.active), value: (r) => r.active },
  ]

  async function saveResource(d: Draft, r: Resource | null) {
    const name = text(d, 'name')
    if (!name) throw new Error('Give the resource a name.')
    if (resources.some((x) => x.id !== r?.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already a resource.`)
    const email = text(d, 'email')
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Check the email address.')
    const body = {
      name, email, contractor: !!d.contractor, active: !!d.active,
      phone: text(d, 'phone'), address: text(d, 'address'), city: text(d, 'city'), state: text(d, 'state'), zip: text(d, 'zip'),
    }
    if (r) await api.patch(`/resources/${r.id}`, body)
    else await api.post('/resources', body)
    refresh('resources', 'timesheet', 'timesheets')
  }

  // ---- vehicles ----
  const vehicleColumns: Column<Vehicle>[] = [
    { key: 'name', label: 'Vehicle', edit: 'text', view: (v) => v.name, value: (v) => v.name },
    { key: 'startOdometer', label: 'Jan 1 odometer', edit: 'number', numeric: true, view: (v) => odo(v.startOdometer), value: (v) => (v.startOdometer == null ? '' : String(v.startOdometer)) },
    { key: 'active', label: 'Active', edit: 'checkbox', view: (v) => activeChip(v.active), value: (v) => v.active },
  ]

  async function saveVehicle(d: Draft, v: Vehicle | null) {
    const name = text(d, 'name')
    if (!name) throw new Error('Give the vehicle a name.')
    if (vehicles.some((x) => x.id !== v?.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already listed.`)
    const body = { name, active: !!d.active, startOdometer: text(d, 'startOdometer') ? numberFrom(d, 'startOdometer', 'Odometer') : null }
    if (v) await api.patch(`/vehicles/${v.id}`, body)
    else await api.post('/vehicles', body)
    refresh('vehicles', 'trips')
  }

  // ---- mileage rates ----
  const rateColumns: Column<RateRow>[] = [
    { key: 'date', label: 'Effective from', edit: 'date', newOnly: true, view: (r) => <span className="num">{shortDate(r.date)}</span>, value: (r) => r.date },
    { key: 'business', label: 'Business $/mile', edit: 'number', numeric: true, view: (r) => (r.business == null ? '—' : frate(r.business)), value: (r) => (r.business == null ? '' : String(r.business)) },
    { key: 'charitable', label: 'Charitable $/mile', edit: 'number', numeric: true, view: (r) => (r.charitable == null ? '—' : frate(r.charitable)), value: (r) => (r.charitable == null ? '' : String(r.charitable)) },
  ]

  async function saveRate(d: Draft, r: RateRow | null) {
    const date = r ? r.date : text(d, 'date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick the date the rate takes effect.')
    if (!r && rateRows.some((x) => x.date === date)) throw new Error('A rate already starts on that date. Edit it instead.')
    const business = numberFrom(d, 'business', 'Business rate')
    const charitable = numberFrom(d, 'charitable', 'Charitable rate')
    if (business > 5 || charitable > 5) throw new Error('Enter rates in dollars per mile, like 0.725.')
    await api.put(`/mileage-rates/business/${date}`, { ratePerMile: business })
    await api.put(`/mileage-rates/charitable/${date}`, { ratePerMile: charitable })
    refresh('mileage-rates')
  }

  const nextTaskNumber = Math.max(500, ...tasks.map((t) => t.taskNumber)) + 1

  return (
    <>
      <div>
        <div className="eyebrow">Rates, budgets and people</div>
        <h1>Setup</h1>
      </div>

      <EditableTable title="Tasks" addLabel="Add task" minWidth={1040}
        description="A task is the line a resource logs time to. Its bill rate and 1099 rate drive billing value and cost. Bill rate 0 marks the task as internal. The client comes from the project's account."
        columns={taskColumns} rows={[...tasks].sort((a, b) => a.taskNumber - b.taskNumber)} rowId={(t) => t.id}
        newRow={() => ({
          taskNumber: String(nextTaskNumber), name: '', projectId: [...projects].sort(byName)[0]?.id ?? '', billRate: '0', costRate: '0',
          budgetHours: '0', type: 'T&M', resourceId: [...resources].sort(byName)[0]?.id ?? '', active: true,
        })}
        onSave={saveTask} />

      <EditableTable title="Projects" addLabel="Add project" description="Projects group tasks for budget tracking. The account is the client that tasks on the project bill to."
        columns={projectColumns} rows={[...projects].sort(byName)} rowId={(p) => p.id}
        newRow={() => ({ code: '', name: '', accountId: '', type: 'T&M', startDate: today(), endDate: '' })}
        onSave={saveProject} />

      <EditableTable title="Resources" addLabel="Add resource" minWidth={900}
        description="Consultants and contractors who log time. Inactive resources drop off the timesheet's list."
        columns={resourceColumns} rows={[...resources].sort(byName)} rowId={(r) => r.id}
        newRow={() => ({ name: '', contractor: false, email: '', phone: '', address: '', city: '', state: '', zip: '', active: true })}
        onSave={saveResource} />

      <EditableTable title="Vehicles" addLabel="Add vehicle"
        description="Cars used for business trips. The January 1 odometer reading anchors each car's total miles for the year."
        columns={vehicleColumns} rows={[...vehicles].sort(byName)} rowId={(v) => v.id}
        newRow={() => ({ name: '', startOdometer: '', active: true })}
        onSave={saveVehicle} />

      <EditableTable title="Mileage rates" addLabel="Add rate"
        description="IRS standard rates. A trip uses the latest rate whose effective date is on or before the trip date."
        columns={rateColumns} rows={rateRows} rowId={(r) => r.date}
        newRow={() => ({ date: today(), business: '0', charitable: '0.14' })}
        onSave={saveRate} />
    </>
  )
}
