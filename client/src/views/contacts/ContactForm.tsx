import { useState } from 'react'
import { RELATIONSHIPS, type Account, type Contact, type ContactInput } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { today } from '../../lib/format.ts'
import { accountMatcher, useContactMutations } from './data.ts'

// Same fields and order as the prototype's contact form. `wide` fields take two columns.
const FIELDS: [key: string, label: string, wide?: boolean][] = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['nickname', 'Nickname'], ['company', 'Company'], ['title', 'Job title'],
  ['email0', 'Email'], ['email1', 'Email 2'], ['email2', 'Email 3'],
  ['mobile', 'Mobile phone'], ['businessPhone', 'Business phone'], ['homePhone', 'Home phone'], ['otherPhone', 'Other phone'],
  ['businessAddress', 'Business address', true], ['homeAddress', 'Home address', true],
  ['website', 'Website'], ['birthday', 'Birthday'], ['keywords', 'Keywords'], ['tags', 'Tags (comma separated)'], ['source', 'Source'],
]
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function initialValues(c?: Contact): Record<string, string> {
  const v: Record<string, string> = {}
  for (const [k] of FIELDS) {
    if (k.startsWith('email')) v[k] = c?.emails[Number(k.slice(5))] ?? ''
    else if (k === 'tags') v[k] = (c?.tags ?? []).join(', ')
    else v[k] = c ? String(c[k as keyof Contact] ?? '') : k === 'source' ? 'Manual' : ''
  }
  v.notes = c?.notes ?? ''
  return v
}

/** Add or edit a contact. Leave `contact` out to create one. */
export function ContactForm({ contact, accounts, onDone }: { contact?: Contact; accounts: Account[]; onDone: (saved?: Contact) => void }) {
  const toast = useToast()
  const { create, update } = useContactMutations()
  const [kind, setKind] = useState(contact?.kind === 'company' ? 'company' : 'person')
  const [relationship, setRelationship] = useState(contact?.relationship ?? '')
  const [v, setV] = useState(() => initialValues(contact))
  const saving = create.isPending || update.isPending
  const set = (k: string, value: string) => setV((old) => ({ ...old, [k]: value }))
  const g = (k: string) => (v[k] ?? '').trim()

  async function save() {
    const first = g('firstName'), last = g('lastName'), company = g('company')
    const name = kind === 'company' ? company || [first, last].filter(Boolean).join(' ') : [first, last].filter(Boolean).join(' ')
    if (!name) return toast(kind === 'company' ? 'Enter the company name.' : 'Enter a first or last name.')
    const emails = [g('email0'), g('email1'), g('email2')].filter(Boolean)
    const bad = emails.find((e) => !EMAIL.test(e))
    if (bad) return toast(`“${bad}” doesn't look like an email address.`)

    // Link to the account the company name points to (by name or alias), as the prototype does.
    const account = accountMatcher(accounts)(kind === 'company' ? name : company)
    const body: ContactInput = {
      kind, name, firstName: first, lastName: last, nickname: g('nickname'), company, title: g('title'), emails,
      mobile: g('mobile'), businessPhone: g('businessPhone'), homePhone: g('homePhone'), otherPhone: g('otherPhone'),
      businessAddress: g('businessAddress'), homeAddress: g('homeAddress'), website: g('website'), birthday: g('birthday'),
      keywords: g('keywords'), tags: g('tags').split(',').map((t) => t.trim()).filter(Boolean), source: g('source'),
      relationship, notes: (v.notes ?? '').trim(), accountId: account?.id ?? null,
    }
    try {
      const saved = contact
        ? await update.mutateAsync({ id: contact.id, ...body })
        : await create.mutateAsync({ ...body, dateAdded: today() })
      toast('Contact saved')
      onDone(saved)
    } catch (e) {
      toast("Couldn't save the contact. " + (e as Error).message)
    }
  }

  return (
    <>
      <div className="panel-h">
        <h2>{contact ? 'Edit ' + contact.name : 'New contact'}</h2>
        <span className="spacer" />
        <button className="btn sm" onClick={() => onDone()} disabled={saving}>Cancel</button>
        <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      <form className="tform" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="lbl">Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="person">Person</option>
            <option value="company">Company only</option>
          </select>
        </label>
        <label className="lbl">Relationship
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}>
            <option value="">Not set</option>
            {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
            {relationship && !(RELATIONSHIPS as readonly string[]).includes(relationship) && <option>{relationship}</option>}
          </select>
        </label>
        {FIELDS.map(([k, label, wide], i) => (
          <label key={k} className={'lbl' + (wide ? ' wide' : '')}>{label}
            <input className="field" value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} autoFocus={i === 0}
              list={k === 'company' ? 'accountNames' : undefined} inputMode={k.startsWith('email') ? 'email' : undefined} />
          </label>
        ))}
        <datalist id="accountNames">{accounts.map((a) => <option key={a.id} value={a.name} />)}</datalist>
        <label className="lbl full">Notes<textarea className="field" rows={4} value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
        <button type="submit" hidden />
      </form>
    </>
  )
}
