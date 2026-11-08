import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ACCOUNT_TYPES, type Account, type AccountStats } from '../../api/types.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { fh2, fm, initials, today } from '../../lib/format.ts'
import { AccountDetail } from './AccountDetail.tsx'
import { AccountForm } from './AccountForm.tsx'
import { useAccounts, useAccountStats } from './data.ts'

type Sort = 'name' | 'type' | 'billing' | 'people' | 'touch'
const SORTS: [Sort, string][] = [
  ['name', 'Sort by name'],
  ['type', 'Group by type'],
  ['billing', 'Billings this year'],
  ['people', 'Most people'],
  ['touch', 'Last activity'],
]

const NO_STATS: AccountStats = {
  accountId: '', people: 0, hours: 0, hoursYear: 0, valueYear: 0, milesYear: 0, tripsYear: 0, trips: 0, lastActivity: null,
}
const NO_ACCOUNTS: Account[] = []

export function AccountsView() {
  const { id: selectedId } = useParams()
  const navigate = useNavigate()
  const accountsQ = useAccounts()
  const statsQ = useAccountStats()
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [creating, setCreating] = useState(false)

  const accounts = accountsQ.data ?? NO_ACCOUNTS
  const stats = statsQ.data
  const statFor = (a: Account) => stats?.get(a.id) ?? NO_STATS
  const [td] = useState(today)
  const isDue = (a: Account) => !!a.followUp && a.followUp <= td

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of accounts) c[a.type ?? 'none'] = (c[a.type ?? 'none'] ?? 0) + 1
    return c
  }, [accounts])
  const due = accounts.filter(isDue).length
  const clientBillings = accounts.filter((a) => a.type === 'Client').reduce((s, a) => s + statFor(a).valueYear, 0)

  const list = useMemo(() => {
    const statFor = (a: Account) => stats?.get(a.id) ?? NO_STATS
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const L = accounts.filter((a) => {
      if (type === 'none' && a.type) return false
      if (type === 'followup' && !(a.followUp && a.followUp <= td)) return false
      if (type && type !== 'none' && type !== 'followup' && a.type !== type) return false
      if (words.length) {
        const hay = [a.name, a.aliases.join(' '), a.type, a.keywords, a.category, a.notes, a.website, a.phone, a.address].join(' ').toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
    const byName = (x: Account, y: Account) => x.name.localeCompare(y.name)
    const typeRank = (a: Account) => (a.type ? ACCOUNT_TYPES.indexOf(a.type) : 99)
    const sorters: Record<Sort, (x: Account, y: Account) => number> = {
      name: byName,
      type: (x, y) => typeRank(x) - typeRank(y) || byName(x, y),
      billing: (x, y) => statFor(y).valueYear - statFor(x).valueYear || byName(x, y),
      people: (x, y) => statFor(y).people - statFor(x).people || byName(x, y),
      touch: (x, y) => (statFor(y).lastActivity ?? '').localeCompare(statFor(x).lastActivity ?? '') || byName(x, y),
    }
    return L.sort(sorters[sort])
  }, [accounts, stats, q, type, sort, td])

  const selected = accounts.find((a) => a.id === selectedId)

  function exportCsv() {
    const cols = ['Name', 'Type', 'Phone', 'Website', 'Address', 'Keywords', 'Category', 'Also Matches', 'People', 'Hours This Year',
      'Billing Value This Year', 'Miles This Year', 'Last Activity', 'Next Follow-up', 'Notes', 'Source', 'Date Added']
    const rows = list.map((a) => {
      const s = statFor(a)
      return [a.name, a.type ?? '', a.phone, a.website, a.address, a.keywords, a.category, a.aliases.join('; '), s.people,
        s.hoursYear.toFixed(2), s.valueYear.toFixed(2), s.milesYear.toFixed(1), s.lastActivity ?? '', a.followUp ?? '', a.notes, a.source, a.dateAdded ?? '']
    })
    downloadCsv(`beaman-accounts_${td}.csv`, cols, rows)
  }

  if (accountsQ.isPending) return <div className="panel empty">Loading accounts…</div>
  if (accountsQ.isError) return <div className="panel empty"><h2>Couldn't load accounts</h2><p className="note">{accountsQ.error.message}</p></div>

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Companies and organizations</div>
          <h1>Accounts</h1>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export (CSV)</button>
        <button className="btn primary" onClick={() => setCreating(true)}>Add account</button>
      </div>

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {([
            ['Accounts', accounts.length],
            ['Clients', counts.Client ?? 0],
            ['Client billings this year', stats ? fm(clientBillings) : '…'],
            ['Follow-ups due', due],
            ['Not yet classified', counts.none ?? 0],
          ] as const).map(([k, v]) => (
            <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
          ))}
        </div>
      </section>

      <div className="row">
        <input className="field" type="search" placeholder="Search accounts, keywords, notes…" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="Search accounts" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t} ({counts[t] ?? 0})</option>)}
          <option value="none">Not classified ({counts.none ?? 0})</option>
          <option value="followup">Follow-up due ({due})</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="cwrap">
        <section className="panel clistp">
          <div className="panel-h"><span className="note">{list.length} of {accounts.length}</span></div>
          <div className="clist">
            {list.length ? list.map((a) => {
              const s = statFor(a)
              const bits = [
                s.people ? `${s.people} ${s.people === 1 ? 'person' : 'people'}` : '',
                s.valueYear ? fm(s.valueYear) + ' this year' : s.hoursYear ? fh2(s.hoursYear) + ' h this year' : '',
              ].filter(Boolean).join(' · ')
              return (
                <button key={a.id} className={'crow' + (a.id === selectedId ? ' sel' : '')}
                  onClick={() => { setCreating(false); navigate('/accounts/' + a.id) }}>
                  <span className="cav co" aria-hidden="true">{initials(a.name)}</span>
                  <span className="cmain">
                    <b>{a.name}</b>
                    <span className="sub">{bits || a.keywords || 'No linked people or work yet'}</span>
                  </span>
                  <span className="cchips">
                    {isDue(a) && <span className="pill st-submitted">Follow up</span>}
                    {a.type && <span className={'chip' + (a.type === 'Client' ? ' bill' : '')}>{a.type}</span>}
                  </span>
                </button>
              )
            }) : <div className="empty">No accounts match.</div>}
          </div>
        </section>
        <section className="panel cdetail">
          {creating ? (
            <AccountForm accounts={accounts} onDone={(saved) => { setCreating(false); if (saved) navigate('/accounts/' + saved.id) }} />
          ) : selected ? (
            <AccountDetail key={selected.id} account={selected} accounts={accounts} />
          ) : (
            <div className="empty">
              <h2>{selectedId ? 'Account not found' : 'Pick an account'}</h2>
              <p className="note" style={{ margin: '8px auto 0' }}>Select a company to see its people, project work, mileage and activity.</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
