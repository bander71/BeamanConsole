import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '../../components/toast-context.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { fh2, fm, fm2, pct, shortDate, today } from '../../lib/format.ts'
import { isAllTime, RANGE_LABELS, rangeDates, type Range } from '../../lib/periods.ts'
import { useAccounts } from '../accounts/data.ts'
import { useResources } from '../timesheet/data.ts'
import {
  CONTRACTORS, EXP_CATS, INC_CATS, METHODS, useContractors, useLedger, useLedgerMutation, usePayments, usePnl, usePnlMonthly, useReceivables,
  type Basis, type LedgerEntry,
} from './data.ts'

const RANGES: Range[] = ['month', 'lastmonth', 'q1', 'q2', 'q3', 'q4', 'ytd', 'lastyear', 'all', 'custom']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** One row of the ledger: a manual entry, or an invoice payment (added automatically). */
interface Txn {
  key: string
  date: string
  type: 'income' | 'expense'
  category: string
  payee: string
  memo: string
  method: string
  amount: number
  accountName: string
  contractor: string
  entry?: LedgerEntry
  invoiceId?: string
}

/** What the income/expense form opens with. */
interface TxOpen {
  type: 'income' | 'expense'
  entry?: LedgerEntry
  resourceId?: string
  amount?: string
}

