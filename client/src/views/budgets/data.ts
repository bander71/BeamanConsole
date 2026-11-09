import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client.ts'

export interface BudgetTask {
  taskId: string
  taskNumber: number
  name: string
  type: string | null
  active: boolean
  resourceName: string
  billRate: number
  costRate: number
  billable: boolean
  budgetHours: number
  actualHours: number
  remainingHours: number | null
  burn: number | null
  /** null on internal projects */
  value: number | null
  cost: number | null
  margin: number | null
}

export interface BudgetProject {
  projectId: string
  code: string
  name: string
  type: string | null
  accountName: string | null
  startDate: string | null
  endDate: string | null
  internal: boolean
  tasks: BudgetTask[]
  totals: {
    budgetHours: number
    actualHours: number
    remainingHours: number | null
    burn: number | null
    value: number | null
    cost: number | null
    margin: number | null
  }
}

/** Budget vs actual for every project and task. Hours change often, so reload each visit. */
export const useBudgets = () =>
  useQuery({
    queryKey: ['reports', 'budgets'],
    queryFn: async () => (await api.get<{ data: BudgetProject[] }>('/reports/budgets')).data,
    staleTime: 0,
  })
