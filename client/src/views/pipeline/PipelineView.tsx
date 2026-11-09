import { useMemo, useState, type DragEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { STAGES, type Account, type Contact, type Employee, type Opportunity, type Stage } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { fm, iso, md, pct, today } from '../../lib/format.ts'
import { isOpen, STAGE_PROBABILITY } from '../../lib/stages.ts'
import { useAccounts } from '../accounts/data.ts'
import { useContacts } from '../contacts/data.ts'
import { useProjects } from '../timesheet/data.ts'
import { OpportunityDrawer } from './OpportunityDrawer.tsx'
import { employeeInitials, employeeName, useEmployees, useOppContacts, useOpportunities, useOpportunityMutations } from './data.ts'

const NO_OPPS: Opportunity[] = []
const NO_ACCOUNTS: Account[] = []
const NO_CONTACTS: Contact[] = []
const NO_EMPLOYEES: Employee[] = []
const deals = (n: number) => `${n} ${n === 1 ? 'deal' : 'deals'}`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function PipelineView() {
  const { id } = useParams() // an opportunity id, or "new"
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const oppsQ = useOpportunities()
  const links = useOppContacts().data
  const accounts = useAccounts().data ?? NO_ACCOUNTS
  const contacts = useContacts().data ?? NO_CONTACTS
  const employeesQ = useEmployees()
  const employees = employeesQ.data ?? NO_EMPLOYEES
  const projects = useProjects().data ?? []
  const { move } = useOpportunityMutations()
  const [q, setQ] = useState('')
  const [rep, setRep] = useState('')
  const [dragOver, setDragOver] = useState<Stage | null>(null)
  const [td] = useState(today)

  const opps = oppsQ.data ?? NO_OPPS
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  const list = useMemo(() => {
    const words = q.trim().toLowerCase()
    return opps.filter((o) => (!rep || o.repId === rep) && (!words ||
      [o.name, accountById.get(o.accountId ?? '')?.name, o.description, employeeName(employeeById.get(o.repId ?? ''))]
        .join(' ').toLowerCase().includes(words)))
  }, [opps, q, rep, accountById, employeeById])

  const stats = useMemo(() => {
    const yr = td.slice(0, 4)
    const open = list.filter((o) => isOpen(o.stage))
    const won = list.filter((o) => o.stage === 'Won' && (o.wonAt ?? o.targetClose ?? '').startsWith(yr))
    const lost = list.filter((o) => o.stage === 'Lost' && (o.closedAt ?? o.targetClose ?? '').startsWith(yr))
    const d = new Date(Number(yr), Number(td.slice(5, 7)) - 1, 1)
    const quarterEnd = iso(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0))
    const closing = open.filter((o) => o.targetClose && o.targetClose <= quarterEnd)
    return [
      ['Open pipeline', fm(sum(open.map((o) => o.value))), deals(open.length)],
      ['Weighted', fm(sum(open.map((o) => o.value * STAGE_PROBABILITY[o.stage]))), 'by stage likelihood'],
      ['Closing this quarter', fm(sum(closing.map((o) => o.value))), deals(closing.length)],
      ['Won ' + yr, fm(sum(won.map((o) => o.value))), deals(won.length)],
      ['Win rate ' + yr, won.length + lost.length ? pct(won.length / (won.length + lost.length)) : '—', `${won.length} won, ${lost.length} lost`],
    ] as const
  }, [list, td])

  function moveTo(oppId: string, stage: Stage) {
    const o = opps.find((x) => x.id === oppId)
    if (!o || o.stage === stage) return
    move.mutate(
      { id: oppId, stage, ...(stage === 'Won' && !o.wonAt ? { wonAt: td } : {}), ...(stage === 'Lost' ? { closedAt: td } : {}) },
      { onSuccess: () => toast(`Moved to ${stage}`), onError: (e) => toast("Couldn't move it. " + e.message) },
    )
  }

  const onDrop = (e: DragEvent, stage: Stage) => {
    e.preventDefault()
    setDragOver(null)
    moveTo(e.dataTransfer.getData('text/plain'), stage)
  }

  const isNew = id === 'new'
  const selected = id && !isNew ? opps.find((o) => o.id === id) : undefined
  const close = () => navigate('/pipeline')

  if (oppsQ.isPending) return <div className="panel empty">Loading pipeline…</div>
  if (oppsQ.isError) return <div className="panel empty"><h2>Couldn't load the pipeline</h2><p className="note">{oppsQ.error.message}</p></div>

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Sales</div>
          <h1>Pipeline</h1>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => navigate('/pipeline/new')}>New opportunity</button>
      </div>

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {stats.map(([k, v, s]) => (
            <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="sub">{s}</div></div>
          ))}
        </div>
      </section>

      <div className="row">
        <input className="field" type="search" placeholder="Search deals, accounts, notes…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200 }} aria-label="Search opportunities" />
        <select value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Sales rep">
          <option value="">All sales reps</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
        </select>
        <span className="note">Drag cards between stages, or open one to edit.</span>
      </div>

      <div className="board">
        {STAGES.map((stage) => {
          const cards = list.filter((o) => o.stage === stage).sort((a, b) => (a.targetClose ?? '9').localeCompare(b.targetClose ?? '9'))
          const p = STAGE_PROBABILITY[stage]
          return (
            <section key={stage} className={'ocol' + (dragOver === stage ? ' over' : '')} data-stage={stage} aria-label={stage}
              onDragOver={(e) => { e.preventDefault(); setDragOver(stage) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
              onDrop={(e) => onDrop(e, stage)}>
              <header>
                <div><b>{stage}</b> <span className="note">{cards.length}</span></div>
                <div className="num note">{fm(sum(cards.map((o) => o.value)))}{p && p < 1 ? ` · ${Math.round(p * 100)}%` : ''}</div>
              </header>
              <div className="ocards">
                {cards.length ? cards.map((o) => {
                  const late = !!o.targetClose && o.targetClose < td && isOpen(stage)
                  const ids = links?.get(o.id) ?? []
                  const rep = employeeById.get(o.repId ?? '')
                  return (
                    <article key={o.id} className={'ocard' + (o.id === id ? ' sel' : '')} draggable tabIndex={0} data-opp={o.id}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging') }}
                      onDragEnd={(e) => { e.currentTarget.classList.remove('dragging'); setDragOver(null) }}
                      onClick={() => navigate('/pipeline/' + o.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), navigate('/pipeline/' + o.id))}>
                      <b>{o.name}</b>
                      <span className="sub">
                        {accountById.get(o.accountId ?? '')?.name ?? 'No account'}
                        {ids.length > 0 && ' · ' + (ids.length === 1 ? contactById.get(ids[0]!)?.name ?? '1 contact' : `${ids.length} contacts`)}
                      </span>
                      <div className="ofoot">
                        <span className="num ov">{fm(o.value)}</span>
                        <span className={'num' + (late ? ' late' : '')}>
                          {o.targetClose ? `${late ? 'Overdue ' : ''}${md(o.targetClose)}/${o.targetClose.slice(2, 4)}` : 'No date'}
                        </span>
                        {o.projectId && <span className="chip bill">Project</span>}
                        <span className="cav sm" title={employeeName(rep) || 'No sales rep'}>{employeeInitials(rep)}</span>
                      </div>
                    </article>
                  )
                }) : <div className="odrop">Drag a card here</div>}
              </div>
            </section>
          )
        })}
      </div>

      {/* The panel picks its default sales rep from the employee list, so wait for it. */}
      {(isNew || selected) && !employeesQ.isPending && (
        <OpportunityDrawer key={selected?.id ?? 'new'} opp={selected}
          seed={{ accountId: params.get('account') ?? undefined, contactId: params.get('contact') ?? undefined }}
          contactIds={selected ? links?.get(selected.id) ?? [] : []}
          accounts={accounts} contacts={contacts} employees={employees} projects={projects}
          onClose={close} onCreated={(newId) => navigate('/pipeline/' + newId, { replace: true })} />
      )}
      {id && !isNew && !selected && (
        <div className="panel empty"><h2>Opportunity not found</h2><p className="note">It may have been deleted.</p></div>
      )}
    </>
  )
}
