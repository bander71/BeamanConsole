import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '../../components/toast-context.ts'
import { DAYS, fh2, fm2, md, parse, shortDate, today } from '../../lib/format.ts'
import { PAYMENT_METHODS, useInvoice, useInvoiceAction, useInvoiceSettings, type Invoice, type InvoiceSettings, type LineKind } from './data.ts'
import { downloadInvoice, downloadTimeDetail, timeDetail } from './files.tsx'
import { num, toDoc, type DocLine, type DocState } from './doc.ts'
import { InvoicePaper } from './InvoicePaper.tsx'
import { StatusPill } from './StatusPill.tsx'

/** One invoice: the paper (editable while it's a draft), its actions, payments and time detail. */
export function InvoiceDoc({ id }: { id: string }) {
  const navigate = useNavigate()
  const q = useInvoice(id)
  const settingsQ = useInvoiceSettings()

  if (q.isError)
    return (
      <div className="panel empty">
        <h2>Invoice not found</h2>
        <p className="note">{q.error.message}</p>
        <button className="btn" onClick={() => navigate('/invoices')}>
          ‹ All invoices
        </button>
      </div>
    )
  if (!q.data || !settingsQ.data) return <p className="note">Loading…</p>
  return <DocBody key={q.data.id} inv={q.data} settings={settingsQ.data} />
}

const same = (a: DocState, b: DocState) => JSON.stringify(a) === JSON.stringify(b)
const pctText = (fraction: number) => String(Math.round(fraction * 1e6) / 1e4)

