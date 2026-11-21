import { useState, type ReactNode } from 'react'
import { useToast } from '../../components/toast-context.ts'
import { useContactImport, type ImportResult } from './imports.ts'
import { parseConnections } from './linkedin.ts'
import { readOutlookFile } from './outlook.ts'

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

interface Source {
  title: string
  help: ReactNode
  accept: string
  path: string
  /** Reads the file into the request body (without apply). */
  read: (f: File) => Promise<Record<string, unknown>>
  /** Yes/no choices sent with the body, which re-run the preview when changed. */
  options?: { key: string; label: string }[]
}

const SOURCES = {
  linkedin: {
    title: 'Import LinkedIn connections',
    help: (
      <>
        In LinkedIn, go to <b>Me › Settings &amp; Privacy › Data privacy › Get a copy of your data</b>, choose <b>Connections</b>, and pick the
        Connections.csv file from the download here. People already in Contacts are matched by LinkedIn link, email, or name; only their blank fields
        are filled in, and nothing you've entered is changed. Everyone else is added as a new contact with source LinkedIn. Nothing is saved until you
        click Import, and importing the same file again changes nothing.
      </>
    ),
    accept: '.csv,text/csv',
    path: '/contacts/import/linkedin',
    read: async (f) => {
      const rows = parseConnections(await f.text())
      if (!rows.length) throw new Error('The file has no connections in it.')
      return { rows }
    },
  },
  outlook: {
    title: 'Import Outlook contacts',
    help: (
      <>
        Pick an Outlook contact list: an <b>.xlsx</b> with Name and Email columns, or the <b>CSV</b> from Outlook's <b>File › Open &amp; Export ›
        Import/Export › Export to a file</b>. People already in Contacts are matched by email or name; only their blank fields are filled in (title,
        company, phones, more email addresses), and nothing you've entered is changed. Everyone else is added with source Outlook. Rows with the same
        name become one contact with all their addresses. Your own addresses, and automated senders and shared inboxes (no-reply, notifications,
        support@, billing@…), are left out. Nothing is saved until you click Import, and importing the same file again changes nothing.
      </>
    ),
    accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    path: '/contacts/import/outlook',
    read: async (f) => {
      const { rows, ownEmails } = await readOutlookFile(f)
      if (!rows.length) throw new Error('The file has no contacts in it.')
      return { rows, ownEmails }
    },
    options: [{ key: 'includeAutomated', label: 'Also add automated senders and shared inboxes' }],
  },
} satisfies Record<string, Source>

export type SourceKey = keyof typeof SOURCES

/** Pick a file, see what would change, then import. */
export function ContactImport({ source, onClose }: { source: SourceKey; onClose: () => void }) {
  const s: Source = SOURCES[source]
  const toast = useToast()
  const run = useContactImport(s.path)
  const [file, setFile] = useState('')
  const [body, setBody] = useState<Record<string, unknown> | null>(null)
  const [opts, setOpts] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function check(b: Record<string, unknown>, o: Record<string, boolean>) {
    setPreview(null)
    setError('')
    try {
      setPreview(await run.mutateAsync({ ...b, ...o, apply: false }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function pick(f: File | undefined) {
    setBody(null)
    setPreview(null)
    setError('')
    if (!f) return
    setFile(f.name)
    try {
      const b = await s.read(f)
      setBody(b)
      await check(b, opts)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function toggle(key: string, on: boolean) {
    const o = { ...opts, [key]: on }
    setOpts(o)
    if (body) check(body, o)
  }

  async function importNow() {
    if (!body) return
    try {
      const r = await run.mutateAsync({ ...body, ...opts, apply: true })
      toast(`Imported: ${plural(r.added, 'new contact')}, ${plural(r.updated, 'contact')} updated`)
      onClose()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const p = preview
  const matched = p ? p.matchedByLink + p.matchedByEmail + p.matchedByName : 0
  const skipped = p ? p.skipped.reduce((n, x) => n + x.count, 0) : 0
  const how = p ? [p.matchedByLink && `${p.matchedByLink} by link`, `${p.matchedByEmail} by email`, `${p.matchedByName} by name`].filter(Boolean).join(', ') : ''

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{s.title}</h2>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!p || run.isPending || (!p.added && !p.updated)} onClick={importNow}>
          {p ? `Import ${plural(p.added, 'new contact')} and update ${plural(p.updated, 'contact')}` : 'Import'}
        </button>
      </div>
      <div style={{ padding: '10px 14px', display: 'grid', gap: 10 }}>
        <p className="note" style={{ margin: 0 }}>
          {s.help}
        </p>
        <div className="row" style={{ gap: '8px 18px' }}>
          <label className="lbl">
            File
            <input type="file" accept={s.accept} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {s.options?.map((o) => (
            <label key={o.key} className="row note" style={{ gap: 6 }}>
              <input type="checkbox" checked={!!opts[o.key]} onChange={(e) => toggle(o.key, e.target.checked)} /> {o.label}
            </label>
          ))}
        </div>
        {run.isPending && !p && file && <p className="note">Checking {file}…</p>}
        {error && (
          <p className="note" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}
      </div>

      {p && (
        <>
          <div className="stats">
            {(
              [
                ['Rows', p.rows, file],
                ['New contacts', p.added, p.linkedToAccount ? `${p.linkedToAccount} linked to an account` : ''],
                ['Already in Contacts', matched, how],
                ['Will be updated', p.updated, `${p.unchanged} already up to date`],
                ['Left out', skipped, p.skipped.map((x) => `${x.count} ${x.reason}`).join(', ')],
              ] as const
            ).map(([k, v, sub]) => (
              <div className="stat" key={k}>
                <div className="k">{k}</div>
                <div className="v">{v.toLocaleString()}</div>
                <div className="sub">{sub}</div>
              </div>
            ))}
          </div>
          <List summary={`See the ${plural(p.updates.length, 'contact')} that will be updated`} show={p.updates.length > 0} head={['Contact', 'Fills in']}>
            {p.updates.map((u) => (
              <tr key={u.contactId}>
                <td>{u.name}</td>
                <td className="note">{u.fields.join(', ')}</td>
              </tr>
            ))}
          </List>
          <List summary={`See the ${plural(p.additions.length, 'new contact')}`} show={p.additions.length > 0} head={['Name', 'Company', 'Title']}>
            {p.additions.map((a, i) => (
              <tr key={i}>
                <td>{a.name}</td>
                <td>{a.company}</td>
                <td className="note">{a.title}</td>
              </tr>
            ))}
          </List>
          <List summary={`See what's left out${p.skippedExamples.length < skipped ? ` (first ${p.skippedExamples.length})` : ''}`} show={skipped > 0} head={['Row']}>
            {p.skippedExamples.map((x, i) => (
              <tr key={i}>
                <td className="note">{x}</td>
              </tr>
            ))}
          </List>
        </>
      )}
    </section>
  )
}

function List({ summary, show, head, children }: { summary: string; show: boolean; head: string[]; children: ReactNode }) {
  if (!show) return null
  return (
    <details style={{ padding: '0 14px 12px' }}>
      <summary className="note">{summary}</summary>
      <div className="scroll" style={{ maxHeight: 320 }}>
        <table>
          <thead>
            <tr>
              {head.map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </details>
  )
}
