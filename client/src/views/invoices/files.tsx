import { downloadCsv } from '../../lib/csv.ts'
import { today } from '../../lib/format.ts'
import { STATUS_LABEL, type Invoice, type InvoiceSettings, type InvoiceSummary } from './data.ts'
import type { DocState } from './doc.ts'

/** Every logged day behind an invoice's time lines, oldest first. */
export const timeDetail = (i: Invoice) =>
  i.lines
    .flatMap((l) => l.entries.map((e) => ({ ...e, line: l.description, rate: l.rate })))
    .sort((a, b) => a.workDate.localeCompare(b.workDate))

/** Builds the invoice file in a separate chunk, loaded only when someone downloads one. */
export async function downloadInvoice(i: Invoice, settings: InvoiceSettings, doc?: DocState) {
  const m = await import('./invoiceFile.tsx')
  m.downloadInvoice(i, settings, doc)
}

/** The day-lines behind an invoice, as in the prototype's "Time detail (CSV)". */
export function downloadTimeDetail(i: Invoice) {
  const rows = i.lines
    .flatMap((l) => l.entries.map((e) => [e.workDate, e.resourceName, l.description, e.hours, l.rate, (Math.round(e.hours * l.rate * 100) / 100).toFixed(2), e.note || '']))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])))
  downloadCsv(`Invoice ${i.number} time detail.csv`, ['Date', 'Resource', 'Line', 'Hours', 'Rate', 'Amount', 'Note'], rows)
}

/** Every invoice, oldest number first. */
export function downloadInvoiceList(list: InvoiceSummary[]) {
  const rows = [...list]
    .sort((a, b) => a.number.localeCompare(b.number))
    .map((x) => [
      x.number, x.accountName || x.billToName, x.cadence ?? '', x.periodStart ?? '', x.periodEnd ?? '', x.issueDate, x.dueDate,
      x.total.toFixed(2), x.paid.toFixed(2), x.balance.toFixed(2), STATUS_LABEL[x.displayStatus],
    ])
  downloadCsv(`beaman-invoices_${today()}.csv`, ['Number', 'Client', 'Cadence', 'Period start', 'Period end', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status'], rows)
}
