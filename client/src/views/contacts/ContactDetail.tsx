import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Account, Contact } from '../../api/types.ts'
import { ActivityLog } from '../../components/ActivityLog.tsx'
import { Field } from '../../components/Field.tsx'
import { FollowUp } from '../../components/FollowUp.tsx'
import { useToast } from '../../components/toast-context.ts'
import { fm, fmi, md, norm, parse, shortDate } from '../../lib/format.ts'
import { stageClass } from '../../lib/stages.ts'
import { ContactForm } from './ContactForm.tsx'
import { contactInitials, isCompany, useContactMutations, useContactSummary } from './data.ts'

export function ContactDetail({ contact: c, contacts, accounts, account }: {
  contact: Contact
  contacts: Contact[]
  accounts: Account[]
  account: Account | undefined
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const summary = useContactSummary(c.id).data
  const { update, remove } = useContactMutations()

  if (editing) return <ContactForm contact={c} accounts={accounts} onDone={() => setEditing(false)} />

  const setFollowUp = (value: string | null) =>
    update.mutate({ id: c.id, followUp: value }, {
      onSuccess: () => toast(value ? 'Follow-up set for ' + parse(value).toLocaleDateString() : 'Follow-up cleared'),
      onError: (e) => toast("Couldn't save. " + e.message),
    })

  const doDelete = () =>
    remove.mutate(c.id, {
      onSuccess: () => { toast('Contact deleted'); navigate('/contacts') },
      onError: (e) => { setConfirmDelete(false); toast("Couldn't delete the contact. " + e.message) },
    })

  const phones = ([['Mobile', c.mobile], ['Business', c.businessPhone], ['Home', c.homePhone], ['Other', c.otherPhone]] as const).filter(([, v]) => v)
  const people = isCompany(c) ? contacts.filter((x) => !isCompany(x) && norm(x.company) && norm(x.company) === norm(c.name)) : []
  const trips = summary?.trips ?? []
  const opps = summary?.opportunities ?? []

  return (
    <>
      <div className="panel-h">
        <span className={'cav lg' + (isCompany(c) ? ' co' : '')} aria-hidden="true">{contactInitials(c)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ fontSize: 18 }}>
            {c.name}
            {c.nickname && <> <span className="note">“{c.nickname}”</span></>}
          </h2>
          <div className="note">{[c.title, c.company].filter(Boolean).join(' at ') || (isCompany(c) ? 'Company' : '')}</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            {account && (
              <button className="btn sm" onClick={() => navigate('/accounts/' + account.id)}>
                {account.type === 'Client' ? 'Client' : 'Account'}: {account.name} ›
              </button>
            )}
            {c.relationship && <span className="chip">{c.relationship}</span>}
            {c.tags.map((t) => <span className="chip" key={t}>{t}</span>)}
            {c.source && <span className="chip">From {c.source}</span>}
          </div>
        </div>
        <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
      </div>

      {confirmDelete && (
        <div className="confirm">
          <strong>Delete {c.name}?</strong>
          <span className="note">Their notes and activity go too. This can't be undone.</span>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn danger" onClick={doDelete} disabled={remove.isPending}>Delete contact</button>
        </div>
      )}

      <div className="cbody">
        <FollowUp value={c.followUp} onChange={setFollowUp} />

        <div className="cgrid">
          <div>
            {c.emails.map((e, i) => <Field key={e + i} label={i ? `Email ${i + 1}` : 'Email'} value={e} copy />)}
            {phones.map(([l, v]) => <Field key={l} label={`${l} phone`} value={v} copy />)}
            <Field label="Business address" value={c.businessAddress} />
            <Field label="Home address" value={c.homeAddress} />
            <Field label="Website" value={c.website} />
            <Field label="Birthday" value={c.birthday} />
            <Field label="Keywords" value={c.keywords} />
            <Field label="Category" value={c.category} />
            <Field label="Added" value={c.dateAdded ? shortDate(c.dateAdded) : ''} />
            <Field label="Last contacted" value={summary?.lastActivity ? shortDate(summary.lastActivity) : ''} />
            {!c.emails.length && !phones.length && <p className="note">No email or phone on file.</p>}
            {c.notes && <div className="kv"><span className="k">Notes</span><span className="v notes">{c.notes}</span></div>}
            {people.length > 0 && (
              <div className="kv">
                <span className="k">People here</span>
                <span className="v">
                  {people.map((p) => <button key={p.id} className="btn quiet sm" onClick={() => navigate('/contacts/' + p.id)}>{p.name}</button>)}
                </span>
              </div>
            )}
          </div>

          <div>
            <ActivityLog parent={{ contactId: c.id }} placeholder="Add a note or what you talked about" />

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

            {trips.length > 0 && (
              <>
                <h3 className="h3">Mileage trips ({trips.length})</h3>
                <ul className="tl">
                  {trips.slice(0, 8).map((t) => (
                    <li key={t.id}>
                      <span className="num">{md(t.tripDate)}/{t.tripDate.slice(2, 4)}</span>
                      <span>{t.purpose}</span>
                      <span className="num" style={{ marginLeft: 'auto' }}>{fmi(t.miles)} mi</span>
                    </li>
                  ))}
                  {trips.length > 8 && <li className="note">and {trips.length - 8} more</li>}
                </ul>
              </>
            )}
          </div>
        </div>
        <div style={{ paddingTop: 8 }}><button className="btn quiet sm danger" onClick={() => setConfirmDelete(true)}>Delete contact</button></div>
      </div>
    </>
  )
}
