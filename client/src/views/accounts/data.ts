import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesKey } from '../../api/activities.ts'
import { api, getAll, qs, type One } from '../../api/client.ts'
import type { Account, AccountInput, AccountStats, AccountSummary, Contact, Opportunity } from '../../api/types.ts'

const thisYear = () => new Date().getFullYear()

export const keys = {
  accounts: ['accounts'] as const,
  stats: ['reports', 'accounts'] as const,
  summary: (id: string) => ['reports', 'accounts', id] as const,
  contacts: (id: string) => ['contacts', { accountId: id }] as const,
  opportunities: (id: string) => ['opportunities', { accountId: id }] as const,
}

export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: () => getAll<Account>('/accounts') })

export const useAccountStats = () =>
  useQuery({
    queryKey: keys.stats,
    queryFn: async () => {
      const res = await api.get<One<{ accounts: AccountStats[] }>>(`/reports/accounts${qs({ year: thisYear() })}`)
      return new Map(res.data.accounts.map((s) => [s.accountId, s]))
    },
  })

export const useAccountSummary = (id: string) =>
  useQuery({
    queryKey: keys.summary(id),
    queryFn: async () => (await api.get<One<AccountSummary>>(`/reports/accounts/${id}${qs({ year: thisYear() })}`)).data,
  })

export const useAccountContacts = (id: string) =>
  useQuery({ queryKey: keys.contacts(id), queryFn: () => getAll<Contact>('/contacts', { accountId: id }) })

export const useAccountOpportunities = (id: string) =>
  useQuery({ queryKey: keys.opportunities(id), queryFn: () => getAll<Opportunity>('/opportunities', { accountId: id }) })

/** Create, update and delete accounts, keeping the cached list in step. */
export function useAccountMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.accounts })
    qc.invalidateQueries({ queryKey: ['reports'] })
  }
  const setOne = (a: Account) =>
    qc.setQueryData<Account[]>(keys.accounts, (list) => (list ? [...list.filter((x) => x.id !== a.id), a] : list))

  return {
    create: useMutation({
      mutationFn: async (body: AccountInput) => (await api.post<One<Account>>('/accounts', body)).data,
      onSuccess: (a) => {
        setOne(a)
        refresh()
      },
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: AccountInput & { id: string }) => (await api.patch<One<Account>>(`/accounts/${id}`, body)).data,
      onSuccess: (a) => {
        setOne(a)
        refresh()
      },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/accounts/${id}`),
      onSuccess: (_, id) => {
        // Drop the deleted account's cached details so nothing asks the server for them again.
        for (const key of [keys.summary(id), keys.contacts(id), activitiesKey({ accountId: id }), keys.opportunities(id)]) {
          qc.removeQueries({ queryKey: key, exact: true })
        }
        qc.setQueryData<Account[]>(keys.accounts, (list) => list?.filter((x) => x.id !== id))
        // Contacts linked to it are unlinked by the database.
        qc.invalidateQueries({ queryKey: ['contacts'] })
        refresh()
      },
    }),
  }
}
