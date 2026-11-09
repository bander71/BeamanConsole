import { useState } from 'react'
import { useActivities, useActivityMutations, type ActivityParent } from '../api/activities.ts'
import { ACTIVITY_TYPES, type ActivityType } from '../api/types.ts'
import { md, today } from '../lib/format.ts'
import { useToast } from './toast-context.ts'

/** "Notes & activity": an add form and the dated list, for a contact, account or opportunity. */
export function ActivityLog({ parent, placeholder }: { parent: ActivityParent; placeholder: string }) {
  const toast = useToast()
  const activities = useActivities(parent).data ?? []
  const log = useActivityMutations(parent)
  const [td] = useState(today)
  const [date, setDate] = useState(td)
  const [type, setType] = useState<ActivityType>('Note')
  const [text, setText] = useState('')

  const add = () => {
    const body = text.trim()
    if (!body) return toast('Write a short note first.')
    log.add.mutate({ activityDate: date || td, type, body }, {
      onSuccess: () => { setText(''); toast('Note added') },
      onError: (e) => toast("Couldn't add the note. " + e.message),
    })
  }

  const sorted = [...activities].sort((x, y) => y.activityDate.localeCompare(x.activityDate) || y.createdAt.localeCompare(x.createdAt))

  return (
    <>
      <h3 className="h3">Notes &amp; activity</h3>
      <form className="logform" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <select value={type} onChange={(e) => setType(e.target.value as ActivityType)} aria-label="Type">
          {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Activity note" />
        <button className="btn primary sm" disabled={log.add.isPending}>Add</button>
      </form>
      <ul className="tl">
        {sorted.length ? sorted.map((x) => (
          <li key={x.id}>
            <span className="num">{md(x.activityDate)}/{x.activityDate.slice(2, 4)}</span>
            <span className="chip">{x.type}</span>
            <span>{x.body}</span>
            <button className="btn quiet sm" aria-label="Remove entry"
              onClick={() => log.remove.mutate(x.id, { onSuccess: () => toast('Entry removed') })}>✕</button>
          </li>
        )) : <li className="note">No activity logged yet.</li>}
      </ul>
    </>
  )
}
