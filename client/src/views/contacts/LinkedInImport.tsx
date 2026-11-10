import { useState } from 'react'
import { useToast } from '../../components/toast-context.ts'
import { parseConnections, useLinkedInImport, type Connection, type ImportResult } from './linkedin.ts'

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Pick LinkedIn's Connections.csv, see what would change, then import. */
export function LinkedInImport({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const run = useLinkedInImport()
  const [file, setFile] = useState('')
  const [rows, setRows] = useState<Connection[] | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function pick(f: File | undefined) {
    setRows(null)
    setPreview(null)
    setError('')
    if (!f) return
    setFile(f.name)
    try {
      const parsed = parseConnections(await f.text())
      if (!parsed.length) throw new Error('The file has no connections in it.')
      setRows(parsed)
      setPreview(await run.mutateAsync({ rows: parsed, apply: false }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function importNow() {
    if (!rows) return
    try {
      const r = await run.mutateAsync({ rows, apply: true })
      toast(`Imported: ${plural(r.added, 'new contact')}, ${plural(r.updated, 'contact')} updated`)
      onClose()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const p = preview
  const matched = p ? p.matchedByLink + p.matchedByEmail + p.matchedByName : 0

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Import LinkedIn connections</h2>
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
          In LinkedIn, go to <b>Me › Settings &amp; Privacy › Data privacy › Get a copy of your data</b>, choose <b>Connections</b>, and pick the
          Connections.csv file from the download here. People already in Contacts are matched by LinkedIn link, email, or name; only their blank
          fields are filled in, and nothing you've entered is changed. Everyone else is added as a new contact with source LinkedIn. Nothing is saved
          until you click Import, and importing the same file again changes nothing.
        </p>
        <label className="lbl">
          Connections file
          <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {run.isPending && !p && <p className="note">Checking {file}…</p>}
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
                ['Connections', p.connections, file],
                ['New contacts', p.added, p.linkedToAccount ? `${p.linkedToAccount} linked to an account` : ''],
                ['Already in Contacts', matched, `${p.matchedByLink} by link, ${p.matchedByEmail} by email, ${p.matchedByName} by name`],
                ['Will be updated', p.updated, `${p.unchanged} already up to date`],
                ['Skipped', p.skippedNoName, 'LinkedIn hid their name'],
              ] as const
            ).map(([k, v, s]) => (
              <div className="stat" key={k}>
                <div className="k">{k}</div>
                <div className="v">{v.toLocaleString()}</div>
                <div className="sub">{s}</div>
              </div>
            ))}
          </div>
          {p.updates.length > 0 && (
            <details style={{ padding: '6px 14px 12px' }}>
              <summary className="note">See the {plural(p.updates.length, 'contact')} that will be updated</summary>
              <div className="scroll" style={{ maxHeight: 320 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Contact</th>
                      <th>Fills in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.updates.map((u) => (
                      <tr key={u.contactId}>
                        <td>{u.name}</td>
                        <td className="note">{u.fields.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {p.additions.length > 0 && (
            <details style={{ padding: '0 14px 12px' }}>
              <summary className="note">See the {plural(p.additions.length, 'new contact')}</summary>
              <div className="scroll" style={{ maxHeight: 320 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.additions.map((a, i) => (
                      <tr key={i}>
                        <td>{a.name}</td>
                        <td>{a.company}</td>
                        <td className="note">{a.title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}
