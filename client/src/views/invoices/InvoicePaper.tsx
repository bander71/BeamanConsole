import { addDays, fh, fm2, parse } from '../../lib/format.ts'
import type { InvoiceSettings } from './data.ts'
import { docTotals, lineAmount, num, termsLabel, TERMS, type DocLine, type DocState, r2 } from './doc.ts'

const longDate = (d: string) => parse(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

interface Props {
  d: DocState
  settings: InvoiceSettings
  paid: number
  /** Present while editing a draft. */
  edit?: {
    set: (patch: Partial<DocState>) => void
    setLine: (n: number, patch: Partial<DocLine>) => void
    removeLine: (n: number) => void
  }
}

/** The invoice page, as in the prototype. Read-only unless `edit` is given. */
export function InvoicePaper({ d, settings: s, paid, edit }: Props) {
  const t = docTotals(d)
  const dueDate = addDays(d.issueDate, d.termsDays)
  const logo = s.logo || 'BEAMAN'
  const notes = [d.memo, s.remitTo ? 'Payment: ' + s.remitTo : '', s.footer].filter(Boolean)
  const taxedLines = d.lines.filter((l) => l.taxable)
  const ed = !!edit
  const tail = ed ? <td /> : null
  const inp = (key: 'billToName' | 'billToAttn' | 'billToEmail' | 'billToAddress', ph: string) => (
    <input className="iv-in" value={d[key]} placeholder={ph} aria-label={ph} onChange={(e) => edit!.set({ [key]: e.target.value })} />
  )

  return (
    <>
      <div className="iv-top">
        {/^(data:|https?:|\/)/.test(logo) ? (
          <img src={logo} alt={s.company} style={{ maxHeight: 56 }} />
        ) : (
          <div className="iv-logo">
            {logo.replace(/\.$/, '')}
            <i>.</i>
          </div>
        )}
        {s.tagline && (
          <>
            <div className="iv-sep" />
            <div className="iv-tag">{s.tagline}</div>
          </>
        )}
      </div>
      <div className="iv-body">
        <div className="iv-head">
          <div className="iv-meta">
            <span>
              Date:{' '}
              {ed ? (
                <input type="date" className="iv-in" aria-label="Invoice date" value={d.issueDate} onChange={(e) => e.target.value && edit.set({ issueDate: e.target.value })} />
              ) : (
                longDate(d.issueDate)
              )}
            </span>
            <span>
              Invoice No.{' '}
              {ed ? (
                <input className="iv-in" aria-label="Invoice number" style={{ width: 180 }} value={d.number} onChange={(e) => edit.set({ number: e.target.value })} />
              ) : (
                d.number
              )}
            </span>
            <span>
              Due: {longDate(dueDate)} (
              {ed ? (
                <select className="iv-in" aria-label="Payment terms" value={d.termsDays} onChange={(e) => edit.set({ termsDays: Number(e.target.value) })}>
                  {[...new Set([...TERMS, d.termsDays])].map((x) => (
                    <option key={x} value={x}>
                      {termsLabel(x)}
                    </option>
                  ))}
                </select>
              ) : (
                termsLabel(d.termsDays)
              )}
              )
            </span>
          </div>
          <div className="iv-title">INVOICE</div>
        </div>

        <div className="iv-parties">
          <div>
            <div className="iv-lbl">Bill to:</div>
            {ed ? (
              <>
                <div className="iv-pname">{inp('billToName', 'Client name')}</div>
                <div className="iv-small" style={{ display: 'grid', gap: 3 }}>
                  {inp('billToAttn', 'Attn')}
                  {inp('billToEmail', 'Billing email')}
                  {inp('billToAddress', 'Billing address')}
                </div>
              </>
            ) : (
              <>
                <div className="iv-pname">{d.billToName}</div>
                <div className="iv-small">
                  {d.billToAttn && (
                    <>
                      Attn: {d.billToAttn}
                      <br />
                    </>
                  )}
                  {d.billToEmail && (
                    <>
                      {d.billToEmail}
                      <br />
                    </>
                  )}
                  {d.billToAddress}
                </div>
              </>
            )}
          </div>
          <div>
            <div className="iv-lbl">From:</div>
            <div className="iv-pname">{s.company}</div>
            <div className="iv-small">
              {s.fromAttn && (
                <>
                  Attn: {s.fromAttn}
                  <br />
                </>
              )}
              {s.email && (
                <>
                  {s.email}
                  <br />
                </>
              )}
              {s.address}
            </div>
          </div>
        </div>

        <div className="iv-scroll">
          <table className="iv-t">
            <thead>
              <tr>
                <th>Description</th>
                <th className="c">Qty</th>
                <th className="r">Price</th>
                <th className="r">Total</th>
                {ed && <th />}
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, n) => (
                <tr key={l.id ?? 'new' + n}>
                  <td>
                    {ed ? (
                      <>
                        <input className="iv-in" aria-label={`Line ${n + 1} description`} value={l.description} data-ldesc={n} onChange={(e) => edit.setLine(n, { description: e.target.value })} />
                        <label className="iv-tax">
                          <input type="checkbox" checked={l.taxable} onChange={(e) => edit.setLine(n, { taxable: e.target.checked })} /> Taxable
                        </label>
                        {l.kind === 'time' && (
                          <span className="iv-tax">
                            {l.days} day{l.days === 1 ? '' : 's'} of logged time
                          </span>
                        )}
                      </>
                    ) : (
                      l.description
                    )}
                  </td>
                  <td className="c">
                    {ed && l.kind !== 'time' ? (
                      <input className="iv-in" aria-label={`Line ${n + 1} quantity`} inputMode="decimal" style={{ width: 64, textAlign: 'center' }} value={l.qty} onChange={(e) => edit.setLine(n, { qty: e.target.value })} />
                    ) : (
                      fh(num(l.qty))
                    )}
                  </td>
                  <td className="r">
                    {ed ? (
                      <input className="iv-in" aria-label={`Line ${n + 1} price`} inputMode="decimal" style={{ width: 96, textAlign: 'right' }} value={l.rate} onChange={(e) => edit.setLine(n, { rate: e.target.value })} />
                    ) : (
                      fm2(num(l.rate))
                    )}
                  </td>
                  <td className="r">{fm2(lineAmount(l))}</td>
                  {ed && (
                    <td>
                      <button className="iv-x" aria-label="Remove line" onClick={() => edit.removeLine(n)}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!d.lines.length && (
                <tr>
                  <td colSpan={ed ? 5 : 4} style={{ color: 'var(--iv-mut)' }}>
                    No lines yet.
                  </td>
                </tr>
              )}
              <tr className="iv-sum first">
                <td colSpan={3}>Subtotal</td>
                <td className="r">{fm2(t.subtotal)}</td>
                {tail}
              </tr>
              {(t.tax > 0 || (ed && t.taxable !== 0)) && (
                <tr className="iv-sum">
                  <td colSpan={3}>
                    Sales tax ({fh(d.taxRate * 100)}% on {taxedLines.every((l) => l.kind === 'product') ? 'hardware' : 'taxable items'})
                  </td>
                  <td className="r">{fm2(t.tax)}</td>
                  {tail}
                </tr>
              )}
              {paid > 0 && (
                <tr className="iv-sum">
                  <td colSpan={3}>Payments received</td>
                  <td className="r">−{fm2(paid)}</td>
                  {tail}
                </tr>
              )}
              <tr className="iv-total">
                <td colSpan={3}>{paid ? 'Balance due' : 'Total amount'}</td>
                <td className="r">{fm2(paid ? r2(t.total - paid) : t.total)}</td>
                {tail}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="iv-notes">
          <div className="iv-lbl">Notes</div>
          {ed ? (
            <>
              <textarea className="iv-in" rows={3} aria-label="Notes" placeholder="Agreement, billing terms, anything the client should know" value={d.memo} onChange={(e) => edit.set({ memo: e.target.value })} />
              {[s.remitTo ? 'Payment: ' + s.remitTo : '', s.footer].filter(Boolean).map((x) => (
                <p key={x}>{x}</p>
              ))}
            </>
          ) : notes.length ? (
            notes.map((x, n) => <p key={n}>{x}</p>)
          ) : (
            <p>—</p>
          )}
        </div>
      </div>
      {s.website && <div className="iv-foot">{s.website}</div>}
    </>
  )
}
