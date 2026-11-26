import type { Trip } from '../../api/types.ts'
import { downloadCsv } from '../../lib/csv.ts'
import { DAYS, fm2, md, parse } from '../../lib/format.ts'
import { isMcElroysTrip, MCELROYS_TOLL } from './tolls.ts'

/** Tolls for McElroy's trips in the trips shown above (same period, vehicle and type filters). */
export function TollsSection({ trips, vehName, periodLabel, fileSuffix }: {
  trips: Trip[]
  vehName: (id: string | null) => string
  periodLabel: string
  fileSuffix: string
}) {
  const tolled = trips.filter(isMcElroysTrip).sort((a, b) => b.tripDate.localeCompare(a.tripDate))
  const total = Math.round(tolled.length * MCELROYS_TOLL * 100) / 100

  function exportCsv() {
    const rows = [...tolled].reverse().map((t) => [t.tripDate, t.purpose, vehName(t.vehicleId), MCELROYS_TOLL.toFixed(2)])
    downloadCsv(`beaman-tolls_${fileSuffix}.csv`, ['Date', 'Purpose', 'Vehicle', 'Toll'], [...rows, ['Total', '', '', total.toFixed(2)]])
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Tolls</h2>
        <span className="note">
          {fm2(MCELROYS_TOLL)} per round trip for every trip whose purpose says “Work at McElroys”. {tolled.length} in {periodLabel}.
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={exportCsv} disabled={!tolled.length}>Export tolls (CSV)</button>
      </div>
      <div className="stats">
        {([
          ['Round trips', tolled.length],
          ['Toll per round trip', fm2(MCELROYS_TOLL)],
          ['Total tolls', fm2(total)],
        ] as const).map(([k, v]) => <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
      </div>
      <div className="scroll">
        <table style={{ minWidth: 560 }}>
          <thead><tr><th>Date</th><th>Purpose</th><th>Vehicle</th><th className="n">Toll</th></tr></thead>
          <tbody>
            {tolled.length ? tolled.map((t) => (
              <tr key={t.id}>
                <td className="num">{md(t.tripDate)}/{t.tripDate.slice(2, 4)}<span className="sub">{DAYS[(parse(t.tripDate).getDay() + 6) % 7]}</span></td>
                <td>{t.purpose}</td>
                <td>{vehName(t.vehicleId)}</td>
                <td className="n num">{fm2(MCELROYS_TOLL)}</td>
              </tr>
            )) : <tr><td colSpan={4} className="empty">No McElroy's trips in this period.</td></tr>}
          </tbody>
          {tolled.length > 0 && (
            <tfoot><tr><td colSpan={3}>Total ({tolled.length} round trips)</td><td className="n num">{fm2(total)}</td></tr></tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
