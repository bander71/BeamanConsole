import { parseCsv } from '../../lib/csv.ts'
import { readXlsx } from '../../lib/xlsx.ts'

/** One entry from an Outlook contact list. */
export interface OutlookRow {
  name: string
  emails: string[]
  company: string
  title: string
  mobile: string
  businessPhone: string
  homePhone: string
  signaturePhones: string
}

const h = (s: string) => s.trim().toLowerCase()
const isEmailColumn = (c: string) => /^e-?mail( ?\d)?( address)?$/.test(c) || /^e-?mail \d address$/.test(c) || c === 'primary email'

/**
 * Reads an Outlook contact list: an .xlsx (columns like Name, Email, Company, Job Title,
 * Mobile Phone, Business Phone) or Outlook's own CSV export (First Name, Last Name,
 * E-mail Address, E-mail 2 Address…). Also returns the mailbox addresses the file lists
 * (a "Mailbox(es)" column), which are your own and get skipped.
 */
export async function readOutlookFile(file: File): Promise<{ rows: OutlookRow[]; ownEmails: string[] }> {
  const table = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv((await file.text()).replace(/^﻿/, ''))
  const at = table.findIndex((r) => r.some((c) => isEmailColumn(h(c))) && r.some((c) => ['name', 'first name', 'display name', 'full name'].includes(h(c))))
  if (at < 0) throw new Error("This doesn't look like an Outlook contact list: it needs a name column and an email column.")
  const cols = table[at]!.map(h)
  const col = (...names: string[]) => cols.findIndex((c) => names.includes(c))
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const i = {
    name: col('name', 'display name', 'full name'), first: col('first name', 'given name'), middle: col('middle name'), last: col('last name', 'surname'),
    company: col('company'), title: col('job title'), mobile: col('mobile phone'), business: col('business phone'), home: col('home phone'),
    signature: col('phones found in email signatures'), mailbox: col('mailbox(es)', 'mailboxes', 'mailbox'),
  }
  const emailCols = cols.map((c, n) => (isEmailColumn(c) ? n : -1)).filter((n) => n >= 0)
  const own = new Set<string>()
  const rows = table
    .slice(at + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      for (const m of get(r, i.mailbox).split(/[,;]/)) if (m.trim()) own.add(m.trim().toLowerCase())
      return {
        name: get(r, i.name) || [get(r, i.first), get(r, i.middle), get(r, i.last)].filter(Boolean).join(' '),
        emails: emailCols.map((n) => get(r, n)).filter(Boolean),
        company: get(r, i.company),
        title: get(r, i.title),
        mobile: get(r, i.mobile),
        businessPhone: get(r, i.business),
        homePhone: get(r, i.home),
        signaturePhones: get(r, i.signature),
      }
    })
  return { rows, ownEmails: [...own] }
}
