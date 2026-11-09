import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getAll, qs } from '../../api/client.ts'
import { addDays, parse, today } from '../../lib/format.ts'

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void'
export type LineKind = 'time' | 'manual' | 'expense' | 'product'

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft', sent: 'Sent', partial: 'Partly paid', paid: 'Paid', overdue: 'Overdue', void: 'Void',
}
export const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: 'st-draft', sent: 'st-submitted', partial: 'st-submitted', paid: 'st-approved', overdue: 'st-returned', void: 'st-draft',
}
export const PAYMENT_METHODS = ['ACH', 'Check', 'Wire', 'Card', 'Cash', 'Other'] as const

export interface InvoiceSettings {
  company: string
  tagline: string
  address: string
  phone: string
  email: string
  website: string
  fromAttn: string
  remitTo: string
  footer: string
  logo: string
  numberPrefix: string
  firstNumber: number
  termsDays: number
  /** fraction: 0.0865 is 8.65% */
  taxRate: number
  periodAnchor: string | null
}

export interface InvoiceEntry {
  timeEntryId: string
  workDate: string
  hours: number
  resourceName: string
  note: string
  timesheetStatus?: string
}

export interface InvoiceLine {
  id: string
  lineNo: number
  kind: LineKind
  taskId: string | null
  taskNumber: number | null
  description: string
  quantity: number
  rate: number
  amount: number
  taxable: boolean
  entries: InvoiceEntry[]
}

export interface Payment {
  id: string
  paymentDate: string
  amount: number
  method: string
  reference: string
}

export interface Invoice {
  id: string
  number: string
  accountId: string
  accountName: string
  status: 'draft' | 'sent' | 'void'
  displayStatus: InvoiceStatus
  billToName: string
  billToAttn: string
  billToEmail: string
  billToAddress: string
  cadence: string | null
  periodStart: string | null
  periodEnd: string | null
  issueDate: string
  termsDays: number
  dueDate: string
  taxRate: number
  memo: string
  lines: InvoiceLine[]
  payments: Payment[]
  totals: { subtotal: number; tax: number; total: number; paid: number; balance: number }
}

/** A row of the invoice list (no lines or payments). */
export interface InvoiceSummary {
  id: string
  number: string
  accountId: string
  accountName: string
  billToName: string
  status: 'draft' | 'sent' | 'void'
  displayStatus: InvoiceStatus
  cadence: string | null
  periodStart: string | null
  periodEnd: string | null
  issueDate: string
  dueDate: string
  total: number
  paid: number
  balance: number
}

export interface UnbilledLine {
  taskId: string
  taskNumber: number
  description: string
  quantity: number
  rate: number
  amount: number
  entries: InvoiceEntry[]
}

export interface UnbilledAccount {
  accountId: string
  accountName: string
  hours: number
  amount: number
  unapprovedHours: number
  oldestDate: string | null
  lines: UnbilledLine[]
}

export interface InvoicingStats {
  year: number
  outstanding: { amount: number; count: number }
  overdue: { amount: number; count: number }
  unbilled: { amount: number; hours: number }
  invoiced: number
  collected: number
}

export interface UnbilledOptions {
  accountId?: string
  from?: string
  to?: string
  includeUnapproved?: boolean
  includeFlatFee?: boolean
}

// ---- bi-weekly periods, as in the prototype --------------------------------------------------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const DEFAULT_ANCHOR = '2026-01-05'

/** The two-week period (Monday to Sunday) that a date falls in. */
export function periodOf(anchor: string, date: string): [string, string] {
  const days = Math.round((parse(date).getTime() - parse(anchor).getTime()) / 864e5)
  const start = addDays(anchor, Math.floor(days / 14) * 14)
  return [start, addDays(start, 13)]
}

/** The current period and the ones before it, newest first. */
export function recentPeriods(anchor: string, n = 10) {
  const out: [string, string][] = []
  let [s] = periodOf(anchor, today())
  for (let i = 0; i < n; i++) {
    out.push([s, addDays(s, 13)])
    s = addDays(s, -14)
  }
  return out
}

/** Oct 26 – Nov 8, 2026 */
export const periodLabel = ([a, b]: [string, string]) => {
  const x = parse(a), y = parse(b)
  return `${MON[x.getMonth()]} ${x.getDate()} – ${MON[y.getMonth()]} ${y.getDate()}, ${y.getFullYear()}`
}

// ---- queries ----------------------------------------------------------------------------------

const keys = {
  settings: ['settings', 'invoicing'],
  list: ['invoices', 'list'],
  one: (id: string) => ['invoices', 'one', id],
  unbilled: (o: UnbilledOptions) => ['invoices', 'unbilled', o],
  stats: ['reports', 'invoicing'],
}

export const useInvoiceSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: async () => (await api.get<{ data: InvoiceSettings }>('/settings/invoicing')).data })

export const useInvoices = () => useQuery({ queryKey: keys.list, queryFn: () => getAll<InvoiceSummary>('/invoices'), staleTime: 0 })

export const useInvoice = (id: string | undefined) =>
  useQuery({
    queryKey: keys.one(id ?? ''),
    queryFn: async () => (await api.get<{ data: Invoice }>(`/invoices/${id}`)).data,
    enabled: !!id,
    staleTime: 0,
  })

export const useUnbilled = (o: UnbilledOptions, enabled = true) =>
  useQuery({
    queryKey: keys.unbilled(o),
    queryFn: async () => (await api.get<{ data: UnbilledAccount[] }>('/invoices/unbilled' + qs({ ...o }))).data,
    enabled,
    staleTime: 0,
  })

export const useInvoicingStats = () =>
  useQuery({
    queryKey: keys.stats,
    queryFn: async () => (await api.get<{ data: InvoicingStats }>('/reports/invoicing')).data,
    staleTime: 0,
  })

// ---- changes ----------------------------------------------------------------------------------

/** After any invoice change: refresh invoice lists, unbilled time, reports and timesheets (billed hours lock). */
function useRefresh() {
  const qc = useQueryClient()
  return (inv?: Invoice) => {
    if (inv) qc.setQueryData(keys.one(inv.id), inv)
    qc.invalidateQueries({ queryKey: ['invoices'] })
    qc.invalidateQueries({ queryKey: ['reports'] })
    qc.invalidateQueries({ queryKey: ['timesheet'] })
  }
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Partial<InvoiceSettings>) => (await api.put<{ data: InvoiceSettings }>('/settings/invoicing', body)).data,
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  })
}

export interface CreateInvoiceBody {
  accountId: string
  from?: string
  to?: string
  cadence: 'biweekly' | 'adhoc'
  includeUnapproved: boolean
  includeFlatFee: boolean
  blank: boolean
}

export function useCreateInvoice() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (body: CreateInvoiceBody) => (await api.post<{ data: Invoice }>('/invoices', body)).data,
    onSuccess: refresh,
  })
}

/** One action on an invoice: save edits, send, unsend, void, record or remove a payment. */
export function useInvoiceAction() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (a: { method: 'post' | 'patch' | 'delete'; path: string; body?: unknown }) => {
      if (a.method === 'delete') {
        // Removing a payment returns the invoice; deleting a draft returns nothing.
        const r = (await api.del(a.path)) as unknown as { data?: Invoice } | undefined
        return r?.data
      }
      const res = a.method === 'post' ? await api.post<{ data: Invoice }>(a.path, a.body) : await api.patch<{ data: Invoice }>(a.path, a.body)
      return res.data
    },
    onSuccess: (inv) => refresh(inv),
  })
}