export function AccountingView() {
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('ytd')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [basis, setBasis] = useState<Basis>('cash')
  const [tx, setTx] = useState<TxOpen | null>(null)
  const txRef = useRef<HTMLElement>(null)

  const td = today()
  const yr = Number(td.slice(0, 4))
  const period = rangeDates(range, custom.from, custom.to)
  const [from, to] = period
  const all = isAllTime(period)
  const monthYear = to.startsWith('9999') ? yr : Number(to.slice(0, 4))

  const pnlQ = usePnl(from, to, basis)
  const monthlyQ = usePnlMonthly(monthYear, basis)
  const recQ = useReceivables()
  const conQ = useContractors(yr)
  const ledgerQ = useLedger(from, to)
  const paymentsQ = usePayments(from, to)
  const accounts = useAccounts().data ?? []
  const resources = useResources().data ?? []
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? ''
  const resourceName = (id: string | null) => resources.find((r) => r.id === id)?.name ?? ''

  const P = pnlQ.data
  const rec = recQ.data
  const con = conQ.data

  const txns: Txn[] = [
    ...(paymentsQ.data ?? []).map((p) => ({
      key: 'pay:' + p.id, date: p.paymentDate, type: 'income' as const, category: 'Invoice payment', payee: p.accountName,
      memo: p.invoiceNumber + (p.reference ? ' · ' + p.reference : ''), method: p.method ?? '', amount: p.amount,
      accountName: p.accountName, contractor: '', invoiceId: p.invoiceId,
    })),
    ...(ledgerQ.data ?? []).map((e) => ({
      key: e.id, date: e.entryDate, type: e.type, category: e.category, payee: e.payee || resourceName(e.resourceId), memo: e.memo,
      method: e.method ?? '', amount: e.amount, accountName: accountName(e.accountId), contractor: resourceName(e.resourceId), entry: e,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const inTotal = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const outTotal = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  const months = monthlyQ.data?.months ?? []
  const mmax = Math.max(1, ...months.map((x) => Math.max(x.income, x.expenses)))

  function openTx(t: TxOpen) {
    setTx(t)
    setTimeout(() => txRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  function exportLedger() {
    const rows = [...txns].reverse().map((t) => [t.date, t.type, t.category, t.payee, (t.type === 'expense' ? -t.amount : t.amount).toFixed(2), t.method, t.memo, t.accountName, t.contractor])
    downloadCsv(`beaman-ledger_${all ? 'all' : from + '_to_' + to}.csv`, ['Date', 'Type', 'Category', 'Payee', 'Amount', 'Method', 'Memo', 'Account', 'Contractor'], rows)
  }

  const stat = (k: string, v: string | undefined) => (
    <div className="stat" key={k}>
      <div className="k">{k}</div>
      <div className="v">{v ?? '…'}</div>
    </div>
  )

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Books</div>
          <h1>Accounting</h1>
        </div>
        <span className="spacer" />
        <button className="btn" disabled={!txns.length} onClick={exportLedger}>
          Export ledger (CSV)
        </button>
        <button className="btn" onClick={() => openTx({ type: 'income' })}>
          Record income
        </button>
        <button className="btn primary" onClick={() => openTx({ type: 'expense' })}>
          Record expense
        </button>
      </div>

      <div className="row">
        <label className="lbl">
          Period
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label className="lbl">
              From
              <input type="date" className="field" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label className="lbl">
              To
              <input type="date" className="field" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </>
        )}
        <label className="lbl">
          Basis
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="cash">Cash (when money moves)</option>
            <option value="accrual">Accrual (when invoiced or worked)</option>
          </select>
        </label>
      </div>

      {tx && (
        <section className="panel" ref={txRef}>
          <TxForm key={tx.entry?.id ?? tx.type + (tx.resourceId ?? '')} open={tx} onClose={() => setTx(null)} />
        </section>
      )}

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {stat('Revenue', P && fm(P.totalIncome))}
          {stat('Expenses', P && fm(P.totalExpenses))}
          {stat('Net income', P && fm(P.net))}
          {stat('Net margin', P && (P.totalIncome ? pct(P.netMargin) : '—'))}
          {stat('Receivables', rec && fm(rec.totals.total))}
          {stat('Owed to contractors', con && fm(con.totalOwed))}
        </div>
      </section>

      <div className="two">
        <section className="panel">
          <div className="panel-h">
            <h2>Profit and loss</h2>
            <span className="note">
              {all ? 'All dates' : `${shortDate(from)} – ${shortDate(to)}`} · {basis} basis
            </span>
          </div>
          <div className="scroll">
            <table>
              <tbody>
                <tr className="grp">
                  <td>Income</td>
                  <td className="n" />
                </tr>
                {P?.income.map((x) => (
                  <tr key={x.category}>
                    <td style={{ paddingLeft: 22 }}>{x.category}</td>
                    <td className="n num">{fm2(x.amount)}</td>
                  </tr>
                ))}
                {P && !P.income.length && (
                  <tr>
                    <td className="note" style={{ paddingLeft: 22 }}>
                      No income in this period.
                    </td>
                    <td />
                  </tr>
                )}
                <tr>
                  <td>
                    <b>Total income</b>
                  </td>
                  <td className="n num">
                    <b>{fm2(P?.totalIncome)}</b>
                  </td>
                </tr>
                <tr className="grp">
                  <td>Expenses</td>
                  <td className="n" />
                </tr>
                {P?.expenses.map((x) => (
                  <tr key={x.category}>
                    <td style={{ paddingLeft: 22 }}>
                      {x.category}
                      {x.category === CONTRACTORS && basis === 'accrual' && <span className="sub">From timesheet hours × 1099 rates</span>}
                    </td>
                    <td className="n num">{fm2(x.amount)}</td>
                  </tr>
                ))}
                {P && !P.expenses.length && (
                  <tr>
                    <td className="note" style={{ paddingLeft: 22 }}>
                      No expenses recorded.
                    </td>
                    <td />
                  </tr>
                )}
                <tr>
                  <td>
                    <b>Total expenses</b>
                  </td>
                  <td className="n num">
                    <b>{fm2(P?.totalExpenses)}</b>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Net income</td>
                  <td className="n num">{fm2(P?.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="note" style={{ padding: '0 14px 12px' }}>
            Mileage deduction for the same period: {fm2(P?.mileageDeduction)} at IRS rates. It reduces taxable income but isn't a cash expense, so it isn't included above.
          </p>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>By month, {monthYear}</h2>
            <span className="note">
              <span className="key kb" />
              Revenue <span className="key kx" />
              Expenses
            </span>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ width: '44%' }} />
                  <th className="n">Revenue</th>
                  <th className="n">Expenses</th>
                  <th className="n">Net</th>
                </tr>
              </thead>
              <tbody>
                {months.map((x) => (
                  <tr key={x.month}>
                    <td>{MON[x.month - 1]}</td>
                    <td>
                      <div className="mbar2">
                        <i className="kb" style={{ width: `${(x.income / mmax) * 100}%` }} />
                      </div>
                      <div className="mbar2">
                        <i className="kx" style={{ width: `${(x.expenses / mmax) * 100}%` }} />
                      </div>
                    </td>
                    <td className="n num">{fm(x.income)}</td>
                    <td className="n num">{fm(x.expenses)}</td>
                    <td className={`n num${x.net < 0 ? ' over' : ''}`}>{fm(x.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="two">
        <section className="panel">
          <div className="panel-h">
            <h2>Receivables aging</h2>
            <span className="note">Open invoice balances by days past due</span>
          </div>
          <div className="scroll">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Client</th>
                  {rec?.buckets.map((b) => (
                    <th key={b.key} className="n">
                      {b.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rec?.clients.map((c) => (
                  <tr key={c.accountId}>
                    <td>{c.accountName}</td>
                    {rec.buckets.map((b) => (
                      <td key={b.key} className="n num">
                        {c[b.key] ? fm(c[b.key]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                {rec && !rec.clients.length && (
                  <tr>
                    <td colSpan={6} className="empty">
                      No open invoices.
                    </td>
                  </tr>
                )}
              </tbody>
              {rec && rec.clients.length > 0 && (
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {rec.buckets.map((b) => (
                      <td key={b.key} className="n num">
                        {fm(rec.totals[b.key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h">
            <h2>Contractors</h2>
            <span className="note">Payments of $2,000 or more in {yr} need a 1099-NEC.</span>
          </div>
          <div className="scroll">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th className="n">Hours {yr}</th>
                  <th className="n">Cost {yr}</th>
                  <th className="n">Paid {yr}</th>
                  <th className="n">Owed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {con?.contractors.map((c) => (
                  <tr key={c.resourceId}>
                    <td>
                      {c.name}
                      {c.needs1099 && (
                        <span className="sub" style={{ color: 'var(--warn)' }}>
                          1099-NEC required
                        </span>
                      )}
                    </td>
                    <td className="n num">{fh2(c.hours)}</td>
                    <td className="n num">{fm(c.cost)}</td>
                    <td className="n num">{fm(c.paid)}</td>
                    <td className="n num">{fm2(c.owed)}</td>
                    <td className="n">
                      {c.owed > 0.004 && (
                        <button className="btn sm" onClick={() => openTx({ type: 'expense', resourceId: c.resourceId, amount: c.owed.toFixed(2) })}>
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {con && !con.contractors.length && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Mark resources as 1099 contractors under Setup.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-h">
          <h2>Ledger</h2>
          <span className="note">{txns.length} transactions in this period. Invoice payments come in automatically; select a manual entry to edit it.</span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee / from</th>
                <th>Category</th>
                <th>Memo</th>
                <th>Method</th>
                <th className="n">In</th>
                <th className="n">Out</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => {
                const open = () => (t.invoiceId ? navigate('/invoices/' + t.invoiceId) : t.entry && openTx({ type: t.type, entry: t.entry }))
                return (
                  <tr key={t.key} className="click" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
                    <td className="num">{shortDate(t.date)}</td>
                    <td>{t.payee}</td>
                    <td>
                      {t.category}
                      {t.invoiceId && (
                        <>
                          {' '}
                          <span className="chip bill">Auto</span>
                        </>
                      )}
                    </td>
                    <td className="note">{t.memo}</td>
                    <td>{t.method}</td>
                    <td className="n num">{t.type === 'income' ? fm2(t.amount) : ''}</td>
                    <td className="n num">{t.type === 'expense' ? fm2(t.amount) : ''}</td>
                  </tr>
                )
              })}
              {ledgerQ.isSuccess && paymentsQ.isSuccess && !txns.length && (
                <tr>
                  <td colSpan={7} className="empty">
                    No transactions in this period. Record an expense, or record a payment on an invoice.
                  </td>
                </tr>
              )}
            </tbody>
            {txns.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5}>Totals</td>
                  <td className="n num">{fm2(inTotal)}</td>
                  <td className="n num">{fm2(outTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </>
  )
}

/** Record or edit a manual income or expense entry. */
function TxForm({ open, onClose }: { open: TxOpen; onClose: () => void }) {
  const toast = useToast()
  const save = useLedgerMutation()
  const accounts = [...(useAccounts().data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const resources = useResources().data ?? []
  const contractors = resources.filter((r) => r.contractor)
  const e = open.entry
  const type = e?.type ?? open.type
  const [f, setF] = useState(() => ({
    date: e?.entryDate ?? today(),
    amount: e ? String(e.amount) : (open.amount ?? ''),
    category: e?.category ?? (type === 'income' ? INC_CATS[0] : open.resourceId ? CONTRACTORS : EXP_CATS[1]),
    payee: e?.payee ?? '',
    resourceId: e?.resourceId ?? open.resourceId ?? '',
    method: e?.method ?? 'ACH',
    accountId: e?.accountId ?? '',
    memo: e?.memo ?? '',
  }))
  const [confirmDel, setConfirmDel] = useState(false)
  const cats: readonly string[] = type === 'income' ? INC_CATS : EXP_CATS
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })

  async function onSave() {
    const amount = Math.round(Number(f.amount.replace(/[$,]/g, '')) * 100) / 100
    if (!f.date) return toast('Enter the date.')
    if (!(amount > 0)) return toast('Enter an amount greater than zero.')
    if (f.category === CONTRACTORS && !f.resourceId) return toast('Pick which contractor was paid.')
    const body = {
      entryDate: f.date, type, category: f.category, amount,
      payee: f.payee.trim() || resources.find((r) => r.id === f.resourceId)?.name || '',
      resourceId: f.resourceId || null, method: f.method, accountId: f.accountId || null, memo: f.memo.trim(),
    }
    try {
      await save.mutateAsync({ id: e?.id, body })
      toast('Entry saved')
      onClose()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function onDelete() {
    try {
      await save.mutateAsync({ id: e!.id, remove: true })
      toast('Entry deleted')
      onClose()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <>
      <div className="panel-h">
        <h2>
          {e ? 'Edit' : 'Record'} {type}
        </h2>
        <span className="spacer" />
        {e && (
          <button className="btn quiet danger" onClick={() => setConfirmDel(true)}>
            Delete
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={save.isPending} onClick={onSave}>
          Save
        </button>
      </div>
      {confirmDel && (
        <div className="confirm">
          <strong>Delete this entry?</strong>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirmDel(false)}>
            Cancel
          </button>
          <button className="btn danger" disabled={save.isPending} onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
      <div className="tform">
        <label className="lbl">
          Date
          <input type="date" className="field" value={f.date} onChange={(ev) => set({ date: ev.target.value })} />
        </label>
        <label className="lbl">
          Amount
          <input className="field num" inputMode="decimal" value={f.amount} onChange={(ev) => set({ amount: ev.target.value })} />
        </label>
        <label className="lbl wide">
          Category
          <select value={f.category} onChange={(ev) => set({ category: ev.target.value })}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          {type === 'income' ? 'Received from' : 'Paid to'}
          <input className="field" list="ledgerAccountNames" value={f.payee} onChange={(ev) => set({ payee: ev.target.value })} />
          <datalist id="ledgerAccountNames">
            {accounts.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
        </label>
        <label className="lbl">
          Contractor
          <select value={f.resourceId} onChange={(ev) => set({ resourceId: ev.target.value })}>
            <option value="">None</option>
            {contractors.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Method
          <select value={f.method} onChange={(ev) => set({ method: ev.target.value })}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Account
          <select value={f.accountId} onChange={(ev) => set({ accountId: ev.target.value })}>
            <option value="">None</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl full">
          Memo
          <input className="field" placeholder="What was it for?" value={f.memo} onChange={(ev) => set({ memo: ev.target.value })} />
        </label>
      </div>
    </>
  )
}
