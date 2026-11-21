import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'

/** What an import (or its preview) reports. The server returns the same shape for every source. */
export interface ImportResult {
  applied: boolean
  rows: number
  skipped: { reason: string; count: number }[]
  skippedExamples: string[]
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

/** Preview (apply: false) or run an import, then refresh contacts and their reports. */
export function useContactImport(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: object) => (await api.post<{ data: ImportResult }>(path, body)).data,
    onSuccess: (r) => {
      if (!r.applied) return
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}
