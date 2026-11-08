import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError, type One } from '../../api/client.ts'
import type { Resource, Timesheet, TimesheetStatus } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { addDays, DAYS, fh2, fm, fmi, md, pct, today, weekLabel } from '../../lib/format.ts'
import { HourCell } from './HourCell.tsx'
import { sheetKey, useAccountsList, useProjects, useResourceTasks, useSheet, useWeekTrips } from './data.ts'

interface Line {
  taskId: string
  note: string
  hours: number[]
  billed: boolean[]
}

const ZERO7 = () => [0, 0, 0, 0, 0, 0, 0]
const toLines = (s: Timesheet): Line[] =>
  s.lines.map((l) => ({ taskId: l.taskId, note: l.note, hours: [...l.hours], billed: [...l.billed] }))

const STATUS_LABEL: Record<TimesheetStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', returned: 'Returned' }
const SAVE_DELAY_MS = 700

const timeNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function TimesheetSheet({ resource, week }: { resource: Resource; week: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const key = useMemo(() => sheetKey(resource.id, week), [resource.id, week])
  const sheetQ = useSheet(resource.id, week)
  const tasks = useResourceTasks(resource.id).data
  const projects = useProjects().data
  const accounts = useAccountsList().data
  const trips = useWeekTrips(resource.id, week).data ?? []

  // Unsaved edits live here; null means "show what the server has".
  const [edits, setEdits] = useState<Line[] | null>(null)
  const latest = useRef<Line[]>([])
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const inflight = useRef<Promise<void> | null>(null)
  const [sync, setSync] = useState('')
  const [confirm, setConfirm] = useState<null | 'submit' | 'return'>(null)
  const [returnNote, setReturnNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [addTask, setAddTask] = useState('')
  const [td] = useState(today)

  const server = sheetQ.data
  const lines = useMemo(() => edits ?? (server ? toLines(server) : []), [edits, server])
  const status: TimesheetStatus = server?.status ?? 'draft'
  const locked = status === 'submitted' || status === 'approved'

  // ---- saving ----------------------------------------------------------------------------

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    while (inflight.current) await inflight.current
    if (!dirty.current) return
    dirty.current = false
    setSync('Saving…')
    const body = { lines: latest.current.map(({ taskId, note, hours }) => ({ taskId, note, hours })) }
    const run = api.put<One<Timesheet>>(`/resources/${resource.id}/timesheets/${week}`, body).then(
      (res) => {
        qc.setQueryData(key, res.data)
        if (!dirty.current) setEdits(null)
        setSync('Saved ' + timeNow())
      },
      async (e: Error) => {
        // The server refused (for example, the sheet was submitted elsewhere or hours are invoiced).
        // Show why, drop the unsaved edits and reload what the server has.
        toast("Couldn't save: " + e.message)
        setSync('Not saved')
        setEdits(null)
        await qc.invalidateQueries({ queryKey: key })
      },
    ).finally(() => {
      inflight.current = null
    })
    inflight.current = run
    await run
  }, [qc, toast, key, resource.id, week])

  function edit(next: Line[], immediately = false) {
    latest.current = next
    dirty.current = true
    setEdits(next)
    setSync('Unsaved changes…')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), immediately ? 0 : SAVE_DELAY_MS)
  }

  // Save anything pending when leaving this week or person, and warn before closing the tab.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || inflight.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      if (dirty.current) void save()
    }
  }, [save])

  // ---- task details for each line --------------------------------------------------------------

  const info = useMemo(() => {
    const projectById = new Map((projects ?? []).map((p) => [p.id, p]))
    const accountById = new Map((accounts ?? []).map((a) => [a.id, a]))
    const out = new Map<string, { name: string; number: number; billRate: number; project: string; client: string; active: boolean }>()
    for (const l of server?.lines ?? []) {
      out.set(l.taskId, { name: l.taskName, number: l.taskNumber, billRate: l.billRate, project: l.projectName, client: l.accountName ?? '', active: l.taskActive })
    }
    for (const t of tasks ?? []) {
      const p = projectById.get(t.projectId)
      const a = p?.accountId ? accountById.get(p.accountId) : undefined
      out.set(t.id, { name: t.name, number: t.taskNumber, billRate: t.billRate, project: p?.name ?? '', client: a?.name ?? '', active: t.active })
    }
    return out
  }, [server, tasks, projects, accounts])

  const totals = useMemo(() => {
    const day = ZERO7()
    let hours = 0, billable = 0, value = 0
    for (const l of lines) {
      const rate = info.get(l.taskId)?.billRate ?? 0
      l.hours.forEach((h, i) => {
        day[i]! += h
        hours += h
        value += h * rate
        if (rate > 0) billable += h
      })
    }
    return { day, hours, billable, value }
  }, [lines, info])

  const available = useMemo(() => {
    const used = new Set(lines.map((l) => l.taskId))
    const groups = new Map<string, { id: string; label: string }[]>()
    for (const t of [...(tasks ?? [])].sort((a, b) => a.taskNumber - b.taskNumber)) {
      if (!t.active || used.has(t.id)) continue
      const i = info.get(t.id)
      const group = i?.project || 'Other'
      groups.set(group, [...(groups.get(group) ?? []), { id: t.id, label: `${t.name}${i?.client ? ' — ' + i.client : ''}` }])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tasks, lines, info])

  // ---- actions ----------------------------------------------------------------------------------

  const setHours = (row: number, day: number, h: number) =>
    edit(lines.map((l, i) => (i === row ? { ...l, hours: l.hours.map((x, d) => (d === day ? h : x)) } : l)))
  const setNote = (row: number, note: string) => edit(lines.map((l, i) => (i === row ? { ...l, note } : l)))
  const removeLine = (row: number) => {
    if (lines[row]!.billed.some(Boolean)) return toast("This line has hours on an invoice, so it can't be removed.")
    edit(lines.filter((_, i) => i !== row), true)
  }
  const addLine = () => {
    if (!addTask) return toast('Pick a task to add.')
    edit([...lines, { taskId: addTask, note: '', hours: ZERO7(), billed: [false, false, false, false, false, false, false] }], true)
    setAddTask('')
  }

  /** Saves pending edits, then runs a request that returns the updated sheet. */
  async function run(request: () => Promise<One<Timesheet>>, done: () => string) {
    setBusy(true)
    try {
      await save()
      const res = await request()
      qc.setQueryData(key, res.data)
      setEdits(null)
      qc.invalidateQueries({ queryKey: ['timesheets'] })
      toast(done())
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't do that. Try again.")
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const sheetId = () => qc.getQueryData<Timesheet>(key)?.id
  const act = (action: 'submit' | 'recall' | 'approve' | 'return' | 'reopen', body?: object) =>
    run(async () => {
      const id = sheetId()
      if (!id) throw new ApiError(409, 'Add some hours first.')
      return api.post<One<Timesheet>>(`/timesheets/${id}/${action}`, body)
    }, () => ({ submit: 'Timesheet submitted', recall: 'Back to draft', approve: 'Approved', return: 'Returned to resource', reopen: 'Reopened for edits' })[action])

  // copy-previous reports how many lines it added, so it gets its own message.
  async function onCopyPrevious() {
    setBusy(true)
    try {
      await save()
      const res = await api.post<One<Timesheet> & { added: number; copiedFrom: string }>(`/resources/${resource.id}/timesheets/${week}/copy-previous`)
      qc.setQueryData(key, res.data)
      setEdits(null)
      toast(res.added ? `Added ${res.added} line${res.added > 1 ? 's' : ''} from ${weekLabel(res.copiedFrom)}` : 'Those lines are already here.')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't copy. Try again.")
    } finally {
      setBusy(false)
    }
  }

  // ---- render -------------------------------------------------------------------------------------

  if (sheetQ.isPending) return <section className="panel empty">Loading {weekLabel(week)}…</section>
  if (sheetQ.isError) return <section className="panel empty"><h2>Couldn't load this week</h2><p className="note">{sheetQ.error.message}</p></section>

  const statusNote =
    status === 'submitted' ? 'Waiting for approval. Hours are locked.'
    : status === 'approved' ? `Approved${server?.approvedAt ? ' on ' + new Date(server.approvedAt).toLocaleDateString() : ''}. Hours are locked.`
    : status === 'returned' ? `Returned for changes${server?.returnNote ? `: “${server.returnNote}”` : ''}. Edit and resubmit.`
    : 'Hours save automatically as you type. Enter decimals (1.5) or h:mm (1:30).'

  const miles = trips.reduce((s, t) => s + t.miles, 0)

  return (
    <section className="panel">
      <div className="panel-h">
        <span className={'pill st-' + status}>{STATUS_LABEL[status]}</span>
        <span className="note">{statusNote}</span>
        <span className="spacer" />
        {sync && <span className="note" aria-live="polite">{sync}</span>}
        {!locked && (
          <>
            <button className="btn" onClick={onCopyPrevious} disabled={busy}>Copy lines from last week</button>
            <button className="btn primary" onClick={() => setConfirm('submit')} disabled={busy || !totals.hours}>Submit week</button>
          </>
        )}
        {status === 'submitted' && (
          <>
            <button className="btn good" onClick={() => act('approve')} disabled={busy}>Approve</button>
            <button className="btn" onClick={() => setConfirm('return')} disabled={busy}>Return</button>
            <button className="btn" onClick={() => act('recall')} disabled={busy}>Recall to draft</button>
          </>
        )}
        {status === 'approved' && <button className="btn" onClick={() => act('reopen')} disabled={busy}>Reopen</button>}
      </div>

      {confirm === 'submit' && (
        <div className="confirm">
          <strong>Submit {fh2(totals.hours)} hours for {weekLabel(week)}?</strong>
          <span className="note">Hours lock until an approver returns the sheet.</span>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button className="btn primary" onClick={() => act('submit')} disabled={busy}>Submit</button>
        </div>
      )}
      {confirm === 'return' && (
        <div className="confirm">
          <strong>Return this timesheet?</strong>
          <input className="field" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Reason (optional)"
            style={{ flex: 1, minWidth: 180 }} autoFocus />
          <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
          <button className="btn primary" onClick={() => act('return', { note: returnNote.trim() })} disabled={busy}>Return to resource</button>
        </div>
      )}

      <div className="scroll">
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: '26%' }}>Project / Task</th>
              {DAYS.map((n, i) => {
                const date = addDays(week, i)
                return (
                  <th key={n} className={'day' + (i > 4 ? ' we' : '') + (date === td ? ' today' : '')}>
                    {n}<small>{md(date)}</small>
                  </th>
                )
              })}
              <th className="n">Total</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length ? lines.map((l, row) => {
              const t = info.get(l.taskId)
              const name = t?.name ?? 'Task (removed)'
              return (
                <tr key={l.taskId}>
                  <td>
                    <span>{name}</span>{' '}
                    {(t?.billRate ?? 0) > 0 ? <span className="chip bill">Billable</span> : <span className="chip">Internal</span>}
                    <span className="sub">{[t?.project, t?.client, t ? '#' + t.number : ''].filter(Boolean).join(' · ')}</span>
                  </td>
                  {l.hours.map((h, day) => (
                    <td key={day} className={'cell' + (day > 4 ? ' we' : '')}>
                      <HourCell value={h} row={row} day={day} label={`${name} ${DAYS[day]}`}
                        disabled={locked || l.billed[day]!} title={l.billed[day] ? 'On an invoice' : undefined}
                        onChange={(v) => setHours(row, day, v)} />
                    </td>
                  ))}
                  <td className="n num rt">{fh2(l.hours.reduce((s, h) => s + h, 0))}</td>
                  <td>
                    <input className="memo" value={l.note} onChange={(e) => setNote(row, e.target.value)}
                      placeholder={locked ? '' : 'Add note'} aria-label={`Note for ${name}`} disabled={locked} />
                  </td>
                  <td>{!locked && <button className="btn quiet sm" aria-label="Remove line" onClick={() => removeLine(row)}>✕</button>}</td>
                </tr>
              )
            }) : (
              <tr><td colSpan={11} className="empty">No lines on this timesheet yet. Add a task below or copy last week's lines.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Daily total</td>
              {totals.day.map((v, i) => <td key={i} className={'n num dt' + (v > 12 ? ' over' : '')} style={{ textAlign: 'center' }}>{fh2(v)}</td>)}
              <td className="n num">{fh2(totals.hours)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {!locked && (
        <div className="addline">
          <select value={addTask} onChange={(e) => setAddTask(e.target.value)} aria-label="Task to add">
            <option value="">Add a task line…</option>
            {available.map(([project, ts]) => (
              <optgroup key={project} label={project}>
                {ts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="btn" onClick={addLine}>Add line</button>
          {tasks && !available.length && <span className="note">Every task assigned to {resource.name} is on this sheet.</span>}
        </div>
      )}

      <div className="stats">
        {([
          ['Week total', fh2(totals.hours) + ' h'],
          ['Billable', fh2(totals.billable) + ' h'],
          ['Internal', fh2(totals.hours - totals.billable) + ' h'],
          ['Utilization', totals.hours ? pct(totals.billable / totals.hours) : '—'],
          ['Billing value', fm(totals.value)],
        ] as const).map(([k, v]) => <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
        <div className="stat">
          <div className="k">Mileage</div>
          <div className="v">
            {fmi(miles)} mi{' '}
            <button className="btn quiet sm" style={{ verticalAlign: 'middle' }} onClick={() => navigate('/mileage')}>
              {trips.length} trip{trips.length === 1 ? '' : 's'} ›
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
