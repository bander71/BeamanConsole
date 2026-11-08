// Small wrapper around fetch for the Node API at /api.

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Check that the API is running.")
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details)
  }
  return json as T
}

/** Builds a query string, leaving out empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  }
  const out = s.toString()
  return out ? '?' + out : ''
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<void>('DELETE', path),
}

export interface List<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}

export interface One<T> {
  data: T
}

/** Fetches every page of a list endpoint. */
export async function getAll<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await api.get<List<T>>(path + qs({ ...params, limit: 500, offset }))
    out.push(...page.data)
    if (out.length >= page.total || page.data.length === 0) return out
  }
}
