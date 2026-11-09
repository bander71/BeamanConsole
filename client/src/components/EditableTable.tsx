import { useState, type ReactNode } from 'react'
import type { Draft } from './editable.ts'
import { useToast } from './toast-context.ts'

// A table whose rows can be edited in place, like the prototype's Setup tables.
// Each column says how to show its value and how to edit it.

export interface Column<T> {
  key: string
  label: string
  /** How the value is edited. 'readonly' never becomes an input; 'newOnly' columns are editable only on new rows. */
  edit: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'readonly'
  newOnly?: boolean
  options?: { value: string; label: string }[]
  numeric?: boolean // right-align
  placeholder?: string
  /** Value shown when not editing. */
  view: (row: T) => ReactNode
  /** The row's value as the editor starts with it. */
  value: (row: T) => string | boolean
}

interface Props<T> {
  title: string
  description: string
  addLabel: string
  columns: Column<T>[]
  rows: T[]
  rowId: (row: T) => string
  /** Starting values for a new row. */
  newRow: () => Draft
  /** Saves the row. Throw an Error with a short message to show it and keep the row open. */
  onSave: (draft: Draft, row: T | null) => Promise<void>
  minWidth?: number
}

export function EditableTable<T>({ title, description, addLabel, columns, rows, rowId, newRow, onSave, minWidth = 640 }: Props<T>) {
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null) // a row id, or '__new'
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)

  const start = (row: T | null) => {
    setEditing(row ? rowId(row) : '__new')
    setDraft(row ? Object.fromEntries(columns.map((c) => [c.key, c.value(row)])) : newRow())
  }
  const cancel = () => setEditing(null)

  async function save(row: T | null) {
    setSaving(true)
    try {
      await onSave(draft, row)
      toast('Saved')
      setEditing(null)
    } catch (e) {
      toast((e as Error).message || "Couldn't save.")
    } finally {
      setSaving(false)
    }
  }

  const editor = (c: Column<T>, isNew: boolean, row: T | null) => {
    const v = draft[c.key]
    const set = (value: string | boolean) => setDraft((d) => ({ ...d, [c.key]: value }))
    if (c.edit === 'readonly' || (c.newOnly && !isNew)) {
      return <td key={c.key} className={c.numeric ? 'n num' : undefined}>{row ? c.view(row) : String(v ?? '')}</td>
    }
    if (c.edit === 'checkbox') {
      return <td key={c.key}><input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} aria-label={c.label} /></td>
    }
    if (c.edit === 'select') {
      return (
        <td key={c.key}>
          <select className="edit-in" value={String(v ?? '')} onChange={(e) => set(e.target.value)} aria-label={c.label}>
            {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </td>
      )
    }
    return (
      <td key={c.key}>
        <input className={'edit-in' + (c.edit === 'number' ? ' num' : '')} type={c.edit === 'date' ? 'date' : 'text'}
          inputMode={c.edit === 'number' ? 'decimal' : undefined} value={String(v ?? '')} placeholder={c.placeholder}
          onChange={(e) => set(e.target.value)} aria-label={c.label}
          style={c.edit === 'number' ? { textAlign: 'right', width: 80 } : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter') save(row); if (e.key === 'Escape') cancel() }} />
      </td>
    )
  }

  const actions = (row: T | null) => (
    <td className="n">
      <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
        <button className="btn sm" onClick={cancel} disabled={saving}>Cancel</button>
        <button className="btn sm primary" onClick={() => save(row)} disabled={saving}>{row ? 'Save' : 'Add'}</button>
      </div>
    </td>
  )

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>{title}</h2>
        <span className="note">{description}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => start(null)} disabled={editing === '__new'}>{addLabel}</button>
      </div>
      <div className="scroll">
        <table style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => <th key={c.key} className={c.numeric ? 'n' : undefined}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {editing === '__new' && <tr>{columns.map((c) => editor(c, true, null))}{actions(null)}</tr>}
            {rows.length ? rows.map((row) => {
              const id = rowId(row)
              return editing === id ? (
                <tr key={id}>{columns.map((c) => editor(c, false, row))}{actions(row)}</tr>
              ) : (
                <tr key={id}>
                  {columns.map((c) => <td key={c.key} className={c.numeric ? 'n num' : undefined}>{c.view(row)}</td>)}
                  <td className="n"><button className="btn quiet sm" onClick={() => start(row)}>Edit</button></td>
                </tr>
              )
            }) : editing !== '__new' && <tr><td colSpan={columns.length + 1} className="empty">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
