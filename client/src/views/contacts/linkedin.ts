import { parseCsv } from '../../lib/csv.ts'

/** One connection from LinkedIn's Connections.csv. */
export interface Connection {
  firstName: string
  lastName: string
  url: string
  email: string
  company: string
  position: string
  connectedOn: string | null
}

const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
/** "02 Nov 2026" → "2026-11-02" */
const isoDate = (s: string) => {
  const m = /^(\d{1,2}) (\w{3}) (\d{4})$/.exec(s.trim())
  return m && MON[m[2]!] ? `${m[3]}-${MON[m[2]!]}-${m[1]!.padStart(2, '0')}` : null
}

/** Reads LinkedIn's Connections.csv. LinkedIn puts a few lines of notes above the column names, so those are skipped. */
export function parseConnections(text: string): Connection[] {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  const h = rows.findIndex((r) => r.map((c) => c.trim()).includes('First Name') && r.map((c) => c.trim()).includes('Last Name'))
  if (h < 0) throw new Error("This doesn't look like LinkedIn's Connections.csv: there's no First Name / Last Name column.")
  const cols = rows[h]!.map((c) => c.trim())
  const at = (r: string[], name: string) => (r[cols.indexOf(name)] ?? '').trim()
  return rows
    .slice(h + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => ({
      firstName: at(r, 'First Name'),
      lastName: at(r, 'Last Name'),
      url: at(r, 'URL'),
      email: at(r, 'Email Address'),
      company: at(r, 'Company'),
      position: at(r, 'Position'),
      connectedOn: isoDate(at(r, 'Connected On')),
    }))
}
