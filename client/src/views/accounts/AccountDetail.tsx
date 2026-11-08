import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ACTIVITY_TYPES, type Account, type ActivityType, type Stage } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { addDays, fh2, fm, fmi, initials, md, parse, shortDate, today } from '../../lib/format.ts'
import { AccountForm } from './AccountForm.tsx'
import {
  useAccountActivities, useAccountContacts, useAccountMutations, useAccountOpportunities, useAccountSummary, useActivityMutations,
} from './data.ts'

const stageClass = (s: Stage) =>
  s === 'Won' ? 'st-approved' : s === 'Lost' ? 'st-returned' : s === 'Verbally Committed' || s === 'Proposal Sent' ? 'st-submitted' : 'st-draft'

function Field({ label, value, copy }: { label: string; value: string | null | undefined; copy?: boolean }) {
  const toast = useToast()
  if (!value) return null
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span className="v">
        {value}
        {copy && (
          <>
            {' '}
            <button className="btn quiet sm" aria-label={`Copy ${label}`}
              onClick={() => navigator.clipboard.writeText(value).then(() => toast('Copied'), () => toast("Couldn't copy"))}>
              Copy
            </button>
          </>
        )}
      </span>
    </div>
  )
}

export function AccountDetail({ account: a, accounts }: { account: Account; accounts: Account[] }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const summary = useAccountSummary(a.id).data
  const people = useAccountContacts(a.id).data ?? []
  const activities = useAccountActivities(a.id).data ?? []
  const opps = useAccountOpportunities(a.id).data ?? []
  const { update, remove } = useAccountMutations()
  const log = useActivityMutations(a.id)

  const [td] = useState(today)
  const year = summary?.year
  const [noteDate, setNoteDate] = useState(td)
  const [noteType, setNoteType] = useState<ActivityType>('Note')
  const [noteText, setNoteText] = useState('')

  if (editing) return <AccountForm account={a} accounts={accounts} onDone={() => setEditing(false)} />

  const setFollowUp = (value: string | null) =>
    update.mutate({ id: a.id, followUp: value }, {
      onSuccess: () => toast(value ? 'Follow-up set for ' + parse(value).toLocaleDateString() : 'Follow-up cleared'),
      onError: (e) => toast("Couldn't save. " + e.message),
    })

  const addNote = () => {
    const body = noteText.trim()
    if (!body) return toast('Write the note first.')
    log.add.mutate({ activityDate: noteDate || td, type: noteType, body }, {
      onSuccess: () => { setNoteText(''); toast('Note added') },
      onError: (e) => toast("Couldn't add the note. " + e.message),
    })
  }

  const doDelete = () =>
    remove.mutate(a.id, {
      onSuccess: () => { toast('Account deleted'); navigate('/accounts') },
      onError: (e) => { setConfirmDelete(false); toast("Couldn't delete the account. " + e.message) },
    })

  const followUpLabel = a.followUp
    ? parse(a.followUp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      (a.followUp < td ? ' · overdue' : a.followUp === td ? ' · today' : '')
    : 'None set'
  const sortedLog = [...activities].sort((x, y) => y.activityDate.localeCompare(x.activityDate) || y.createdAt.localeCompare(x.createdAt))
  const sortedPeople = [...people].sort((x, y) => (x.name || x.lastName).localeCompare(y.name || y.lastName))
  const personName = (p: (typeof people)[number]) => p.name || [p.firstName, p.lastName].filter(Boolean).join(' ') || '(no name)'

  return (
    <>
      <div className="panel-h">
        <span className="cav lg co" aria-hidden="true">{initials(a.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ fontSize: 18 }}>{a.name}</h2>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {a.type ? <span className={'chip' + (a.type === 'Client' ? ' bill' : '')}>{a.type}</span> : <span className="note">Type not set</span>}
            {a.source && <span className="chip">From {a.source}</span>}
          </div>
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
      </div>

      {confirmDelete && (
        <div className="confirm">
          <strong>Delete {a.name}?</strong>
          <span className="note">Contacts, projects and trips stay; they just stop linking here.</span>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn danger" onClick={doDelete} disabled={remove.isPending}>Delete account</button>
        </div>
      )}

      <div className="stats">
        {([
          ['People', summary ? summary.people : '…'],
          ['Hours this year', summary ? fh2(summary.hoursYear) : '…'],
          ['Billing value this year', summary ? fm(summary.valueYear) : '…'],
          ['Miles this year', summary ? fmi(summary.milesYear) : '…'],
          ['Last activity', summary ? shortDate(summary.lastActivity) : '…'],
        ] as const).map(([k, v]) => (
          <div className="stat" key={k}><div className="k">{k}</div><div className="v" style={{ fontSize: 16 }}>{v}</div></div>
        ))}
      </div>

      <div className="cbody">
        <div className={'followup' + (a.followUp && a.followUp <= td ? ' due' : '')}>
          <div><span className="k">Next follow-up</span><b>{followUpLabel}</b></div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setFollowUp(addDays(td, 7))}>In 1 week</button>
            <button className="btn sm" onClick={() => setFollowUp(addDays(td, 30))}>In 1 month</button>
            <button className="btn sm" onClick={() => setFollowUp(addDays(td, 90))}>In 3 months</button>
            <input type="date" className="field" value={a.followUp ?? ''} aria-label="Follow-up date" style={{ padding: '3px 6px' }}
              onChange={(e) => e.target.value && setFollowUp(e.target.value)} />
            {a.followUp && <button className="btn quiet sm" onClick={() => setFollowUp(null)}>Clear</button>}
          </div>
        </div>

        <div className="cgrid">
          <div>
            <Field label="Phone" value={a.phone} copy />
            <Field label="Website" value={a.website} copy />
            <Field label="Billing contact" value={a.billingAttn} />
            <Field label="Billing email" value={a.billingEmail} copy />
            <Field label="Address" value={a.address} />
            <Field label="Keywords" value={a.keywords} />
            <Field label="Category" value={a.category} />
            {a.aliases.length > 0 && (
              <div className="kv">
                <span className="k">Also matches</span>
                <span className="v">{a.aliases.map((x) => <span className="chip" key={x} style={{ margin: '0 4px 4px 0' }}>{x}</span>)}</span>
              </div>
            )}
            <Field label="Added" value={a.dateAdded ? shortDate(a.dateAdded) : ''} />
            {a.notes && <div className="kv"><span className="k">Notes</span><span className="v notes">{a.notes}</span></div>}

            <div style={{ marginTop: 14 }}>
              <h3 className="h3">Opportunities ({opps.length})</h3>
              <ul className="tl">
                {opps.length ? opps.map((o) => (
                  <li key={o.id}>
                    <span>{o.name}</span>
                    <span className={'pill ' + stageClass(o.stage)} style={{ marginLeft: 'auto' }}>{o.stage}</span>
                    <span className="num">{fm(o.value)}</span>
                  </li>
                )) : <li className="note">No opportunities yet.</li>}
              </ul>
            </div>

            <h3 className="h3" style={{ marginTop: 14 }}>People ({people.length})</h3>
            <ul className="tl">
              {sortedPeople.length ? sortedPeople.map((p) => (
                <li key={p.id}>
                  <span>{personName(p)}</span>
                  <span className="note">{[p.title, p.company !== a.name ? p.company : ''].filter(Boolean).join(' · ')}</span>
                </li>
              )) : <li className="note">No contacts are linked to this account yet.</li>}
            </ul>
          </div>

          <div>
            <h3 className="h3">Notes &amp; activity</h3>
            <form className="logform" onSubmit={(e) => { e.preventDefault(); addNote() }}>
              <input type="date" className="field" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} aria-label="Date" />
              <select value={noteType} onChange={(e) => setNoteType(e.target.value as ActivityType)} aria-label="Type">
                {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <input className="field" value={noteText} onChange={(e) => setNoteText(e.target.value)}
                placeholder="Meeting notes, proposal sent, renewal…" aria-label="Activity note" />
              <button className="btn primary sm" disabled={log.add.isPending}>Add</button>
            </form>
            <ul className="tl">
              {sortedLog.length ? sortedLog.map((x) => (
                <li key={x.id}>
                  <span className="num">{md(x.activityDate)}/{x.activityDate.slice(2, 4)}</span>
                  <span className="chip">{x.type}</span>
                  <span>{x.body}</span>
                  <button className="btn quiet sm" aria-label="Remove entry"
                    onClick={() => log.remove.mutate(x.id, { onSuccess: () => toast('Entry removed') })}>✕</button>
                </li>
              )) : <li className="note">No activity logged yet.</li>}
            </ul>

            {summary && summary.tasks.length > 0 && (
              <>
                <h3 className="h3">Timesheet work</h3>
                <div className="scroll">
                  <table>
                    <thead><tr><th>Task</th><th className="n">Rate</th><th className="n">Hours {year}</th><th className="n">All time</th></tr></thead>
                    <tbody>
                      {summary.tasks.map((t) => (
                        <tr key={t.taskId}>
                          <td>{t.name}<span className="sub">{t.projectName} · {t.resourceName}</span></td>
                          <td className="n num">{t.billRate ? fm(t.billRate) : '—'}</td>
                          <td className="n num">{fh2(t.hoursYear)}</td>
                          <td className="n num">{fh2(t.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {summary && summary.trips > 0 && (
              <>
                <h3 className="h3" style={{ marginTop: 12 }}>Mileage</h3>
                <p className="note" style={{ margin: 0 }}>{summary.trips} trips logged, {fmi(summary.milesYear)} miles this year.</p>
              </>
            )}
          </div>
        </div>
        <div><button className="btn quiet sm danger" onClick={() => setConfirmDelete(true)}>Delete account</button></div>
      </div>
    </>
  )
}
