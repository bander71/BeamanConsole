import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesKey } from '../../api/activities.ts'
import { api, getAll, type One } from '../../api/client.ts'
import type { Account, Contact, ContactInput, ContactSummary } from '../../api/types.ts'
import { norm } from '../../lib/format.ts'

export const keys = {
  contacts: ['contacts'] as const,
  last: ['reports', 'contacts'] as const,
  summary: (id: string) => ['reports', 'contacts', id] as const,
}

export const useContacts = () =>
  useQuery({ queryKey: keys.contacts, queryFn: () => getAll<Contact>('/contacts') })

/** Last contacted date for every contact (latest note or trip). */
export const useContactLast = () =>
  useQuery({
    queryKey: keys.last,
    queryFn: async () => {
      const res = await api.get<One<{ contactId: string; lastActivity: string | null }[]>>('/reports/contacts')
      return new Map(res.data.map((r) => [r.contactId, r.lastActivity]))
    },
  })

export const useContactSummary = (id: string) =>
  useQuery({ queryKey: keys.summary(id), queryFn: async () => (await api.get<One<ContactSummary>>(`/reports/contacts/${id}`)).data })

export function useContactMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] }) // also the per-account lists on the Accounts screen
    qc.invalidateQueries({ queryKey: ['reports'] })
  }
  const setOne = (c: Contact) =>
    qc.setQueryData<Contact[]>(keys.contacts, (list) => (list ? [...list.filter((x) => x.id !== c.id), c] : list))

  return {
    create: useMutation({
      mutationFn: async (body: ContactInput) => (await api.post<One<Contact>>('/contacts', body)).data,
      onSuccess: (c) => { setOne(c); refresh() },
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: ContactInput & { id: string }) => (await api.patch<One<Contact>>(`/contacts/${id}`, body)).data,
      onSuccess: (c) => { setOne(c); refresh() },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/contacts/${id}`),
      onSuccess: (_, id) => {
        qc.removeQueries({ queryKey: keys.summary(id), exact: true })
        qc.removeQueries({ queryKey: activitiesKey({ contactId: id }), exact: true })
        qc.setQueryData<Contact[]>(keys.contacts, (list) => list?.filter((x) => x.id !== id))
        refresh()
      },
    }),
  }
}

/** Finds the account a company name points to, by name or alias (same matching as the prototype). */
export function accountMatcher(accounts: Account[]) {
  const idx = new Map<string, Account>()
  for (const a of accounts) {
    for (const n of [a.name, ...a.aliases]) {
      const k = norm(n)
      if (k && !idx.has(k)) idx.set(k, a)
    }
  }
  return (name: string | null | undefined) => (name ? idx.get(norm(name)) : undefined)
}

export const isCompany = (c: Pick<Contact, 'kind'>) => c.kind === 'company'

/** Two-letter avatar: first and last initial for people, first two letters for companies. */
export const contactInitials = (c: Contact) =>
  (isCompany(c) ? (c.name || '?').slice(0, 2) : (c.firstName || c.name || '?')[0]! + (c.lastName[0] ?? '')).toUpperCase()

/** Contacts that share a name, email or mobile number with another contact. */
export function findDuplicates(contacts: Contact[]) {
  const by = new Map<string, Set<string>>()
  const add = (k: string, id: string) => {
    if (k.length <= 4) return
    if (!by.has(k)) by.set(k, new Set())
    by.get(k)!.add(id)
  }
  for (const c of contacts) {
    add('n:' + norm(c.name), c.id)
    for (const e of c.emails) add('e:' + e.toLowerCase(), c.id)
    add('p:' + c.mobile.replace(/\D/g, ''), c.id)
  }
  const out = new Set<string>()
  for (const ids of by.values()) if (ids.size > 1) ids.forEach((i) => out.add(i))
  return out
}
