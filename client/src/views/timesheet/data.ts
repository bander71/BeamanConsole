import { useQuery } from '@tanstack/react-query'
import { api, getAll, qs, type List, type One } from '../../api/client.ts'
import type { Account, Project, Resource, Task, Timesheet, Trip } from '../../api/types.ts'
import { addDays } from '../../lib/format.ts'

export const sheetKey = (resourceId: string, week: string) => ['timesheet', resourceId, week] as const

export const useResources = () =>
  useQuery({ queryKey: ['resources'], queryFn: () => getAll<Resource>('/resources') })

export const useProjects = () =>
  useQuery({ queryKey: ['projects'], queryFn: () => getAll<Project>('/projects') })

/** Same key as the Accounts screen, so the list is shared. */
export const useAccountsList = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => getAll<Account>('/accounts') })

export const useResourceTasks = (resourceId: string | undefined) =>
  useQuery({
    queryKey: ['tasks', { resourceId }],
    queryFn: () => getAll<Task>('/tasks', { resourceId }),
    enabled: !!resourceId,
  })

export const useSheet = (resourceId: string, week: string) =>
  useQuery({
    queryKey: sheetKey(resourceId, week),
    queryFn: async () => (await api.get<One<Timesheet>>(`/resources/${resourceId}/timesheets/${week}`)).data,
    // Don't refetch underneath someone who is typing; saves update the cache directly.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

export const useWeekTrips = (resourceId: string, week: string) =>
  useQuery({
    queryKey: ['trips', { resourceId, week }],
    queryFn: () => getAll<Trip>('/trips', { resourceId, from: week, to: addDays(week, 6) }),
  })

/** Number of timesheets waiting for approval (the badge on the Approvals tab). */
export const useSubmittedCount = () =>
  useQuery({
    queryKey: ['timesheets', 'submittedCount'],
    queryFn: async () => (await api.get<List<unknown>>(`/timesheets${qs({ status: 'submitted', limit: 1 })}`)).total,
    refetchInterval: 60_000,
  })
