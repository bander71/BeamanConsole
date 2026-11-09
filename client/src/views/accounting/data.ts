import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getAll, qs } from '../../api/client.ts'

export const EXP_CATS = [
  'Contractors (1099)', 'Software & subscriptions', 'Travel', 'Meals', 'Vehicle & fuel', 'Office & supplies', 'Insurance',
  'Professional fees', 'Marketing', 'Equipment', 'Taxes & licenses', 'Bank & payment fees', 'Other expense',
] as const
export const INC_CATS = ['Consulting revenue (outside invoices)', 'Reimbursements', 'Interest', 'Other income'] as const
export const METHODS = ['ACH', 'Check', 'Card', 'Wire', 'Cash', 'Other'] as const
export const CONTRACTORS = 'Contractors (1099)'

export type Basis = 'cash' | 'accrual'

export interface LedgerEntry {
  id: string
  entryDate: string
  type: 'income' | 'expense'
  category: string
  amount: number
  payee: string
  resourceId: string | null
  accountId: string | null
  method: string | null
  memo: string
}
export type LedgerInput = Omit<LedgerEntry, 'id'>

export interface InvoicePayment {
  id: string
  invoiceId: string
  invoiceNumber: string
  accountId: string
  accountName: string
  paymentDate: string
  amount: number
  method: string | null
  reference: string
}

export interface Pnl {
  from: string
  to: string
  basis: Basis
  income: { category: string; amount: number }[]
  expenses: { category: string; amount: number }[]
  totalIncome: number
  totalExpenses: number
  net: number
  netMargin: number | null
  mileageDeduction: number
}

export interface PnlMonthly {
  year: number
  months: { month: number; income: number; expenses: number; net: number }[]
}

type BucketKey = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90'
export type Aging = Record<BucketKey, number> & { total: number }
export interface Receivables {
  buckets: { key: BucketKey; label: string }[]
  clients: (Aging & { accountId: string; accountName: string })[]
  totals: Aging
  invoices: unknown[]
}

export interface Contractors {
  year: number
  threshold: number
  totalOwed: number
  contractors: { resourceId: string; name: string; hours: number; cost: number; paid: number; owed: number; needs1099: boolean }[]
}

const data = async <T,>(path: string) => (await api.get<{ data: T }>(path)).data
const fresh = { staleTime: 0 }

export const usePnl = (from: string, to: string, basis: Basis) =>
  useQuery({ queryKey: ['reports', 'pnl', from, to, basis], queryFn: () => data<Pnl>('/reports/pnl' + qs({ from, to, basis })), ...fresh })

export const usePnlMonthly = (year: number, basis: Basis) =>
  useQuery({ queryKey: ['reports', 'pnlMonthly', year, basis], queryFn: () => data<PnlMonthly>('/reports/pnl/monthly' + qs({ year, basis })), ...fresh })

export const useReceivables = () =>
  useQuery({ queryKey: ['reports', 'receivables'], queryFn: () => data<Receivables>('/reports/receivables'), ...fresh })

export const useContractors = (year: number) =>
  useQuery({ queryKey: ['reports', 'contractors', year], queryFn: () => data<Contractors>('/reports/contractors' + qs({ year })), ...fresh })

export const useLedger = (from: string, to: string) =>
  useQuery({ queryKey: ['ledger', from, to], queryFn: () => getAll<LedgerEntry>('/ledger', { from, to }), ...fresh })

export const usePayments = (from: string, to: string) =>
  useQuery({ queryKey: ['invoices', 'payments', from, to], queryFn: () => data<InvoicePayment[]>('/invoice-payments' + qs({ from, to })), ...fresh })

/** Save, update or delete a manual ledger entry, then refresh the books. */
export function useLedgerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: { id?: string; body?: LedgerInput; remove?: boolean }) => {
      if (m.remove) return api.del(`/ledger/${m.id}`)
      if (m.id) return api.patch(`/ledger/${m.id}`, m.body)
      return api.post('/ledger', m.body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}
