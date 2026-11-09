// Number and date formatting, matching the prototype.
// Dates are 'YYYY-MM-DD' strings and are always read as local dates.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** $1,235 */
export const fm = (n: number | null | undefined) => usd.format(Number(n) || 0)
/** $1,234.50 */
export const fm2 = (n: number | null | undefined) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** 12.50 (hours) */
export const fh2 = (n: number | null | undefined) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)
/** 12.5 (hours, trailing zeros dropped) */
export const fh = (n: number | null | undefined) => {
  const r = Math.round((Number(n) || 0) * 100) / 100
  return r.toFixed(2).replace(/\.?0+$/, '') || '0'
}
/** Reads hours typed as decimals (1.5) or h:mm (1:30). Empty is 0; anything else is NaN. */
export const parseHours = (raw: string) => {
  const v = raw.trim()
  if (!v) return 0
  const m = v.match(/^(\d+):(\d{1,2})$/)
  if (m) return Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}
/** 1,234.5 (miles) */
export const fmi = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** $0.725 per mile (trailing zero dropped: $0.70) */
export const frate = (n: number | null | undefined) => '$' + (Number(n) || 0).toFixed(3).replace(/0$/, '')
/** 95,842.2 (odometer), or — when missing */
export const odo = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
/** 75% */
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n * 100) + '%')

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y!, m! - 1, d)
}
export const today = () => iso(new Date())
export const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
/** 11/8/2026 */
export const shortDate = (s: string | null | undefined) => (s ? parse(s).toLocaleDateString() : '—')
/** 11/8 */
export const md = (s: string) => {
  const d = parse(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The Monday on or before a date. */
export const monday = (s: string) => {
  const d = parse(s)
  return addDays(s, -((d.getDay() + 6) % 7))
}
/** Nov 2 – 8, 2026 or Oct 26 – Nov 1, 2026 */
export const weekLabel = (weekStart: string) => {
  const a = parse(weekStart)
  const b = parse(addDays(weekStart, 6))
  return `${MON[a.getMonth()]} ${a.getDate()} – ${a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' '}${b.getDate()}, ${b.getFullYear()}`
}

/** Two-letter avatar text from a name. */
export const initials = (name: string) => name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()

/** Name comparison used for matching aliases, as in the prototype. */
export const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b(inc|llc|co|corp|technologies|technology|group|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
