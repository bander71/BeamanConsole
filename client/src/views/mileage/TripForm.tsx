import { useState } from 'react'
import type { Account, Contact, MileageRate, Resource, Trip, TripKind, Vehicle } from '../../api/types.ts'
import { useToast } from '../../components/toast-context.ts'
import { fm2, fmi, frate, today } from '../../lib/format.ts'
import { frequentTrips, lastOdometer, rateLookup, useTripMutations } from './data.ts'

const KIND_LABEL: Record<TripKind, string> = { business: 'Business', charitable: 'Charitable' }

/** Reads a number field: '' is null, anything that isn't a number is NaN. */
const num = (s: string) => {
  const v = s.trim().replace(/,/g, '')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}
const round1 = (n: number) => Math.round(n * 10) / 10
const str = (n: number | null | undefined) => (n == null ? '' : String(n))

function rememberedDriver() {
  try {
    return localStorage.getItem('bt.resource')
  } catch {
    return null
  }
}

interface Props {
  trip?: Trip // set when editing
  trips: Trip[]
  vehicles: Vehicle[]
  rates: MileageRate[]
  accounts: Account[]
  contacts: Contact[]
  resources: Resource[]
  onDone: () => void
}

/** "Log a trip" / "Edit trip" panel, as in the prototype. */
export function TripForm({ trip, trips, vehicles, rates, accounts, contacts, resources, onDone }: Props) {
  const toast = useToast()
  const { create, update, remove } = useTripMutations()
  const rateFor = rateLookup(rates)
  const activeVehicles = vehicles.filter((v) => v.active || v.id === trip?.vehicleId).sort((a, b) => a.name.localeCompare(b.name))

  // New trips start with the vehicle used most recently and its last odometer reading.
  const [init] = useState(() => {
    if (trip) return trip
    const latest = [...trips].sort((a, b) => b.tripDate.localeCompare(a.tripDate))[0]
    const vehicleId = latest?.vehicleId ?? activeVehicles[0]?.id ?? null
    const driver = rememberedDriver()
    return {
      tripDate: today(), vehicleId, kind: 'business' as TripKind, accountId: null, clientName: '', contactName: '', purpose: '', route: '',
      odometerStart: vehicleId ? lastOdometer(trips, vehicles, vehicleId) : null, odometerEnd: null, miles: null as number | null,
      resourceId: resources.find((r) => r.id === driver)?.id ?? resources[0]?.id ?? null,
    }
  })

  const [date, setDate] = useState(init.tripDate)
  const [vehicleId, setVehicleId] = useState(init.vehicleId ?? '')
  const [odoStart, setOdoStart] = useState(str(init.odometerStart))
  const [odoEnd, setOdoEnd] = useState(str(init.odometerEnd))
  const [miles, setMiles] = useState(str(init.miles))
  const [kind, setKind] = useState<TripKind>(init.kind)
  const [purpose, setPurpose] = useState(init.purpose)
  const [contactName, setContactName] = useState(init.contactName)
  // A trip can carry a client name that isn't linked to an account (from older data); keep it unless changed.
  const [client, setClient] = useState(init.accountId ?? (init.clientName ? 'text:' + init.clientName : ''))
  const [resourceId, setResourceId] = useState(init.resourceId ?? '')
  const [route, setRoute] = useState(init.route)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saving = create.isPending || update.isPending || remove.isPending

  // Client choices: client accounts, plus any account already used on a trip.
  const usedAccounts = new Set(trips.map((t) => t.accountId).filter(Boolean))
  const clientOptions = accounts.filter((a) => a.type === 'Client' || usedAccounts.has(a.id) || a.id === init.accountId)
    .sort((a, b) => a.name.localeCompare(b.name))
  const people = contacts.filter((c) => c.kind !== 'company')

  // Typing both odometer readings fills in the miles.
  function onOdometer(start: string, end: string) {
    setOdoStart(start)
    setOdoEnd(end)
    const s = num(start), e = num(end)
    if (s != null && e != null && !Number.isNaN(s) && !Number.isNaN(e) && e >= s) setMiles(String(round1(e - s)))
  }

  function onVehicle(id: string) {
    setVehicleId(id)
    if (!trip) {
      setOdoStart(str(lastOdometer(trips, vehicles, id)))
      setOdoEnd('')
    }
  }

  function repeat(t: Trip) {
    const start = t.vehicleId ? lastOdometer(trips, vehicles, t.vehicleId) : null
    setPurpose(t.purpose)
    setContactName(t.contactName)
    setClient(t.accountId ?? (t.clientName ? 'text:' + t.clientName : ''))
    setRoute(t.route)
    setKind(t.kind)
    setVehicleId(t.vehicleId ?? '')
    setMiles(String(t.miles))
    setOdoStart(str(start))
    setOdoEnd(start != null ? String(round1(start + t.miles)) : '')
    document.getElementById('tf-date')?.focus()
  }

  const milesNum = num(miles)
  const rate = rateFor(date, kind)
  const preview = milesNum && milesNum > 0 && date ? `${fmi(milesNum)} mi × ${frate(rate)} = ${fm2(milesNum * rate)}` : ''

  async function save() {
    const s = num(odoStart), e = num(odoEnd)
    let m = num(miles)
    if (!date) return toast('Enter the trip date.')
    if ([s, e, m].some((x) => Number.isNaN(x))) return toast('Odometer readings and miles must be numbers.')
    if (s != null && e != null) {
      if (e < s) return toast('Odometer end is lower than the start reading.')
      if (m == null) m = round1(e - s)
    }
    if (!(m != null && m > 0)) return toast('Enter the miles driven, or both odometer readings.')
    if (!purpose.trim()) return toast('Enter the business purpose of the trip.')

    const account = client.startsWith('text:') ? null : accounts.find((a) => a.id === client) ?? null
    const contact = people.find((c) => c.name.toLowerCase() === contactName.trim().toLowerCase())
    const body = {
      tripDate: date, vehicleId: vehicleId || null, kind, purpose: purpose.trim(), route: route.trim(),
      odometerStart: s, odometerEnd: e ?? (s != null ? round1(s + m) : null), miles: m,
      contactName: contactName.trim(), contactId: contact?.id ?? null,
      accountId: account?.id ?? null, clientName: account?.name ?? (client.startsWith('text:') ? client.slice(5) : ''),
      resourceId: resourceId || null,
    }
    try {
      if (trip) await update.mutateAsync({ id: trip.id, ...body })
      else await create.mutateAsync(body)
      toast(trip ? 'Trip updated' : `Logged ${fmi(m)} miles`)
      onDone()
    } catch (err) {
      toast("Couldn't save the trip. " + (err as Error).message)
    }
  }

  async function doDelete() {
    if (!trip) return
    try {
      await remove.mutateAsync(trip.id)
      toast('Trip deleted')
      onDone()
    } catch (err) {
      toast("Couldn't delete the trip. " + (err as Error).message)
    }
  }

  const frequent = trip ? [] : frequentTrips(trips)

  return (
    <section className="panel" id="tripForm">
      <div className="panel-h">
        <h2>{trip ? 'Edit trip' : 'Log a trip'}</h2>
        <span className="note">{trip ? `${trip.tripDate} · ${trip.purpose}` : 'Enter both odometer readings and miles fill in, or type miles directly.'}</span>
      </div>
      {frequent.length > 0 && (
        <div className="row" style={{ padding: '10px 14px 0', gap: 6 }}>
          <span className="note">Repeat a frequent trip:</span>
          {frequent.map(({ t }) => (
            <button key={t.id} className="btn sm" onClick={() => repeat(t)}>{t.purpose} · {fmi(t.miles)} mi</button>
          ))}
        </div>
      )}
      <form className="tform" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="lbl">Date<input type="date" className="field" id="tf-date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="lbl">Vehicle
          <select value={vehicleId} onChange={(e) => onVehicle(e.target.value)}>
            {!vehicleId && <option value="">None</option>}
            {activeVehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="lbl">Odometer start
          <input className="field num" inputMode="decimal" value={odoStart} onChange={(e) => onOdometer(e.target.value, odoEnd)} />
        </label>
        <label className="lbl">Odometer end
          <input className="field num" inputMode="decimal" value={odoEnd} onChange={(e) => onOdometer(odoStart, e.target.value)} />
        </label>
        <label className="lbl">Miles<input className="field num" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} /></label>
        <label className="lbl">Type
          <select value={kind} onChange={(e) => setKind(e.target.value as TripKind)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="lbl wide">Purpose<input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Work at McElroys" /></label>
        <label className="lbl">Contact
          <input className="field" list="contactNames" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Dan Beal" />
          <datalist id="contactNames">{people.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </label>
        <label className="lbl">Client
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">None</option>
            {client.startsWith('text:') && <option value={client}>{client.slice(5)}</option>}
            {clientOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="lbl">Driver
          <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            {!resourceId && <option value="">None</option>}
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="lbl full">Route
          <input className="field" value={route} onChange={(e) => setRoute(e.target.value)}
            placeholder="Home to McElroy's Inc., 3310 SW Topeka Blvd, Topeka, KS 66611 and home (66.8 × 2)" />
        </label>
        <button type="submit" hidden />
      </form>
      <div className="addline">
        <span className="note">{preview}</span>
        <span className="spacer" />
        {trip && (
          <>
            <button className="btn danger" onClick={() => setConfirmDelete(true)} disabled={saving}>Delete trip</button>
            <button className="btn" onClick={onDone} disabled={saving}>Cancel</button>
          </>
        )}
        <button className="btn primary" onClick={save} disabled={saving}>{trip ? 'Save changes' : 'Log trip'}</button>
      </div>
      {confirmDelete && trip && (
        <div className="confirm">
          <strong>Delete the {trip.tripDate} trip ({fmi(trip.miles)} mi)?</strong>
          <span className="note">This can't be undone.</span>
          <span className="spacer" />
          <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn danger" onClick={doDelete} disabled={saving}>Delete trip</button>
        </div>
      )}
    </section>
  )
}
