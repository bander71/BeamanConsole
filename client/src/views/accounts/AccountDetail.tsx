import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Account } from '../../api/types.ts'
import { ActivityLog } from '../../components/ActivityLog.tsx'
import { Field } from '../../components/Field.tsx'
import { FollowUp } from '../../components/FollowUp.tsx'
import { useToast } from '../../components/toast-context.ts'
import { fh2, fm, fmi, initials, parse, shortDate } from '../../lib/format.ts'
import { stageClass } from '../../lib/stages.ts'
import { AccountForm } from './AccountForm.tsx'
import { useAccountContacts, useAccountMutations, useAccountOpportunities, useAccountSummary } from './data.ts'

export function AccountDetail({ account: a, accounts }: { account: Account; accounts: Account[] }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const summary = useAccountSummary(a.id).data
  const people = useAccountContacts(a.id).data ?? []
  const opps = useAccountOpportunities(a.id).data ?? []
  const { update, remove } = useAccountMutations()
  const year = summary?.year

  if (editing) return <AccountForm account={a} accounts={accounts} onDone={() => setEditing(false)} />

  const setFollowUp = (value: string | null) =>
    update.mutate({ id: a.id, followUp: value }, {
      onSuccess: () => toast(value ? 'Follow-up set for ' + parse(value).toLocaleDateString() : 'Follow-up cleared'),
      onError: (e) => toast("Couldn't save. " + e.message),
    })

  const doDelete = () =>
    remove.mutate(a.id, {
      onSuccess: () => { toast('Account deleted'); navigate('/accounts') },
      onError: (e) => { setConfirmDelete(false); toast("Couldn't delete the account. " + e.message) },
    })

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
        <FollowUp value={a.followUp} onChange={setFollowUp} />

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
                    <button className="btn quiet sm" onClick={() => navigate('/pipeline/' + o.id)}>{o.name}</button>
                    <span className={'pill ' + stageClass(o.stage)} style={{ marginLeft: 'auto' }}>{o.stage}</span>
                    <span className="num">{fm(o.value)}</span>
                  </li>
                )) : <li className="note">No opportunities yet.</li>}
              </ul>
              <button className="btn sm" onClick={() => navigate('/pipeline/new?account=' + a.id)}>New opportunity</button>
            </div>

            <h3 className="h3" style={{ marginTop: 14 }}>People ({people.length})</h3>
            <ul className="tl">
              {sortedPeople.length ? sortedPeople.map((p) => (
                <li key={p.id}>
                  <button className="btn quiet sm" onClick={() => navigate('/contacts/' + p.id)}>{personName(p)}</button>
                  <span className="note">{[p.title, p.company !== a.name ? p.company : ''].filter(Boolean).join(' · ')}</span>
                </li>
              )) : <li className="note">No contacts are linked to this account yet.</li>}
            </ul>
          </div>

          <div>
            <ActivityLog parent={{ accountId: a.id }} placeholder="Meeting notes, proposal sent, renewal…" />

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
