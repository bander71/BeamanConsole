// Period choices used by Mileage (and later Reports and Accounting), matching the prototype.
import { iso, monday, addDays, today } from './format.ts'

export type Range = 'week' | 'lastweek' | 'month' | 'lastmonth' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | 'lastyear' | 'all' | 'custom'

export const RANGE_LABELS: Record<Range, string> = {
  week: 'This week', lastweek: 'Last week', month: 'This month', lastmonth: 'Last month',
  q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4', ytd: 'Year to date', lastyear: 'Last year', all: 'All time', custom: 'Custom',
}

export const ALL_FROM = '0001-01-01'
export const ALL_TO = '9999-12-31'

/** Inclusive [from, to] dates for a period. "All time" and empty custom ends are open. */
export function rangeDates(range: Range, from = '', to = '', now = today()): [string, string] {
  const d = new Date(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1, Number(now.slice(8, 10)))
  const y = d.getFullYear(), m = d.getMonth()
  const ws = monday(now)
  switch (range) {
    case 'week': return [ws, addDays(ws, 6)]
    case 'lastweek': return [addDays(ws, -7), addDays(ws, -1)]
    case 'month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    case 'lastmonth': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'ytd': return [`${y}-01-01`, now]
    case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`]
    case 'q1': case 'q2': case 'q3': case 'q4': {
      const q = Number(range[1]) - 1
      return [iso(new Date(y, q * 3, 1)), iso(new Date(y, q * 3 + 3, 0))]
    }
    case 'custom': return [from || ALL_FROM, to || ALL_TO]
    default: return [ALL_FROM, ALL_TO]
  }
}

export const isAllTime = ([a]: [string, string]) => a === ALL_FROM
