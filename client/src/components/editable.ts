// Helpers for reading values out of an EditableTable row.

export type Draft = Record<string, string | boolean>

/** Reads a number cell: '' is 0; anything else must be a number of 0 or more. */
export function numberFrom(draft: Draft, key: string, label: string): number {
  const raw = String(draft[key] ?? '').replace(/[$,]/g, '').trim()
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number of 0 or more.`)
  return n
}

/** Reads a text cell, trimmed. */
export const text = (draft: Draft, key: string) => String(draft[key] ?? '').trim()
