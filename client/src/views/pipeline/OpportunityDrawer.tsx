import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/client.ts'
import { STAGES, type Account, type Contact, type Employee, type Opportunity, type Project, type Stage } from '../../api/types.ts'
import { ActivityLog } from '../../components/ActivityLog.tsx'
import { useToast } from '../../components/toast-context.ts'
import { today } from '../../lib/format.ts'
import { stageClass } from '../../lib/stages.ts'
import { employeeName, useOpportunityMutations } from './data.ts'

/** Suggests a project code like the prototype: initials (or first letters) of the account, plus the year. */
function suggestCode(base: string, projects: Project[]) {
  const words = base.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  const stem = (words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'PRJ').slice(0, 4)).toUpperCase() + today().slice(2, 4)
  const taken = new Set(projects.map((p) => p.code))
  let code = stem
  for (let n = 2; taken.has(code); n++) code = `${stem}-${n}`
  return code
}

interface Props {
  opp?: Opportunity // undefined for a new one
  seed: { accountId?: string; contactId?: string }
  contactIds: string[]
  accounts: Account[]
  contacts: Contact[]
  employees: Employee[]
  projects: Project[]
  onClose: () => void
  onCreated: (id: string) => void
}

/** The side panel for one opportunity: details, contacts, convert to project, notes. */
export function OpportunityDrawer({ opp, seed, contactIds, accounts, contacts, employees, projects, onClose, onCreated }: Props) {
  const toast = useToast()
  const navigate = useNavigate()
  const { save, remove, convert } = useOpportunityMutations()
  const [name, setName] = useState(opp?.name ?? '')
  const [accountId, setAccountId] = useState(opp?.accountId ?? seed.accountId ?? '')
  const [stage, setStage] = useState<Stage>(opp?.stage ?? 'Lead')
  const [value, setValue] = useState(opp ? String(opp.value) : '')
  const [targetClose, setTargetClose] = useState(opp?.targetClose ?? '')
  const [repId, setRepId] = useState(opp?.repId ?? (opp ? '' : employees.find((e) => e.active)?.id ?? ''))
  const [type, setType] = useState(opp?.type ?? 'T&M')
  const [description, setDescription] = useState(opp?.description ?? '')
  const [linked, setLinked] = useState<string[]>(opp ? contactIds : seed.contactId ? [seed.contactId] : [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [converting, setConverting] = useState(false)

  // Escape closes the panel, as in the prototype.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const account = accounts.find((a) => a.id === accountId)
  const contactById = new Map(contacts.map((c) => [c.id, c]))
  const available = contacts.filter((c) => !linked.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name))
  const atAccount = accountId ? available.filter((c) => c.accountId === accountId) : []
  const others = available.filter((c) => !atAccount.includes(c))
  const reps = employees.filter((e) => e.active || e.id === opp?.repId)
    .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName))
  const project = opp?.projectId ? projects.find((p) => p.id === opp.projectId) : undefined

  async function onSave() {
    if (!name.trim()) return toast('Give the opportunity a name.')
    const v = value.trim() ? Number(value.replace(/[$,]/g, '')) : 0
    if (!Number.isFinite(v) || v < 0) return toast('Value must be a dollar amount.')
    const td = today()
    try {
      const saved = await save.mutateAsync({
        id: opp?.id, name: name.trim(), accountId: accountId || null, stage, value: v, targetClose: targetClose || null,
        repId: repId || null, type, description: description.trim(), contactIds: linked,
        // Record when a deal was won or lost, as the prototype does.
        ...(stage === 'Won' && opp?.stage !== 'Won' ? { wonAt: td } : {}),
        ...(stage === 'Lost' && opp?.stage !== 'Lost' ? { closedAt: td } : {}),
      })
      toast(opp ? 'Opportunity saved' : 'Opportunity created')
      if (!opp) onCreated(saved.id)
    } catch (e) {
      toast("Couldn't save. " + (e as Error).message)
    }
  }

  async function onDelete() {
    if (!opp) return
    try {
      await remove.mutateAsync(opp.id)
      toast('Opportunity deleted')
      onClose()
    } catch (e) {
      setConfirmDelete(false)
      toast("Couldn't delete. " + (e as Error).message)
    }
  }

  return (
    <div className="drawer">
      <div className="dback" onClick={onClose} />
      <aside className="dpanel" tabIndex={-1} aria-label="Opportunity">
        <div className="panel-h">
          <h2>{opp ? opp.name : 'New opportunity'}</h2>
          {opp && <span className={'pill ' + stageClass(opp.stage)}>{opp.stage}</span>}
          <span className="spacer" />
          <button className="btn quiet sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {confirmDelete && (
          <div className="confirm">
            <strong>Delete this opportunity?</strong>
            <span className="note">Its notes go too.</span>
            <span className="spacer" />
            <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn danger" onClick={onDelete} disabled={remove.isPending}>Delete</button>
          </div>
        )}

        <form className="tform" onSubmit={(e) => { e.preventDefault(); onSave() }}>
          <label className="lbl full">Opportunity name
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="ERP Phase 2 rollout" autoFocus={!opp} />
          </label>
          <label className="lbl wide">Account
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">No account</option>
              {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="lbl">Stage
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="lbl">Value ($)
            <input className="field num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="25000" />
          </label>
          <label className="lbl">Target close<input type="date" className="field" value={targetClose} onChange={(e) => setTargetClose(e.target.value)} /></label>
          <label className="lbl">Sales rep
            <select value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">Unassigned</option>
              {reps.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
            </select>
          </label>
          <label className="lbl">Engagement
            <select value={type} onChange={(e) => setType(e.target.value as 'T&M' | 'Flat Fee')}>
              <option>T&amp;M</option>
              <option>Flat Fee</option>
            </select>
          </label>
          <div className="lbl full">Contacts
            <div className="row" style={{ gap: 4 }}>
              {linked.length ? linked.map((id) => (
                <span className="cchip" key={id}>
                  <button type="button" className="btn quiet sm" onClick={() => navigate('/contacts/' + id)}>{contactById.get(id)?.name ?? 'Removed contact'}</button>
                  <button type="button" className="btn quiet sm" aria-label="Unlink contact" onClick={() => setLinked(linked.filter((x) => x !== id))}>✕</button>
                </span>
              )) : <span className="note">No contacts linked.</span>}
            </div>
            <select value="" aria-label="Add a contact" onChange={(e) => e.target.value && setLinked([...linked, e.target.value])}>
              <option value="">Add a contact…</option>
              {atAccount.length > 0 && (
                <optgroup label="At this account">
                  {atAccount.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ' — ' + c.company : ''}</option>)}
                </optgroup>
              )}
              <optgroup label="All contacts">
                {others.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ' — ' + c.company : ''}</option>)}
              </optgroup>
            </select>
          </div>
          <label className="lbl full">Description
            <textarea className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope, decision makers, next step" />
          </label>
          <button type="submit" hidden />
        </form>
        <div className="addline">
          {opp && <button className="btn quiet sm danger" onClick={() => setConfirmDelete(true)}>Delete</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onSave} disabled={save.isPending}>{opp ? 'Save changes' : 'Create opportunity'}</button>
        </div>

        {opp ? (
          <div className="cbody" style={{ borderTop: '1px solid var(--line-soft)' }}>
            <div className="convert">
              {opp.projectId ? (
                <>
                  <div><span className="k">Project</span><b>{project?.name ?? 'Project'}</b> <span className="note">{project?.code}</span></div>
                  <button className="btn sm" onClick={() => navigate('/budgets')}>Open budgets ›</button>
                  <button className="btn sm" onClick={() => navigate('/setup')}>Add tasks in Setup ›</button>
                </>
              ) : converting ? (
                <ConvertForm opp={opp} account={account} projects={projects} busy={convert.isPending}
                  onCancel={() => setConverting(false)}
                  onConvert={async (body) => {
                    try {
                      const res = await convert.mutateAsync({ id: opp.id, ...body })
                      toast(`Project ${res.project.code} created`)
                      setConverting(false)
                      setStage('Won')
                    } catch (e) {
                      toast(e instanceof ApiError && e.status === 409 ? e.message + '. Try a different project ID.' : "Couldn't create the project. " + (e as Error).message)
                    }
                  }} />
              ) : (
                <>
                  <div><span className="k">Ready to start work?</span><b>Turn this opportunity into a project</b></div>
                  <button className="btn good" onClick={() => setConverting(true)}>Convert to project</button>
                </>
              )}
            </div>
            <div><ActivityLog parent={{ opportunityId: opp.id }} placeholder="Add a note" /></div>
            <p className="note">
              Created {new Date(opp.createdAt).toLocaleDateString()} · updated {new Date(opp.updatedAt).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p className="note" style={{ padding: '0 14px 14px' }}>You can add notes once the opportunity is created.</p>
        )}
      </aside>
    </div>
  )
}