function DocBody({ inv, settings }: { inv: Invoice; settings: InvoiceSettings }) {
  const navigate = useNavigate()
  const toast = useToast()
  const action = useInvoiceAction()
  const [doc, setDoc] = useState<DocState>(() => toDoc(inv))
  const [taxText, setTaxText] = useState(() => pctText(inv.taxRate))
  const [confirm, setConfirm] = useState<'delete' | 'void' | null>(null)
  const [paying, setPaying] = useState(false)

  const ed = inv.status === 'draft'
  const st = inv.displayStatus
  const paid = inv.totals.paid
  const dirty = ed && !same(doc, toDoc(inv))
  const ent = timeDetail(inv)
  const busy = action.isPending

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Run an action; on success show the invoice the server sent back. */
  async function run(a: Parameters<typeof action.mutateAsync>[0], msg: string) {
    try {
      const next = await action.mutateAsync(a)
      if (next) {
        setDoc(toDoc(next))
        setTaxText(pctText(next.taxRate))
      }
      toast(msg)
      return true
    } catch (e) {
      toast((e as Error).message)
      return false
    }
  }

  /** The PATCH body for the draft as edited, or a message saying what to fix. */
  function patchBody(): { body?: object; error?: string } {
    if (!doc.number.trim()) return { error: 'Give the invoice a number.' }
    for (const [n, l] of doc.lines.entries()) {
      if (!Number.isFinite(num(l.qty)) || !Number.isFinite(num(l.rate)) || l.rate.trim() === '' || l.qty.trim() === '')
        return { error: `Line ${n + 1}: enter a number for the quantity and price.` }
    }
    return {
      body: {
        number: doc.number.trim(), issueDate: doc.issueDate, termsDays: doc.termsDays, taxRate: doc.taxRate, memo: doc.memo,
        billToName: doc.billToName, billToAttn: doc.billToAttn, billToEmail: doc.billToEmail, billToAddress: doc.billToAddress,
        lines: doc.lines.map((l) =>
          l.id
            ? { id: l.id, description: l.description, rate: num(l.rate), taxable: l.taxable, ...(l.kind === 'time' ? {} : { quantity: num(l.qty) }) }
            : { kind: l.kind, description: l.description, quantity: num(l.qty), rate: num(l.rate), taxable: l.taxable },
        ),
      },
    }
  }

  async function saveDraft(msg: string) {
    const { body, error } = patchBody()
    if (error) {
      toast(error)
      return false
    }
    return run({ method: 'patch', path: `/invoices/${inv.id}`, body }, msg)
  }

  async function send() {
    if (dirty && !(await saveDraft('Draft saved'))) return
    run({ method: 'post', path: `/invoices/${inv.id}/send` }, `${doc.number} marked as sent`)
  }

  async function del() {
    try {
      await action.mutateAsync({ method: 'delete', path: `/invoices/${inv.id}` })
      toast('Draft deleted')
      navigate('/invoices')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  function addLine(kind: LineKind, description: string) {
    const prod = kind === 'product'
    setDoc((d) => ({
      ...d,
      taxRate: prod && !d.taxRate && settings.taxRate ? settings.taxRate : d.taxRate,
      lines: [...d.lines, { kind, description, qty: '1', rate: '0', taxable: prod, days: 0 }],
    }))
    if (prod && !doc.taxRate && settings.taxRate) setTaxText(pctText(settings.taxRate))
    // Put the cursor in the new line's description.
    const n = doc.lines.length
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-ldesc="${n}"]`)?.focus(), 0)
  }

  const edit = {
    set: (patch: Partial<DocState>) => setDoc((d) => ({ ...d, ...patch })),
    setLine: (n: number, patch: Partial<DocLine>) => setDoc((d) => ({ ...d, lines: d.lines.map((l, i) => (i === n ? { ...l, ...patch } : l)) })),
    removeLine: (n: number) => setDoc((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== n) })),
  }

  return (
    <>
      <div className="row">
        <button className="btn quiet" onClick={() => navigate('/invoices')}>
          ‹ All invoices
        </button>
        <StatusPill s={st} />
        <span className="note">
          {inv.cadence === 'biweekly' ? 'Bi-weekly' : 'Ad hoc'}
          {inv.periodStart && inv.periodEnd && ` · service ${shortDate(inv.periodStart)} – ${shortDate(inv.periodEnd)}`}
        </span>
        {dirty && <span className="note">Unsaved changes</span>}
        <span className="spacer" />
        <button
          className="btn"
          onClick={() => {
            downloadInvoice(inv, settings, doc)
            toast('Invoice saved. Open it in a browser to print or save as PDF.')
          }}
        >
          Download invoice
        </button>
        {ent.length > 0 && (
          <button className="btn" onClick={() => downloadTimeDetail(inv)}>
            Time detail (CSV)
          </button>
        )}
        {ed && (
          <>
            <button className="btn quiet danger" disabled={busy} onClick={() => setConfirm('delete')}>
              Delete draft
            </button>
            <button className="btn" disabled={busy} onClick={() => saveDraft('Draft saved')}>
              Save draft
            </button>
            <button className="btn primary" disabled={busy} onClick={send}>
              Mark as sent
            </button>
          </>
        )}
        {!ed && st !== 'void' && st !== 'paid' && (
          <button className="btn primary" disabled={busy} onClick={() => setPaying(true)}>
            Record payment
          </button>
        )}
        {!ed && st !== 'void' && !paid && (
          <>
            <button className="btn quiet danger" disabled={busy} onClick={() => setConfirm('void')}>
              Void
            </button>
            <button className="btn quiet" disabled={busy} onClick={() => run({ method: 'post', path: `/invoices/${inv.id}/unsend` }, 'Back to draft')}>
              Back to draft
            </button>
          </>
        )}
      </div>

      {confirm && (
        <div className="panel confirm">
          <strong>{confirm === 'delete' ? `Delete draft ${inv.number}?` : `Void ${inv.number}?`}</strong>
          <span className="note">
            {confirm === 'delete' ? 'Its time goes back to unbilled.' : 'It stays on record with a zero balance, and its time goes back to unbilled.'}
          </span>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              setConfirm(null)
              if (confirm === 'delete') del()
              else run({ method: 'post', path: `/invoices/${inv.id}/void` }, `${inv.number} voided`)
            }}
          >
            {confirm === 'delete' ? 'Delete' : 'Void invoice'}
          </button>
        </div>
      )}

      {paying && <PaymentPanel inv={inv} onClose={() => setPaying(false)} run={run} />}

      <article className="ivdoc">
        <InvoicePaper d={doc} settings={settings} paid={paid} edit={ed ? edit : undefined} />
      </article>

      {ed && (
        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
          <button className="btn sm" onClick={() => addLine('manual', '')}>
            Add line
          </button>
          <button className="btn sm" onClick={() => addLine('manual', 'Milestone: ')}>
            Add milestone or fixed fee
          </button>
          <button className="btn sm" onClick={() => addLine('product', '')}>
            Add hardware or product (taxable)
          </button>
          <button className="btn sm" onClick={() => addLine('expense', 'Reimbursable expense: ')}>
            Add reimbursable expense
          </button>
          <label className="row note" style={{ gap: 6 }}>
            Sales tax %
            <input
              className="field num"
              inputMode="decimal"
              style={{ width: 70 }}
              value={taxText}
              onChange={(e) => {
                setTaxText(e.target.value)
                const t = Number(e.target.value || 0)
                if (Number.isFinite(t) && t >= 0 && t < 100) edit.set({ taxRate: Math.round(t * 100) / 10000 })
              }}
            />
          </label>
        </div>
      )}

      {inv.payments.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <h2>Payments</h2>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="n">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{shortDate(p.paymentDate)}</td>
                    <td>{p.method}</td>
                    <td>{p.reference}</td>
                    <td className="n num">{fm2(p.amount)}</td>
                    <td className="n">
                      <button className="btn quiet sm" disabled={busy} onClick={() => run({ method: 'delete', path: `/invoices/${inv.id}/payments/${p.id}` }, 'Payment removed')}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ent.length > 0 && (
        <section className="panel">
          <div className="panel-h">
            <h2>Time detail</h2>
            <span className="note">{ent.length} day-lines behind this invoice</span>
          </div>
          <div className="scroll">
            <table style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Line</th>
                  <th className="n">Hours</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {ent.map((e) => (
                  <tr key={e.timeEntryId}>
                    <td className="num">
                      {md(e.workDate)}{' '}
                      <span className="sub" style={{ display: 'inline' }}>
                        {DAYS[(parse(e.workDate).getDay() + 6) % 7]}
                      </span>
                    </td>
                    <td>{e.line}</td>
                    <td className="n num">{fh2(e.hours)}</td>
                    <td className="note">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function PaymentPanel({
  inv, onClose, run,
}: {
  inv: Invoice
  onClose: () => void
  run: (a: { method: 'post'; path: string; body: unknown }, msg: string) => Promise<boolean>
}) {
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(inv.totals.balance.toFixed(2))
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [ref, setRef] = useState('')

  async function save() {
    const amt = Math.round(num(amount) * 100) / 100
    if (!(amt > 0)) return toast('Enter the amount received.')
    if (amt > inv.totals.balance + 0.004) return toast(`That's more than the ${fm2(inv.totals.balance)} balance.`)
    const ok = await run(
      { method: 'post', path: `/invoices/${inv.id}/payments`, body: { paymentDate: date || today(), amount: amt, method, reference: ref.trim() } },
      `Payment of ${fm2(amt)} recorded`,
    )
    if (ok) onClose()
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Record payment on {inv.number}</h2>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save payment
        </button>
      </div>
      <div className="tform">
        <label className="lbl">
          Date received
          <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="lbl">
          Amount
          <input className="field num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="lbl">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="lbl">
          Reference
          <input className="field" placeholder="Check # or transaction ID" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
    </section>
  )
}
