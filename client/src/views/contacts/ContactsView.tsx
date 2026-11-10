import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { RELATIONSHIPS, type Contact } from '../../api/types.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { today } from '../../lib/format.ts'
import { useAccounts } from '../accounts/data.ts'
import { ContactDetail } from './ContactDetail.tsx'
import { ContactForm } from './ContactForm.tsx'
import { LinkedInImport } from './LinkedInImport.tsx'
import { accountMatcher, contactInitials, findDuplicates, isCompany, useContactLast, useContacts } from './data.ts'

type Sort = 'name' | 'company' | 'touch' | 'followup' | 'added'
const SORTS: [Sort, string][] = [
  ['name', 'Sort by last name'],
  ['company', 'Group by company'],
  ['touch', 'Last contacted'],
  ['followup', 'Next follow-up'],
  ['added', 'Recently added'],
]
const NO_CONTACTS: Contact[] = []

const sortKey = (c: Contact) => (isCompany(c) ? c.name : `${c.lastName || c.name} ${c.firstName}`).toLowerCase()
const companyOf = (c: Contact) => c.company || (isCompany(c) ? c.name : '')

export function ContactsView() {
  const { id: selectedId } = useParams()
  const navigate = useNavigate()
  const contactsQ = useContacts()
  const accounts = useAccounts().data
  const last = useContactLast().data
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [td] = useState(today)

  const contacts = contactsQ.data ?? NO_CONTACTS
  const accountFor = useMemo(() => accountMatcher(accounts ?? []), [accounts])
  const accountById = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a])), [accounts])
  const linkedAccount = useMemo(
    () => (c: Contact) => (c.accountId ? accountById.get(c.accountId) : undefined) ?? accountFor(companyOf(c)),
    [accountById, accountFor],
  )
  const dups = useMemo(() => findDuplicates(contacts), [contacts])
  const due = contacts.filter((c) => c.followUp && c.followUp <= td).length
  const sources = useMemo(() => [...new Set(contacts.map((c) => c.source).filter(Boolean))].sort(), [contacts])

  const shows: [string, string][] = [
    ['all', 'Everyone'], ['people', 'People'], ['clients', 'Linked to a client'], ['followup', `Follow-up due (${due})`],
    ['scheduled', 'Any follow-up set'], ['dups', `Possible duplicates (${dups.size})`],
    ...RELATIONSHIPS.map((r): [string, string] => ['rel:' + r, 'Relationship: ' + r]),
  ]

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const lastOf = (c: Contact) => last?.get(c.id) ?? ''
    const L = contacts.filter((c) => {
      if (show === 'people' && isCompany(c)) return false
      if (show === 'companies' && !isCompany(c)) return false
      if (show === 'clients' && !(c.relationship === 'Client' || linkedAccount(c)?.type === 'Client')) return false
      if (show === 'followup' && !(c.followUp && c.followUp <= td)) return false
      if (show === 'scheduled' && !c.followUp) return false
      if (show === 'dups' && !dups.has(c.id)) return false
      if (show.startsWith('rel:') && c.relationship !== show.slice(4)) return false
      if (source && c.source !== source) return false
      if (words.length) {
        const hay = [c.name, c.nickname, c.company, c.title, c.keywords, c.notes, c.emails.join(' '), c.mobile, c.otherPhone,
          c.homePhone, c.businessPhone, c.tags.join(' '), c.relationship].join(' ').toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
    const byKey = (a: Contact, b: Contact) => sortKey(a).localeCompare(sortKey(b))
    const sorters: Record<Sort, (a: Contact, b: Contact) => number> = {
      name: byKey,
      // Contacts with no company go last.
      company: (a, b) => Number(!companyOf(a)) - Number(!companyOf(b)) || companyOf(a).localeCompare(companyOf(b)) || byKey(a, b),
      added: (a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || byKey(a, b),
      followup: (a, b) => (a.followUp ?? '9999').localeCompare(b.followUp ?? '9999') || byKey(a, b),
      touch: (a, b) => lastOf(b).localeCompare(lastOf(a)) || byKey(a, b),
    }
    L.sort(sorters[sort])
    // When grouping by company, a heading goes before the first contact of each company.
    const groupOf = (c: Contact) => companyOf(c) || 'No company'
    return L.map((c, i) => ({
      c,
      header: sort === 'company' && (i === 0 || groupOf(L[i - 1]!) !== groupOf(c)) ? groupOf(c) : null,
    }))
  }, [contacts, q, show, source, sort, td, dups, last, linkedAccount])

  const selected = contacts.find((c) => c.id === selectedId)

  function exportCsv() {
    const cols = ['Name', 'First Name', 'Last Name', 'Type', 'Company', 'Job Title', 'Relationship', 'Email', 'Email 2', 'Email 3',
      'Mobile Phone', 'Business Phone', 'Home Phone', 'Other Phone', 'Business Address', 'Home Address', 'Website', 'Keywords', 'Tags',
      'Birthday', 'Next Follow-up', 'Last Contacted', 'Notes', 'Source', 'Date Added']
    const rows = list.map(({ c }) => [c.name, c.firstName, c.lastName, c.kind, c.company, c.title, c.relationship, c.emails[0], c.emails[1],
      c.emails[2], c.mobile, c.businessPhone, c.homePhone, c.otherPhone, c.businessAddress, c.homeAddress, c.website, c.keywords,
      c.tags.join(', '), c.birthday, c.followUp ?? '', last?.get(c.id) ?? '', c.notes, c.source, c.dateAdded ?? ''])
    downloadCsv(`beaman-contacts_${td}.csv`, cols, rows)
  }

  if (contactsQ.isPending) return <div className="panel empty">Loading contacts…</div>
  if (contactsQ.isError) return <div className="panel empty"><h2>Couldn't load contacts</h2><p className="note">{contactsQ.error.message}</p></div>

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">People and companies</div>
          <h1>Contacts</h1>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setImporting((v) => !v)}>Import from LinkedIn</button>
        <button className="btn" onClick={exportCsv}>Export (CSV)</button>
        <button className="btn primary" onClick={() => setCreating(true)}>Add contact</button>
      </div>

      {importing && <LinkedInImport onClose={() => setImporting(false)} />}

      <div className="row">
        <input className="field" type="search" placeholder="Search name, company, email, phone, notes…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="Search contacts" />
        <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
          {shows.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="cwrap">
        <section className="panel clistp">
          <div className="panel-h"><span className="note">{list.length} of {contacts.length}</span></div>
          <div className="clist">
            {list.length ? list.map(({ c, header }) => {
              const acct = linkedAccount(c)
              const isClient = acct?.type === 'Client'
              const sub = isCompany(c) ? c.keywords || 'Company' : [c.title, c.company].filter(Boolean).join(' · ')
              return (
                <Fragment key={c.id}>
                  {header && <div className="cgrp">{header}</div>}
                  <button className={'crow' + (c.id === selectedId ? ' sel' : '')}
                    onClick={() => { setCreating(false); navigate('/contacts/' + c.id) }}>
                    <span className={'cav' + (isCompany(c) ? ' co' : '')} aria-hidden="true">{contactInitials(c)}</span>
                    <span className="cmain">
                      <b>{c.name}</b>
                      <span className="sub">{sub || c.mobile || c.emails[0] || ''}</span>
                    </span>
                    <span className="cchips">
                      {c.followUp && c.followUp <= td && <span className="pill st-submitted">Follow up</span>}
                      {isClient ? <span className="chip bill">Client</span> : c.relationship ? <span className="chip">{c.relationship}</span> : null}
                    </span>
                  </button>
                </Fragment>
              )
            }) : <div className="empty">No contacts match.{q ? ' Try fewer words.' : ''}</div>}
          </div>
        </section>
        <section className="panel cdetail">
          {creating ? (
            <ContactForm accounts={accounts ?? []} onDone={(saved) => { setCreating(false); if (saved) navigate('/contacts/' + saved.id) }} />
          ) : selected ? (
            <ContactDetail key={selected.id} contact={selected} contacts={contacts} accounts={accounts ?? []} account={linkedAccount(selected)} />
          ) : (
            <div className="empty">
              <h2>{selectedId ? 'Contact not found' : 'Pick a contact'}</h2>
              <p className="note" style={{ margin: '8px auto 0' }}>Select someone on the left to see their details, log a conversation or set a follow-up.</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
