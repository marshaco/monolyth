import type { SearchHit } from '@monolyth/types'
import { request } from '@/lib/holdings-api'

export const searchFilings = (q: string, k = 8) =>
  request<SearchHit[]>(`/api/v1/search?${new URLSearchParams({ q, k: String(k) })}`)
