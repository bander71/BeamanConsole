import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { useNavigate, useParams } from 'react-router'
import { getAll } from '../../api/client.ts'
import type { Task } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { addDays, fh2, fm, fm2, md, parse, shortDate, today } from '../../lib/format.ts'
import { useAccounts } from '../accounts/data.ts'
import { useProjects } from '../timesheet/data.ts'
import {
  DEFAULT_ANCHOR, STATUS_LABEL, periodLabel, periodOf, recentPeriods, useCreateInvoice, useInvoiceSettings, useInvoices,
  useInvoicingStats, useSaveSettings, useUnbilled, type InvoiceSettings, type InvoiceStatus,
} from './data.ts'
import { downloadInvoiceList } from './files.tsx'
import { InvoiceDoc } from './InvoiceDoc.tsx'
import './invoice.css'
import { StatusPill } from './StatusPill.tsx'

/** What the New invoice panel is set to, as in the prototype. */
interface Gen {
  accountId: string
  cadence: 'biweekly' | 'adhoc'
  period: string
  from: string
  to: string
  /** "everything unbilled through `to`" instead of one period */
  catchup?: boolean
  unapproved: boolean
  flat: boolean
}

export function InvoicesView() {
  const { id } = useParams()
  return id ? <InvoiceDoc id={id} /> : <InvoiceList />
}

