import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'

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

export interface ImportResult {
  applied: boolean
  connections: number
  skippedNoName: number
  matchedByLink: number
  matchedByEmail: number
  matchedByName: number
  updated: number
  unchanged: number
  added: number
  linkedToAccount: number
  updates: { contactId: string; name: string; fields: string[] }[]
  additions: { name: string; company: string; title: string }[]
}

/** Splits CSV text into rows of cells (handles quotes, doubled quotes and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
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

/** Preview (apply: false) or run the import, then refresh contacts and their reports. */
export function useLinkedInImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: { rows: Connection[]; apply: boolean }) => (await api.post<{ data: ImportResult }>('/contacts/import/linkedin', b)).data,
    onSuccess: (r) => {
      if (!r.applied) return
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}
