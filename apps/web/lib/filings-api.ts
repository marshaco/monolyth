import type { FilingSummary } from '@monolyth/types'
import { request } from '@/lib/holdings-api'

export const listFilings = (limit = 20) =>
  request<FilingSummary[]>(`/api/v1/filings?limit=${limit}`)
