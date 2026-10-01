import type { EngagementAffinity } from '@monolyth/types'
import { request } from '@/lib/holdings-api'
import { outletKey } from '@/lib/feed-ranking'

export const getAffinity = () => request<EngagementAffinity>('/api/v1/engagement/affinity')

// Fire-and-forget: `keepalive` lets the request finish even as the click opens the article.
// Tracking must never get in the way of reading, so failures are ignored.
export function recordClick(article: { link: string; source: string; ticker: string }) {
  fetch('/api/v1/engagement', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article_url: article.link, outlet: outletKey(article.source), ticker: article.ticker }),
  }).catch(() => {})
}
