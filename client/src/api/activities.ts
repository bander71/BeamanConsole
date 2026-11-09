import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getAll, type One } from './client.ts'
import type { Activity, ActivityType } from './types.ts'

/** Whose notes these are: exactly one of a contact, an account or an opportunity. */
export type ActivityParent = { contactId: string } | { accountId: string } | { opportunityId: string }

export const activitiesKey = (parent: ActivityParent) => ['activities', parent] as const

export const useActivities = (parent: ActivityParent) =>
  useQuery({ queryKey: activitiesKey(parent), queryFn: () => getAll<Activity>('/activities', parent) })

export function useActivityMutations(parent: ActivityParent) {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: activitiesKey(parent) })
    // "Last activity" and "last contacted" come from reports.
    qc.invalidateQueries({ queryKey: ['reports'] })
  }
  return {
    add: useMutation({
      mutationFn: (body: { activityDate: string; type: ActivityType; body: string }) =>
        api.post<One<Activity>>('/activities', { ...body, ...parent }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/activities/${id}`),
      onSuccess: refresh,
    }),
  }
}
