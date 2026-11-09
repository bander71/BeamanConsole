import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, getAll, type One } from '../../api/client.ts'
import type { MileageRate, Trip, TripInput, TripKind, Vehicle } from '../../api/types.ts'

const TRIPS_KEY = ['trips', 'all']
export const useTrips = () => useQuery({ queryKey: TRIPS_KEY, queryFn: () => getAll<Trip>('/trips') })
export const useVehicles = () => useQuery({ queryKey: ['vehicles'], queryFn: () => getAll<Vehicle>('/vehicles') })
export const useRates = () =>
  useQuery({ queryKey: ['mileage-rates'], queryFn: async () => (await api.get<One<MileageRate[]>>('/mileage-rates')).data })

export function useTripMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['trips'] }) // also the Timesheet's weekly mileage
    qc.invalidateQueries({ queryKey: ['reports'] }) // account miles, contact trips
  }
  // Update the cached list right away, so the reset form's defaults (last vehicle, odometer) see the change.
  const setTrips = (fn: (list: Trip[]) => Trip[]) => qc.setQueryData<Trip[]>(TRIPS_KEY, (list) => (list ? fn(list) : list))
  return {
    create: useMutation({
      mutationFn: async (body: TripInput) => (await api.post<One<Trip>>('/trips', body)).data,
      onSuccess: (t) => { setTrips((l) => [...l, t]); refresh() },
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: TripInput & { id: string }) => (await api.patch<One<Trip>>(`/trips/${id}`, body)).data,
      onSuccess: (t) => { setTrips((l) => l.map((x) => (x.id === t.id ? t : x))); refresh() },
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/trips/${id}`),
      onSuccess: (_, id) => { setTrips((l) => l.filter((x) => x.id !== id)); refresh() },
    }),
  }
}

/** The IRS rate in effect on a date for a kind of trip (0 if none is set yet). */
export function rateLookup(rates: MileageRate[]) {
  const sorted = [...rates].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  return (date: string, kind: TripKind) => {
    let r = 0
    for (const x of sorted) if (x.kind === kind && x.effectiveDate <= date) r = x.ratePerMile
    return r
  }
}

/** The last odometer reading for a vehicle: its latest trip's end reading, or its starting odometer. */
export function lastOdometer(trips: Trip[], vehicles: Vehicle[], vehicleId: string, exceptTripId?: string): number | null {
  let best: Trip | null = null
  for (const t of trips) {
    if (t.vehicleId !== vehicleId || t.odometerEnd == null || t.id === exceptTripId) continue
    if (!best || t.tripDate > best.tripDate || (t.tripDate === best.tripDate && t.odometerEnd > best.odometerEnd!)) best = t
  }
  if (best) return best.odometerEnd
  return vehicles.find((v) => v.id === vehicleId)?.startOdometer ?? null
}

/** Trips taken more than once (same purpose, miles and client), most frequent first. */
export function frequentTrips(trips: Trip[], limit = 6) {
  const groups = new Map<string, { n: number; t: Trip }>()
  for (const t of trips) {
    const k = [t.purpose, t.miles, t.clientName].join('|')
    const g = groups.get(k)
    if (!g) groups.set(k, { n: 1, t })
    else {
      g.n++
      if (t.tripDate > g.t.tripDate) g.t = t
    }
  }
  return [...groups.values()].filter((g) => g.n > 1).sort((a, b) => b.n - a.n).slice(0, limit)
}
