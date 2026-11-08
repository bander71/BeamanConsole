import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { monday, today, addDays, weekLabel } from '../../lib/format.ts'
import { TimesheetSheet } from './TimesheetSheet.tsx'
import { useResources } from './data.ts'

const STORE_KEY = 'bt.resource' // same key the prototype used to remember the person

const remembered = () => {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

/** Weekly timesheet: pick a person and a week; the grid is TimesheetSheet. */
export function TimesheetView() {
  const [params, setParams] = useSearchParams()
  const resourcesQ = useResources()
  const resources = (resourcesQ.data ?? []).filter((r) => r.active || r.id === params.get('resource'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const resourceId = params.get('resource') ?? remembered() ?? resources[0]?.id ?? ''
  const resource = resources.find((r) => r.id === resourceId) ?? resources[0]
  const weekParam = params.get('week')
  const week = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? monday(weekParam) : monday(today())

  useEffect(() => {
    if (!resource) return
    try {
      localStorage.setItem(STORE_KEY, resource.id)
    } catch {
      // Private windows can block storage; remembering the person is only a convenience.
    }
  }, [resource])

  const go = (next: { resource?: string; week?: string }) =>
    setParams({ resource: next.resource ?? resource?.id ?? '', week: next.week ?? week })

  if (resourcesQ.isPending) return <div className="panel empty">Loading timesheet…</div>
  if (resourcesQ.isError) return <div className="panel empty"><h2>Couldn't load timesheets</h2><p className="note">{resourcesQ.error.message}</p></div>
  if (!resource) {
    return (
      <div className="panel empty">
        <h2>No resources yet</h2>
        <p className="note" style={{ margin: '8px auto 0' }}>Add a resource, a project and its tasks under Setup, then come back here to log hours.</p>
      </div>
    )
  }

  return (
    <>
      <div className="weekbar">
        <div>
          <div className="eyebrow">Weekly timesheet</div>
          <h1>{resource.name}</h1>
        </div>
        <span className="spacer" />
        <label className="lbl">
          Resource
          <select value={resource.id} onChange={(e) => go({ resource: e.target.value })}>
            {resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div className="weeknav" role="group" aria-label="Week">
          <button aria-label="Previous week" onClick={() => go({ week: addDays(week, -7) })}>‹</button>
          <span className="wk">{weekLabel(week)}</span>
          <button aria-label="Next week" onClick={() => go({ week: addDays(week, 7) })}>›</button>
        </div>
        <button className="btn quiet" onClick={() => go({ week: monday(today()) })}>This week</button>
      </div>
      {/* Keyed by person and week, so each sheet starts fresh and saves any pending edits when you leave it. */}
      <TimesheetSheet key={resource.id + week} resource={resource} week={week} />
    </>
  )
}
