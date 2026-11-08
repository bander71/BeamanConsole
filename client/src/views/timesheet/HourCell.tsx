import { useState, type KeyboardEvent } from 'react'
import { fh, parseHours } from '../../lib/format.ts'

/**
 * One day's hours on the grid. Keeps the raw text while typing (so "1:" or "1."
 * can be finished), reports valid values as they're typed, and tidies the text
 * when the cell loses focus. Up, Down and Enter move between rows.
 */
export function HourCell({ value, row, day, label, disabled, title, onChange }: {
  value: number
  row: number
  day: number
  label: string
  disabled: boolean
  title?: string
  onChange: (hours: number) => void
}) {
  const [text, setText] = useState<string | null>(null) // null when not editing
  const shown = text ?? (value ? fh(value) : '0')
  const parsed = text === null ? value : parseHours(text)
  const bad = text !== null && (Number.isNaN(parsed) || parsed > 24)

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const move = ({ ArrowUp: -1, ArrowDown: 1, Enter: 1 } as Record<string, number>)[e.key]
    if (!move) return
    const next = document.querySelector<HTMLInputElement>(`input.h[data-row="${row + move}"][data-day="${day}"]`)
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <input
      className={'h' + (value ? '' : ' zero') + (bad ? ' bad' : '')}
      inputMode="decimal"
      aria-label={label}
      title={title}
      data-row={row}
      data-day={day}
      value={shown}
      disabled={disabled}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value)
        const v = parseHours(e.target.value)
        if (!Number.isNaN(v) && v <= 24 && v !== value) onChange(v)
      }}
      onBlur={() => setText(null)}
      onKeyDown={onKeyDown}
    />
  )
}
