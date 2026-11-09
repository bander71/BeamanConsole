import { useMemo, useState } from 'react'
import type { MileageRate, Trip, TripKind, Vehicle } from '../../api/types.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { DAYS, fm2, fmi, frate, md, odo, parse, pct, today } from '../../lib/format.ts'
import { isAllTime, RANGE_LABELS, rangeDates, type Range } from '../../lib/periods.ts'
import { useAccounts } from '../accounts/data.ts'
import { useContacts } from '../contacts/data.ts'
import { useResources } from '../timesheet/data.ts'
import { TripForm } from './TripForm.tsx'
import { rateLookup, useRates, useTrips, useVehicles } from './data.ts'

const KIND_LABEL: Record<TripKind, string> = { business: 'Business', charitable: 'Charitable' }
const RANGES: Range[] = ['month', 'lastmonth', 'q1', 'q2', 'q3', 'q4', 'ytd', 'lastyear', 'all', 'custom']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NO_TRIPS: Trip[] = []
const NO_VEHICLES: Vehicle[] = []
const NO_RATES: MileageRate[] = []

export function MileageView() {
  const tripsQ = useTrips()
  const vehiclesQ = useVehicles()
  const ratesQ = useRates()
  const resourcesQ = useResources()
  const vehicles = vehiclesQ.data ?? NO_VEHICLES
  const rates = ratesQ.data ?? NO_RATES
  const accounts = useAccounts().data ?? []
  const contacts = useContacts().data ?? []
  const resources = resourcesQ.data ?? []
  const [range, setRange] = useState<Range>('ytd')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [kind, setKind] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0) // bumped to reset the form after logging a trip
  const [td] = useState(today)

  const trips = tripsQ.data ?? NO_TRIPS
  const rateFor = useMemo(() => rateLookup(rates), [rates])
  const value = (t: Trip) => t.miles * rateFor(t.tripDate, t.kind)
  const vehName = (id: string | null) => vehicles.find((v) => v.id === id)?.name ?? '—'
  const period = rangeDates(range, from, to, td)

  const list = useMemo(() => {
    const [a, b] = rangeDates(range, from, to, td)
    return trips
      .filter((t) => t.tripDate >= a && t.tripDate <= b && (!vehicle || t.vehicleId === vehicle) && (!kind || t.kind === kind))
      .sort((x, y) => y.tripDate.localeCompare(x.tripDate) || (y.odometerStart ?? 0) - (x.odometerStart ?? 0))
  }, [trips, range, from, to, td, vehicle, kind])

  const totals = useMemo(() => {
    const t = { miles: 0, business: 0, charitable: 0, value: 0 }
    for (const x of list) {
      t.miles += x.miles
      if (x.kind === 'charitable') t.charitable += x.miles
      else t.business += x.miles
      t.value += x.miles * rateFor(x.tripDate, x.kind)
    }
    return t
  }, [list, rateFor])

  const months = useMemo(() => {
    const m = new Map<string, { business: number; charitable: number; value: number; n: number }>()
    for (const t of list) {
      const k = t.tripDate.slice(0, 7)
      const x = m.get(k) ?? { business: 0, charitable: 0, value: 0, n: 0 }
      x.n++
      x[t.kind === 'charitable' ? 'charitable' : 'business'] += t.miles
      x.value += t.miles * rateFor(t.tripDate, t.kind)
      m.set(k, x)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [list, rateFor])
  const monthMax = Math.max(1, ...months.map(([, x]) => x.business + x.charitable))

  const clients = useMemo(() => {
    const m = new Map<string, { n: number; miles: number; value: number }>()
    for (const t of list) {
      const k = t.clientName || 'Unassigned'
      const x = m.get(k) ?? { n: 0, miles: 0, value: 0 }
      x.n++
      x.miles += t.miles
      x.value += t.miles * rateFor(t.tripDate, t.kind)
      m.set(k, x)
    }
    return [...m.entries()].sort((a, b) => b[1].miles - a[1].miles)
  }, [list, rateFor])

  // Vehicles this year: latest odometer minus the Jan 1 reading gives total miles driven.
  const year = td.slice(0, 4)
  const vehicleRows = useMemo(() => [...vehicles].sort((a, b) => a.name.localeCompare(b.name)).map((v) => {
    const ts = trips.filter((t) => t.vehicleId === v.id && t.tripDate.startsWith(year))
    const ends = ts.map((t) => t.odometerEnd ?? 0).filter((x) => x > 0)
    const latest = ends.length ? Math.max(...ends) : null
    const logged = ts.reduce((s, t) => s + t.miles, 0)
    const driven = latest != null && v.startOdometer != null ? latest - v.startOdometer : null
    return { v, latest, logged, driven, n: ts.length }
  }), [vehicles, trips, year])

  const currentRate = (k: TripKind) => rateFor(td, k)
  const hasRates = rates.some((r) => r.effectiveDate <= td)
  const editTrip = editing ? trips.find((t) => t.id === editing) : undefined

  function openTrip(id: string) {
    setEditing(id)
    document.getElementById('tripForm')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function exportCsv() {
    const cols = ['Date', 'Vehicle', 'Odometer start', 'Odometer end', 'Miles', 'Type', 'Purpose', 'Contact', 'Client', 'Route', 'Driver', 'Rate', 'Value']
    const driver = (id: string | null) => resources.find((r) => r.id === id)?.name ?? ''
    const rows = [...list].reverse().map((t) => [t.tripDate, vehName(t.vehicleId), t.odometerStart ?? '', t.odometerEnd ?? '', t.miles,
      KIND_LABEL[t.kind], t.purpose, t.contactName, t.clientName, t.route, driver(t.resourceId), rateFor(t.tripDate, t.kind), value(t).toFixed(2)])
    downloadCsv(`beaman-mileage_${isAllTime(period) ? 'all' : `${period[0]}_to_${period[1]}`}.csv`, cols, rows)
  }

  // The trip form picks its defaults (vehicle, odometer, driver) from these, so wait for all of them.
  const queries = [tripsQ, vehiclesQ, ratesQ, resourcesQ]
  const failed = queries.find((q) => q.isError)
  if (failed) return <div className="panel empty"><h2>Couldn't load mileage</h2><p className="note">{failed.error?.message}</p></div>
  if (queries.some((q) => q.isPending)) return <div className="panel empty">Loading mileage…</div>

  return (
    <>
      <div className="row">
        <div>
          <div className="eyebrow">Vehicle log</div>
          <h1>Mileage</h1>
        </div>
        <span className="spacer" />
        <span className="note">
          {hasRates
            ? `Current rates: ${frate(currentRate('business'))}/mi business, ${frate(currentRate('charitable'))}/mi charitable`
            : 'Add a mileage rate under Setup to value trips.'}
        </span>
      </div>

      <TripForm key={editTrip ? editTrip.id : 'new-' + formKey} trip={editTrip} trips={trips} vehicles={vehicles} rates={rates}
        accounts={accounts} contacts={contacts} resources={resources}
        onDone={() => { setEditing(null); setFormKey((k) => k + 1) }} />

      <div className="row">
        <label className="lbl">Period
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
          </select>
        </label>
        {range === 'custom' && (
          <>
            <label className="lbl">From<input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="lbl">To<input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
        <label className="lbl">Vehicle
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="">All vehicles</option>
            {[...vehicles].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="lbl">Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export mileage log (CSV)</button>
      </div>

      <section className="panel">
        <div className="stats" style={{ borderTop: 0 }}>
          {([
            ['Trips', list.length],
            ['Business miles', fmi(totals.business)],
            ['Charitable miles', fmi(totals.charitable)],
            ['Total miles', fmi(totals.miles)],
            ['Deduction value', fm2(totals.value)],
          ] as const).map(([k, v]) => <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
        </div>
      </section>

      <div className="two">
        <section className="panel">
          <div className="panel-h">
            <h2>By month</h2>
            <span className="note"><span className="key kb" />Business <span className="key kc" />Charitable</span>
          </div>
          <div className="scroll">
            <table>
              <thead><tr><th>Month</th><th style={{ width: '40%' }}>Miles</th><th className="n">Total</th><th className="n">Value</th></tr></thead>
              <tbody>
                {months.length ? months.map(([k, x]) => {
                  const d = parse(k + '-01')
                  return (
                    <tr key={k}>
                      <td>{MON[d.getMonth()]} {d.getFullYear()}<span className="sub">{x.n} trip{x.n > 1 ? 's' : ''}</span></td>
                      <td>
                        <div className="mbar">
                          <i className="kb" style={{ width: `${(x.business / monthMax) * 100}%` }} />
                          <i className="kc" style={{ width: `${(x.charitable / monthMax) * 100}%` }} />
                        </div>
                      </td>
                      <td className="n num">{fmi(x.business + x.charitable)}</td>
                      <td className="n num">{fm2(x.value)}</td>
                    </tr>
                  )
                }) : <tr><td colSpan={4} className="empty">No trips in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>By client</h2></div>
          <div className="scroll">
            <table>
              <thead><tr><th>Client</th><th className="n">Trips</th><th className="n">Miles</th><th className="n">Value</th></tr></thead>
              <tbody>
                {clients.length ? clients.map(([k, x]) => (
                  <tr key={k}><td>{k}</td><td className="n num">{x.n}</td><td className="n num">{fmi(x.miles)}</td><td className="n num">{fm2(x.value)}</td></tr>
                )) : <tr><td colSpan={4} className="empty">No trips in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-h">
          <h2>Vehicles, {year}</h2>
          <span className="note">Total miles driven is the latest logged odometer reading minus the January 1 reading. Logged miles over total gives the business-use share your tax preparer will ask for.</span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr><th>Vehicle</th><th className="n">Jan 1 odometer</th><th className="n">Latest reading</th><th className="n">Total driven</th>
                <th className="n">Logged trips</th><th className="n">Logged miles</th><th className="n">Business use</th></tr>
            </thead>
            <tbody>
              {vehicleRows.length ? vehicleRows.map((r) => (
                <tr key={r.v.id}>
                  <td>{r.v.name}</td>
                  <td className="n num">{odo(r.v.startOdometer)}</td>
                  <td className="n num">{odo(r.latest)}</td>
                  <td className="n num">{r.driven != null ? fmi(r.driven) : '—'}</td>
                  <td className="n num">{r.n}</td>
                  <td className="n num">{fmi(r.logged)}</td>
                  <td className="n num">{r.driven && r.driven > 0 ? pct(r.logged / r.driven) : '—'}</td>
                </tr>
              )) : <tr><td colSpan={7} className="empty">Add a vehicle under Setup.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>Trips</h2>
          <span className="note">
            {list.length} in {isAllTime(period) ? 'all dates' : `${parse(period[0]).toLocaleDateString()} – ${parse(period[1]).toLocaleDateString()}`}. Select a trip to edit it.
          </span>
        </div>
        <div className="scroll">
          <table style={{ minWidth: 900 }}>
            <thead>
              <tr><th>Date</th><th>Purpose</th><th>Client</th><th>Vehicle</th><th className="n">Odometer</th><th className="n">Miles</th>
                <th>Type</th><th className="n">Rate</th><th className="n">Value</th></tr>
            </thead>
            <tbody>
              {list.length ? list.map((t) => (
                <tr key={t.id} className={'click' + (t.id === editing ? ' sel' : '')} tabIndex={0}
                  onClick={() => openTrip(t.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTrip(t.id))}>
                  <td className="num">{md(t.tripDate)}<span className="sub">{DAYS[(parse(t.tripDate).getDay() + 6) % 7]}</span></td>
                  <td>{t.purpose}<span className="sub">{t.contactName}</span></td>
                  <td>{t.clientName || '—'}</td>
                  <td>{vehName(t.vehicleId)}</td>
                  <td className="n num" style={{ whiteSpace: 'nowrap' }}>{t.odometerStart != null ? `${odo(t.odometerStart)} → ${odo(t.odometerEnd)}` : '—'}</td>
                  <td className="n num">{fmi(t.miles)}</td>
                  <td><span className={'chip' + (t.kind === 'charitable' ? '' : ' bill')}>{KIND_LABEL[t.kind]}</span></td>
                  <td className="n num">{frate(rateFor(t.tripDate, t.kind))}</td>
                  <td className="n num">{fm2(value(t))}</td>
                </tr>
              )) : <tr><td colSpan={9} className="empty">No trips match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="note">Each trip is valued at the IRS standard rate in effect on its date. Rates and vehicles are kept under Setup.</p>
    </>
  )
}
