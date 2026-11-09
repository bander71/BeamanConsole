import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, qs, type List } from '../../api/client.ts'
import type { TimesheetStatus } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { DAYS, fh2, fm, md, parse, pct, shortDate } from '../../lib/format.ts'
import { isAllTime, RANGE_LABELS, rangeDates, type Range } from '../../lib/periods.ts'

type GroupBy = 'client' | 'project' | 'resource' | 'task'

interface Summary {
  hours: number
  billableHours: number
  utilization: number | null
  value: number
  cost: number
  margin: number
  marginPct: number | null
}
interface TimeReport {
  totals: Summary
  groups: (Summary & { name: string })[]
}
interface Entry {
  timeEntryId: string
  workDate: string
  resourceName: string
  accountName: string | null
  projectCode: string
  projectName: string
  taskNumber: number
  taskName: string
  taskType: string
  hours: number
  billRate: number
  costRate: number
  billable: boolean
  value: number
  cost: number
  timesheetStatus: TimesheetStatus
  billed: boolean
  note: string
}

const RANGES: Range[] = ['week', 'lastweek', 'month', 'lastmonth', 'ytd', 'all', 'custom']
const GROUPS: [GroupBy, string][] = [['client', 'Client'], ['project', 'Project'], ['resource', 'Resource'], ['task', 'Task']]
const STATUS_LABEL: Record<TimesheetStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', returned: 'Returned' }
/** The prototype lists the newest 300 day-lines on screen; the CSV has them all. */
const SHOWN = 300

const entriesPage = (from: string, to: string, limit: number, offset: number) =>
  api.get<List<Entry>>('/reports/time/entries' + qs({ from, to, limit, offset }))

async function allEntries(from: string, to: string) {
  const out: Entry[] = []
  for (let offset = 0; ; offset += 5000) {
    const page = await entriesPage(from, to, 5000, offset)
    out.push(...page.data)
    if (out.length >= page.total || !page.data.length) return out
  }
}

/** Hours, billings and margin by client, project, resource or task, with the day-lines behind them. */
export function ReportsView() {
  const toast = useToast()
  const [range, setRange] = useState<Range>('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [group, setGroup] = useState<GroupBy>('client')
  const [exporting, setExporting] = useState(false)
  const period = rangeDates(range, custom.from, custom.to)
  const [from, to] = period
  const all = isAllTime(period)

  const reportQ = useQuery({
    queryKey: ['reports', 'time', from, to, group],
    queryFn: async () => (await api.get<{ data: TimeReport }>('/reports/time' + qs({ from, to, groupBy: group }))).data,
    staleTime: 0,
  })
  const entriesQ = useQuery({ queryKey: ['reports', 'timeEntries', from, to], queryFn: () => entriesPage(from, to, SHOWN, 0), staleTime: 0 })

  const R = reportQ.data
  const T = R?.totals
  const entries = entriesQ.data?.data ?? []
  const count = entriesQ.data?.total ?? 0
  const label = GROUPS.find(([g]) => g === group)![1]

  async function exportCsv() {
    setExporting(true)
    try {
      const E = (await allEntries(from, to)).sort((x, y) => x.workDate.localeCompare(y.workDate) || x.resourceName.localeCompare(y.resourceName))
      const cols = ['date', 'resource', 'client', 'projectId', 'project', 'taskId', 'task', 'type', 'hours', 'billable', 'billRate', 'rate1099', 'value', 'cost', 'status', 'note']
      const rows = E.map((e) => [
        e.workDate, e.resourceName, e.accountName ?? '', e.projectCode, e.projectName, e.taskNumber, e.taskName, e.taskType, e.hours, e.billable,
        e.billRate, e.costRate, e.value.toFixed(2), e.cost.toFixed(2), e.timesheetStatus, e.note,
      ])
      downloadCsv(`beaman-time_${all ? 'all' : from + '_to_' + to}.csv`, cols, rows)
      toast('CSV ready')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const cells = (v: Summary) => (
    <>
      <td className="n num">{fh2(v.hours)}</td>
      <td className="n num">{fh2(v.billableHours)}</td>
      <td className="n num">{v.hours ? pct(v.utilization) : '—'}</td>
      <td className="n num">{fm(v.value)}</td>
      <td className="n num">{fm(v.cost)}</td>
      <td className="n num">{fm(v.margin)}</td>
      <td className="n num">{v.value ? pct(v.marginPct) : '—'}</td>
    </>
  )

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Hours, billings and margin</div>
          <h1>Reports</h1>
        </div>
      </div>
      <div className="row">
        <label className="lbl">
          Period
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label className="lbl">
              From
              <input type="date" className="field" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label className="lbl">
              To
              <input type="date" className="field" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </>
        )}
        <label className="lbl">
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
            {GROUPS.map(([g, l]) => (
              <option key={g} value={g}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button className="btn" disabled={exporting || !count} onClick={exportCsv}>
          Export entries (CSV)
        </button>
      </div>

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {(
            [
              ['Hours', T && fh2(T.hours)],
              ['Billable hours', T && fh2(T.billableHours)],
              ['Utilization', T && (T.hours ? pct(T.utilization) : '—')],
              ['Billing value', T && fm(T.value)],
              ['Contractor cost', T && fm(T.cost)],
              ['Margin', T && fm(T.margin)],
            ] as const
          ).map(([k, v]) => (
            <div className="stat" key={k}>
              <div className="k">{k}</div>
              <div className="v">{v ?? '…'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>By {group}</h2>
          <span className="note">{all ? 'All dates' : `${shortDate(from)} – ${shortDate(to)}`}</span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                <th className="n">Hours</th>
                <th className="n">Billable h</th>
                <th className="n">Utilization</th>
                <th className="n">Billing value</th>
                <th className="n">Cost</th>
                <th className="n">Margin</th>
                <th className="n">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {reportQ.isError && (
                <tr>
                  <td colSpan={8} className="note">
                    Couldn't load the report: {reportQ.error.message}
                  </td>
                </tr>
              )}
              {R?.groups.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  {cells(g)}
                </tr>
              ))}
              {R && !R.groups.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    No hours in this period.
                  </td>
                </tr>
              )}
            </tbody>
            {R && R.groups.length > 0 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  {cells(R.totals)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>Entries</h2>
          <span className="note">
            {count} day-lines{count > SHOWN ? `; the newest ${SHOWN} are shown, and the CSV has them all` : ''}
          </span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Resource</th>
                <th>Client</th>
                <th>Project</th>
                <th>Task</th>
                <th className="n">Hours</th>
                <th className="n">Value</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.timeEntryId}>
                  <td className="num">
                    {md(e.workDate)}{' '}
                    <span className="sub" style={{ display: 'inline' }}>
                      {DAYS[(parse(e.workDate).getDay() + 6) % 7]}
                    </span>
                  </td>
                  <td>{e.resourceName}</td>
                  <td>{e.accountName}</td>
                  <td>{e.projectName}</td>
                  <td>{e.taskName}</td>
                  <td className="n num">{fh2(e.hours)}</td>
                  <td className="n num">{e.value ? fm(e.value) : '—'}</td>
                  <td>
                    <span className={'pill st-' + e.timesheetStatus}>{STATUS_LABEL[e.timesheetStatus]}</span>
                  </td>
                  <td className="note">{e.note}</td>
                </tr>
              ))}
              {entriesQ.isSuccess && !entries.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    No entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="note">
        Billing value uses each task's current bill rate; Flat Fee work is shown at its hourly-equivalent value. Days are counted Monday through Sunday.
      </p>
    </>
  )
}
