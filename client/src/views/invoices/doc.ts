import type { Invoice, LineKind } from './data.ts'

/** A line as it's being edited: quantity and rate stay as typed until saved. */
export interface DocLine {
  id?: string
  kind: LineKind
  description: string
  qty: string
  rate: string
  taxable: boolean
  /** days of logged time behind a time line */
  days: number
}

/** The editable parts of an invoice. */
export interface DocState {
  number: string
  issueDate: string
  termsDays: number
  billToName: string
  billToAttn: string
  billToEmail: string
  billToAddress: string
  /** fraction: 0.0865 is 8.65% */
  taxRate: number
  memo: string
  lines: DocLine[]
}

export const TERMS = [0, 7, 15, 30, 45, 60]
export const termsLabel = (t: number) => (t ? `Net ${t}` : 'Due on receipt')
export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Number typed into a qty or rate box ("$1,200" works); NaN if it isn't one. */
export const num = (s: string) => Number(String(s).replace(/[$,]/g, ''))
export const lineAmount = (l: DocLine) => {
  const q = num(l.qty), r = num(l.rate)
  return Number.isFinite(q) && Number.isFinite(r) ? r2(q * r) : 0
}

export function docTotals(d: DocState) {
  const subtotal = r2(d.lines.reduce((s, l) => s + lineAmount(l), 0))
  const taxable = r2(d.lines.filter((l) => l.taxable).reduce((s, l) => s + lineAmount(l), 0))
  const tax = r2(taxable * d.taxRate)
  return { subtotal, taxable, tax, total: r2(subtotal + tax) }
}

export function toDoc(i: Invoice): DocState {
  return {
    number: i.number,
    issueDate: i.issueDate,
    termsDays: i.termsDays,
    billToName: i.billToName,
    billToAttn: i.billToAttn,
    billToEmail: i.billToEmail,
    billToAddress: i.billToAddress,
    taxRate: i.taxRate,
    memo: i.memo,
    lines: i.lines.map((l) => ({
      id: l.id, kind: l.kind, description: l.description, qty: String(l.quantity), rate: String(l.rate), taxable: l.taxable, days: l.entries.length,
    })),
  }
}
