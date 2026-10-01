import type { Holding, HoldingCreate } from '@monolyth/types'

// Proxied to FastAPI: by the rewrite in next.config.ts in dev, by nginx behind :8080
const BASE = '/api/v1/holdings'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    // FastAPI puts errors in `detail`: a string for HTTPException, a list for validation errors
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText
    throw new ApiError(res.status, detail)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const listHoldings = () => request<Holding[]>(BASE)

export const addHolding = (body: HoldingCreate) =>
  request<Holding>(BASE, { method: 'POST', body: JSON.stringify(body) })

export const removeHolding = (ticker: string) =>
  request<void>(`${BASE}/${encodeURIComponent(ticker)}`, { method: 'DELETE' })
