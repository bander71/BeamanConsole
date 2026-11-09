import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, getAll } from '../../api/client.ts'
import type { TimesheetStatus, TimesheetSummary } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { fh2, fm, weekLabel } from '../../lib/format.ts'

const STATUS_LABEL: Record<TimesheetStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', returned: 'Returned' }
const STORE_KEY = 'bc.approvals.showAll'

function rememberedShowAll() {
  try {
    return localStorage.getItem(STORE_KEY) === '1'
  } catch {
    return false
  }
}

/** Timesheets waiting for approval (or every timesheet), with approve and return. */
export function ApprovalsView() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(rememberedShowAll)
  const [returning, setReturning] = useState<TimesheetSummary | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const listQ = useQuery({
    queryKey: ['timesheets', 'list', { showAll }],
    queryFn: () => getAll<TimesheetSummary>('/timesheets', showAll ? {} : { status: 'submitted' }),
  })
  const sheets = listQ.data ?? []

  function toggleShowAll(on: boolean) {
    setShowAll(on)
    try {
      localStorage.setItem(STORE_KEY, on ? '1' : '0')
    } catch {
      // Remembering the choice is only a convenience.
    }
  }

  async function act(s: TimesheetSummary, action: 'approve' | 'return', body?: object) {
    setBusy(s.id)
    try {
      await api.post(`/timesheets/${s.id}/${action}`, body)
      toast(action === 'approve' ? `Approved ${s.resourceName}, ${weekLabel(s.weekStart)}` : 'Returned to resource')
      setReturning(null)
      setNote('')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
      // Refresh this list, the Approvals count, and the sheet if it's open on the Timesheet screen.
      qc.invalidateQueries({ queryKey: ['timesheets'] })
      qc.invalidateQueries({ queryKey: ['timesheet', s.resourceId, s.weekStart] })
    }
  }

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Review</div>
          <h1>Approvals</h1>
        </div>
        <span className="spacer" />
        <label className="row note">
          <input type="checkbox" checked={showAll} onChange={(e) => toggleShowAll(e.target.checked)} /> Show every timesheet
        </label>
      </div>

      <section className="panel">
        {returning && (
          <div className="confirm">
            <strong>Return {returning.resourceName}'s timesheet for {weekLabel(returning.weekStart)}?</strong>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)"
              style={{ flex: 1, minWidth: 180 }} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && act(returning, 'return', { note: note.trim() })} />
            <button className="btn" onClick={() => { setReturning(null); setNote('') }}>Cancel</button>
            <button className="btn primary" disabled={busy === returning.id} onClick={() => act(returning, 'return', { note: note.trim() })}>
              Return to resource
            </button>
          </div>
        )}
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Week</th>
                <th>Status</th>
                <th className="n">Hours</th>
                <th className="n">Billable</th>
                <th className="n">Billing value</th>
                <th className="n">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listQ.isPending ? (
                <tr><td colSpan={8} className="empty">Loading timesheets…</td></tr>
              ) : listQ.isError ? (
                <tr><td colSpan={8} className="empty">Couldn't load timesheets. {listQ.error.message}</td></tr>
              ) : sheets.length ? sheets.map((s) => (
                <tr key={s.id}>
                  <td>{s.resourceName}</td>
                  <td>{weekLabel(s.weekStart)}</td>
                  <td>
                    <span className={'pill st-' + s.status}>{STATUS_LABEL[s.status]}</span>
                    {s.status === 'returned' && s.returnNote && <span className="sub">“{s.returnNote}”</span>}
                  </td>
                  <td className="n num">{fh2(s.totalHours)}</td>
                  <td className="n num">{fh2(s.billableHours)}</td>
                  <td className="n num">{fm(s.billValue)}</td>
                  <td className="n num">{fm(s.cost)}</td>
                  <td className="n">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button className="btn sm" onClick={() => navigate(`/timesheet?resource=${s.resourceId}&week=${s.weekStart}`)}>Open</button>
                      {s.status === 'submitted' && (
                        <>
                          <button className="btn sm good" disabled={busy === s.id} onClick={() => act(s, 'approve')}>Approve</button>
                          <button className="btn sm" disabled={busy === s.id} onClick={() => { setReturning(s); setNote('') }}>Return</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="empty">{showAll ? 'No timesheets yet.' : 'Nothing waiting for approval.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