function ConvertForm({ opp, account, projects, busy, onCancel, onConvert }: {
  opp: Opportunity
  account: Account | undefined
  projects: Project[]
  busy: boolean
  onCancel: () => void
  onConvert: (body: { code: string; name: string; type: string; startDate: string }) => void
}) {
  const [code, setCode] = useState(() => suggestCode(account?.name ?? opp.name, projects))
  const [name, setName] = useState(opp.name)
  const [type, setType] = useState<string>(opp.type)
  const [startDate, setStartDate] = useState(today)
  const toast = useToast()

  const go = () => {
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    if (!c) return toast('Give the project a short ID, like MCE27.')
    if (projects.some((p) => p.code === c)) return toast(`Project ${c} already exists.`)
    if (!name.trim()) return toast('Give the project a name.')
    onConvert({ code: c, name: name.trim(), type, startDate: startDate || today() })
  }

  return (
    <div className="tform" style={{ padding: 0, flex: 1 }}>
      <label className="lbl">Project ID<input className="field" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <label className="lbl wide">Project name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="lbl">Type
        <select value={type} onChange={(e) => setType(e.target.value)}><option>T&amp;M</option><option>Flat Fee</option></select>
      </label>
      <label className="lbl">Start date<input type="date" className="field" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
      <div className="row full" style={{ gap: 6, gridColumn: '1/-1' }}>
        <span className="note">Marks the opportunity Won and links the new project to {account ? account.name : 'it'}.</span>
        <span className="spacer" />
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn good" onClick={go} disabled={busy}>Create project</button>
      </div>
    </div>
  )
}
