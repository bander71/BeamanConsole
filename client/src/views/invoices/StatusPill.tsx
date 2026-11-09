import { STATUS_CLASS, STATUS_LABEL, type InvoiceStatus } from './data.ts'

export function StatusPill({ s }: { s: InvoiceStatus }) {
  return <span className={`pill ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>
}