function InvoiceList() {
  const navigate = useNavigate()
  const settingsQ = useInvoiceSettings()
  const anchor = settingsQ.data?.periodAnchor || DEFAULT_ANCHOR
  const listQ = useInvoices()
  const statsQ = useInvoicingStats()
  const readyQ = useUnbilled({})
  const [showSettings, setShowSettings] = useState(false)
  const [gen, setGen] = useState<Gen | null>(null)
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [acct, setAcct] = useState('')
  const genRef = useRef<HTMLElement>(null)

  const td = today()
  const [curStart] = periodOf(anchor, td)
  const lastEnd = addDays(curStart, -1)
  const st = statsQ.data
  const yr = st?.year ?? Number(td.slice(0, 4))

  // Ready to invoice: each client's unbilled T&M time, split at the end of the last full period.
  const ready = useMemo(() => {
    const rows = (readyQ.data ?? []).map((a) => {
      const x = { a, dueH: 0, dueAmt: 0, curH: 0, curAmt: 0 }
      for (const l of a.lines)
        for (const e of l.entries) {
          if (e.workDate <= lastEnd) {
            x.dueH += e.hours
            x.dueAmt += e.hours * l.rate
          } else {
            x.curH += e.hours
            x.curAmt += e.hours * l.rate
          }
        }
      return x
    })
    return rows.sort((x, y) => y.dueAmt - x.dueAmt)
  }, [readyQ.data, lastEnd])

  const invoices = listQ.data ?? []
  const clients = [...new Map(invoices.map((i) => [i.accountId, i.accountName || i.billToName])).entries()]
  const shown = invoices.filter((i) => (!status || i.displayStatus === status) && (!acct || i.accountId === acct))

  function openGen(g: Partial<Gen>) {
    setGen({ accountId: '', cadence: 'biweekly', period: periodOf(anchor, lastEnd)[0], from: '', to: '', unapproved: true, flat: false, ...g })
    setTimeout(() => genRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Billing</div>
          <h1>Invoices</h1>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowSettings((v) => !v)}>
          Invoice settings
        </button>
        <button className="btn" disabled={!invoices.length} onClick={() => downloadInvoiceList(invoices)}>
          Export (CSV)
        </button>
        <button className="btn primary" onClick={() => openGen({})}>
          New invoice
        </button>
      </div>

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {(
            [
              ['Outstanding', st && fm(st.outstanding.amount), st && `${st.outstanding.count} open`],
              ['Overdue', st && fm(st.overdue.amount), st && `${st.overdue.count} invoice${st.overdue.count === 1 ? '' : 's'}`],
              ['Unbilled time', st && fm(st.unbilled.amount), st && `${fh2(st.unbilled.hours)} h, T&M only`],
              [`Invoiced ${yr}`, st && fm(st.invoiced), ''],
              [`Collected ${yr}`, st && fm(st.collected), ''],
            ] as const
          ).map(([k, v, s]) => (
            <div className="stat" key={k}>
              <div className="k">{k}</div>
              <div className="v">{v ?? '…'}</div>
              <div className="sub">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {showSettings && settingsQ.data && <SettingsPanel settings={settingsQ.data} onClose={() => setShowSettings(false)} />}
      {gen && (
        <section className="panel" ref={genRef}>
          <NewInvoice g={gen} setG={setGen} anchor={anchor} />
        </section>
      )}

      <section className="panel">
        <div className="panel-h">
          <h2>Ready to invoice</h2>
          <span className="note">
            Bi-weekly periods run Monday to Sunday, two weeks at a time, starting {shortDate(anchor)}. The last full period ended {shortDate(lastEnd)}.
          </span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Client</th>
                <th className="n">Through {md(lastEnd)}</th>
                <th className="n">Amount</th>
                <th className="n">Current period</th>
                <th>Oldest unbilled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {readyQ.isPending && (
                <tr>
                  <td colSpan={6} className="note">
                    Loading…
                  </td>
                </tr>
              )}
              {ready.map((x) => (
                <tr key={x.a.accountId}>
                  <td>
                    {x.a.accountName}
                    {x.a.unapprovedHours > 0 && <span className="sub">{fh2(x.a.unapprovedHours)} h not yet approved</span>}
                  </td>
                  <td className="n num">{fh2(x.dueH)} h</td>
                  <td className="n num">{fm(x.dueAmt)}</td>
                  <td className="n num">
                    {fh2(x.curH)} h · {fm(x.curAmt)}
                  </td>
                  <td className="num">{shortDate(x.a.oldestDate)}</td>
                  <td className="n">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {x.dueH > 0 && (
                        <button
                          className="btn sm primary"
                          onClick={() => openGen({ accountId: x.a.accountId, cadence: 'biweekly', period: periodOf(anchor, lastEnd)[0], from: '', to: lastEnd, catchup: true })}
                        >
                          Invoice through {md(lastEnd)}
                        </button>
                      )}
                      <button className="btn sm" onClick={() => openGen({ accountId: x.a.accountId, cadence: 'adhoc', from: x.a.oldestDate ?? '', to: td })}>
                        Ad hoc
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {readyQ.isSuccess && !ready.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    All billable T&amp;M time has been invoiced.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="row">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Client" value={acct} onChange={(e) => setAcct(e.target.value)}>
          <option value="">All clients</option>
          {clients.map(([cid, name]) => (
            <option key={cid} value={cid}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <section className="panel">
        <div className="scroll">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Period</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="n">Total</th>
                <th className="n">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isError && (
                <tr>
                  <td colSpan={8} className="note">
                    Couldn't load invoices: {listQ.error.message}
                  </td>
                </tr>
              )}
              {shown.map((i) => (
                <tr
                  key={i.id}
                  className="click"
                  tabIndex={0}
                  onClick={() => navigate('/invoices/' + i.id)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate('/invoices/' + i.id)}
                >
                  <td className="num">{i.number}</td>
                  <td>{i.accountName || i.billToName}</td>
                  <td>
                    {i.periodStart && i.periodEnd ? `${md(i.periodStart)} – ${md(i.periodEnd)}` : '—'}
                    <span className="sub">{i.cadence === 'biweekly' ? 'Bi-weekly' : 'Ad hoc'}</span>
                  </td>
                  <td className="num">{shortDate(i.issueDate)}</td>
                  <td className="num">{shortDate(i.dueDate)}</td>
                  <td className="n num">{fm2(i.total)}</td>
                  <td className="n num">{i.status === 'void' ? '—' : fm2(i.balance)}</td>
                  <td>
                    <StatusPill s={i.displayStatus} />
                  </td>
                </tr>
              ))}
              {listQ.isSuccess && !shown.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    {invoices.length ? 'No invoices match these filters.' : 'No invoices yet. Use “Ready to invoice” above or New invoice.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

// ---- New invoice -------------------------------------------------------------------------------

function NewInvoice({ g, setG, anchor }: { g: Gen; setG: (g: Gen | null) => void; anchor: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateInvoice()
  const accountsQ = useAccounts()
  const projectsQ = useProjects()
  const tasksQ = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => getAll<Task>('/tasks') })
  const set = (patch: Partial<Gen>) => setG({ ...g, ...patch })

  // Clients with billable tasks first, then every other account.
  const accounts = accountsQ.data ?? []
  const billableIds = new Set(
    (tasksQ.data ?? [])
      .filter((t) => t.billRate > 0)
      .map((t) => projectsQ.data?.find((p) => p.id === t.projectId)?.accountId)
      .filter(Boolean),
  )
  const clients = accounts.filter((a) => billableIds.has(a.id)).sort((a, b) => a.name.localeCompare(b.name))
  const others = accounts.filter((a) => !billableIds.has(a.id)).sort((a, b) => a.name.localeCompare(b.name))

  const [from, to] = g.cadence === 'biweekly' && !g.catchup ? [g.period, addDays(g.period, 13)] : [g.from, g.to]
  const window = { accountId: g.accountId, from: from || undefined, to: to || undefined }
  const previewQ = useUnbilled({ ...window, includeUnapproved: g.unapproved, includeFlatFee: g.flat }, !!g.accountId)
  // Flat Fee hours left out (counted with unapproved time included, as the prototype does).
  const withFlatQ = useUnbilled({ ...window, includeUnapproved: true, includeFlatFee: true }, !!g.accountId && !g.flat)
  const withoutFlatQ = useUnbilled({ ...window, includeUnapproved: true, includeFlatFee: false }, !!g.accountId && !g.flat)
  const flatH = g.flat ? 0 : (withFlatQ.data?.[0]?.hours ?? 0) - (withoutFlatQ.data?.[0]?.hours ?? 0)

  const acct = previewQ.data?.[0]
  const lines = acct?.lines ?? []
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const unappr = acct?.unapprovedHours ?? 0

  async function go() {
    try {
      const inv = await create.mutateAsync({
        accountId: g.accountId, from: from || undefined, to: to || undefined, cadence: g.cadence,
        includeUnapproved: g.unapproved, includeFlatFee: g.flat, blank: !lines.length,
      })
      toast(`Draft ${inv.number} created`)
      setG(null)
      navigate('/invoices/' + inv.id)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <>
      <div className="panel-h">
        <h2>New invoice</h2>
        <span className="note">Pick the client and the time window. Billable hours that aren't on another invoice are pulled in.</span>
        <span className="spacer" />
        <button className="btn quiet sm" aria-label="Close" onClick={() => setG(null)}>
          ✕
        </button>
      </div>
      <div className="tform">
        <label className="lbl wide">
          Client
          <select value={g.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            <option value="">Choose a client…</option>
            {clients.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <optgroup label="Other accounts">
              {others.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="lbl">
          Submission
          <select
            value={g.cadence}
            onChange={(e) =>
              e.target.value === 'adhoc' ? set({ cadence: 'adhoc', from: from || '', to: to || today(), catchup: false }) : set({ cadence: 'biweekly', catchup: false })
            }
          >
            <option value="biweekly">Bi-weekly</option>
            <option value="adhoc">Ad hoc</option>
          </select>
        </label>
        {g.cadence === 'adhoc' ? (
          <>
            <label className="lbl">
              From
              <input type="date" className="field" value={g.from} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="lbl">
              To
              <input type="date" className="field" value={g.to || today()} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </>
        ) : (
          <label className="lbl wide">
            Period
            <select value={g.catchup ? '' : g.period} onChange={(e) => e.target.value && set({ period: e.target.value, catchup: false })}>
              {recentPeriods(anchor).map((p) => (
                <option key={p[0]} value={p[0]}>
                  {periodLabel(p)}
                  {p[1] >= today() ? ' (in progress)' : ''}
                </option>
              ))}
              {g.catchup && <option value="">Everything unbilled through {shortDate(g.to)}</option>}
            </select>
          </label>
        )}
        <label className="lbl">
          <span>Options</span>
          <span className="row" style={{ gap: '4px 12px' }}>
            <label className="row note" style={{ gap: 4 }}>
              <input type="checkbox" checked={g.unapproved} onChange={(e) => set({ unapproved: e.target.checked })} /> Include unapproved time
            </label>
            <label className="row note" style={{ gap: 4 }}>
              <input type="checkbox" checked={g.flat} onChange={(e) => set({ flat: e.target.checked })} /> Include Flat Fee hours
            </label>
          </span>
        </label>
      </div>
      {g.accountId && (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th className="n">Hours</th>
                <th className="n">Rate</th>
                <th className="n">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const dates = l.entries.map((e) => e.workDate).sort()
                return (
                  <tr key={l.taskId}>
                    <td>
                      {l.description}
                      <span className="sub">
                        {l.entries.length} day{l.entries.length === 1 ? '' : 's'}, {md(dates[0]!)} – {md(dates[dates.length - 1]!)}
                      </span>
                    </td>
                    <td className="n num">{fh2(l.quantity)}</td>
                    <td className="n num">{fm2(l.rate)}</td>
                    <td className="n num">{fm2(l.amount)}</td>
                  </tr>
                )
              })}
              {previewQ.isSuccess && !lines.length && (
                <tr>
                  <td colSpan={4} className="empty">
                    No unbilled billable time for this client in that window.
                    {flatH > 0 && ` ${fh2(flatH)} Flat Fee hours are available if you include them, or bill a milestone as a manual line.`}
                  </td>
                </tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="n num">{fh2(lines.reduce((s, l) => s + l.quantity, 0))}</td>
                  <td />
                  <td className="n num">{fm2(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <div className="addline">
        {unappr > 0 && <span className="pill st-submitted">{fh2(unappr)} h not yet approved</span>}
        {flatH > 0 && lines.length > 0 && <span className="note">{fh2(flatH)} Flat Fee hours left out.</span>}
        <span className="spacer" />
        <button className="btn primary" disabled={!g.accountId || create.isPending || (!!g.accountId && previewQ.isPending)} onClick={go}>
          {lines.length ? `Create draft invoice for ${fm2(total)}` : 'Create blank draft'}
        </button>
      </div>
    </>
  )
}

// ---- Invoice settings --------------------------------------------------------------------------

function SettingsPanel({ settings, onClose }: { settings: InvoiceSettings; onClose: () => void }) {
  const toast = useToast()
  const save = useSaveSettings()
  const [f, setF] = useState(() => ({
    logo: settings.logo, tagline: settings.tagline, company: settings.company, fromAttn: settings.fromAttn, email: settings.email,
    address: settings.address, phone: settings.phone, website: settings.website, numberPrefix: settings.numberPrefix,
    firstNumber: String(settings.firstNumber), taxRate: String(Math.round(settings.taxRate * 1e6) / 1e4), termsDays: String(settings.termsDays),
    periodAnchor: settings.periodAnchor ?? DEFAULT_ANCHOR, remitTo: settings.remitTo, footer: settings.footer,
  }))
  type K = keyof typeof f

  const field = (k: K, label: string, cls = 'lbl', extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={cls}>
      {label}
      <input className={'field' + (extra.inputMode ? ' num' : '')} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} />
    </label>
  )

  async function onSave() {
    const anchor = f.periodAnchor
    if (!anchor || parse(anchor).getDay() !== 1) return toast('The bi-weekly cycle must start on a Monday.')
    const terms = parseInt(f.termsDays, 10)
    if (!(terms >= 0)) return toast('Payment terms must be a number of days.')
    const taxPct = Number(f.taxRate || 0)
    const firstNumber = parseInt(f.firstNumber || '1', 10)
    if (!(taxPct >= 0 && taxPct < 30)) return toast('Enter the sales tax rate as a percent, like 8.25.')
    if (!(firstNumber >= 1)) return toast('The first invoice number must be 1 or more.')
    const t = (s: string) => s.trim()
    try {
      await save.mutateAsync({
        logo: t(f.logo), tagline: t(f.tagline), company: t(f.company), fromAttn: t(f.fromAttn), email: t(f.email), address: t(f.address),
        phone: t(f.phone), website: t(f.website), numberPrefix: t(f.numberPrefix), firstNumber, taxRate: Math.round(taxPct * 100) / 10000,
        termsDays: terms, periodAnchor: anchor, remitTo: t(f.remitTo), footer: t(f.footer),
      })
      toast('Settings saved')
      onClose()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Invoice settings</h2>
        <span className="note">Shown on every invoice.</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={save.isPending} onClick={onSave}>
          Save settings
        </button>
      </div>
      <div className="tform">
        {field('logo', 'Logo text')}
        {field('tagline', 'Tagline', 'lbl wide')}
        {field('company', 'Company name (From)', 'lbl wide')}
        {field('fromAttn', 'Attn')}
        {field('email', 'Email')}
        {field('address', 'Address', 'lbl wide')}
        {field('phone', 'Phone')}
        {field('website', 'Website (footer)')}
        {field('numberPrefix', 'Number prefix')}
        {field('firstNumber', 'First invoice number', 'lbl', { inputMode: 'numeric' })}
        {field('taxRate', 'Sales tax rate (%)', 'lbl', { inputMode: 'decimal' })}
        {field('termsDays', 'Payment terms (days)', 'lbl', { inputMode: 'numeric' })}
        <label className="lbl">
          Bi-weekly cycle starts
          <input type="date" className="field" value={f.periodAnchor} onChange={(e) => setF({ ...f, periodAnchor: e.target.value })} />
        </label>
        {field('remitTo', 'Payment instructions', 'lbl full', { placeholder: 'ACH or check payable to Beaman Consulting' })}
        {field('footer', "Standard note (added to every invoice's notes)", 'lbl full', { placeholder: 'Past-due balances accrue 1.5% per month.' })}
      </div>
    </section>
  )
}
