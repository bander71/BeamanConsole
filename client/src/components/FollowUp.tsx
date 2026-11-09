import { useState } from 'react'
import { addDays, parse, today } from '../lib/format.ts'

/** "Next follow-up" box with quick buttons, as in the prototype's contacts and accounts. */
export function FollowUp({ value, onChange }: { value: string | null; onChange: (date: string | null) => void }) {
  const [td] = useState(today)
  const label = value
    ? parse(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      (value < td ? ' · overdue' : value === td ? ' · today' : '')
    : 'None set'
  return (
    <div className={'followup' + (value && value <= td ? ' due' : '')}>
      <div><span className="k">Next follow-up</span><b>{label}</b></div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => onChange(addDays(td, 7))}>In 1 week</button>
        <button className="btn sm" onClick={() => onChange(addDays(td, 30))}>In 1 month</button>
        <button className="btn sm" onClick={() => onChange(addDays(td, 90))}>In 3 months</button>
        <input type="date" className="field" value={value ?? ''} aria-label="Follow-up date" style={{ padding: '3px 6px' }}
          onChange={(e) => e.target.value && onChange(e.target.value)} />
        {value && <button className="btn quiet sm" onClick={() => onChange(null)}>Clear</button>}
      </div>
    </div>
  )
}
