import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getAll, type One } from '../../api/client.ts'
import type { Employee, Opportunity, OpportunityInput, Project } from '../../api/types.ts'

const OPPS_KEY = ['opportunities', 'all']
const LINKS_KEY = ['opportunity-contacts']

export const useOpportunities = () => useQuery({ queryKey: OPPS_KEY, queryFn: () => getAll<Opportunity>('/opportunities') })

/** opportunityId -> contactIds, for every opportunity. */
export const useOppContacts = () =>
  useQuery({
    queryKey: LINKS_KEY,
    queryFn: async () => {
      const res = await api.get<One<{ opportunityId: string; contactId: string }[]>>('/opportunity-contacts')
      const map = new Map<string, string[]>()
      for (const l of res.data) map.set(l.opportunityId, [...(map.get(l.opportunityId) ?? []), l.contactId])
      return map
    },
  })

export const useEmployees = () => useQuery({ queryKey: ['employees'], queryFn: () => getAll<Employee>('/employees') })

export const employeeName = (e: Employee | undefined) => (e ? [e.firstName, e.lastName].filter(Boolean).join(' ') : '')
export const employeeInitials = (e: Employee | undefined) => (e ? ((e.firstName[0] ?? '?') + (e.lastName[0] ?? '')).toUpperCase() : '—')

export function useOpportunityMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['opportunities'] }) // the board and the per-account lists
    qc.invalidateQueries({ queryKey: LINKS_KEY })
    qc.invalidateQueries({ queryKey: ['reports'] }) // per-contact opportunity lists
  }
  const setOne = (o: Opportunity) =>
    qc.setQueryData<Opportunity[]>(OPPS_KEY, (list) => (list ? [...list.filter((x) => x.id !== o.id), o] : list))

  return {
    /** Create or update, then replace the linked contacts. */
    save: useMutation({
      mutationFn: async ({ id, contactIds, ...body }: OpportunityInput & { id?: string; contactIds: string[] }) => {
        const o = id
          ? (await api.patch<One<Opportunity>>(`/opportunities/${id}`, body)).data
          : (await api.post<One<Opportunity>>('/opportunities', body)).data
        await api.put(`/opportunities/${o.id}/contacts`, { contactIds })
        return o
      },
      onSuccess: (o) => { setOne(o); refresh() },
    }),
    /** Change just the stage (drag and drop). Updates the board right away. */
    move: useMutation({
      mutationFn: async ({ id, ...patch }: OpportunityInput & { id: string }) =>
        (await api.patch<One<Opportunity>>(`/opportunities/${id}`, patch)).data,
      onMutate: ({ id, ...patch }) => {
        const before = qc.getQueryData<Opportunity[]>(OPPS_KEY)
        qc.setQueryData<Opportunity[]>(OPPS_KEY, (list) => list?.map((o) => (o.id === id ? { ...o, ...patch } : o)))
        return { before }
      },
      onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(OPPS_KEY, ctx.before) },
      onSuccess: (o) => { setOne(o); refresh() },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/opportunities/${id}`),
      onSuccess: (_, id) => {
        qc.setQueryData<Opportunity[]>(OPPS_KEY, (list) => list?.filter((o) => o.id !== id))
        refresh()
      },
    }),
    convert: useMutation({
      mutationFn: async ({ id, ...body }: { id: string; code: string; name: string; type: string; startDate: string }) =>
        (await api.post<One<{ project: Project; opportunity: Opportunity }>>(`/opportunities/${id}/convert`, body)).data,
      onSuccess: ({ opportunity }) => {
        setOne(opportunity)
        refresh()
        qc.invalidateQueries({ queryKey: ['projects'] })
      },
    }),
  }
}
