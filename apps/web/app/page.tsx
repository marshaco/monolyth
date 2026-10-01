'use client'

import { useState, useEffect } from 'react'
import HoldingsSidebar from '@/components/holdings-sidebar'
import NewsFeed from '@/components/news-feed'
import MissedFeed from '@/components/missed-feed'
import FilingsPanel from '@/components/filings-panel'
import FilingSearch from '@/components/filing-search'
import { useHoldings } from '@/lib/use-holdings'
import { getAffinity } from '@/lib/engagement-api'
import { personalize } from '@/lib/personalize'
import { lowEngagementTickers, missedArticles } from '@/lib/missed'
import type { EngagementAffinity } from '@monolyth/types'

export type Article = {
  ticker: string
  title: string
  link: string
  pubDate: string
  source: string
  blurb?: string
  imageUrl?: string
  isPaywalled?: boolean
  coverage?: number
}

export default function Home() {
  const { tickers, status, error, dismissError, setTickers, retry } = useHoldings()
  const ready = status === 'ready'
  const [refreshCount, setRefreshCount] = useState(0)
  const [result, setResult] = useState<{ key: string; articles: Article[]; affinity: EngagementAffinity | null } | null>(null)
  const [tab, setTab] = useState<'latest' | 'missed'>('latest')

  const tickerKey = tickers.join(',')
  const fetchKey = `${tickerKey}#${refreshCount}`

  // Refetch whenever the holdings change or Refresh is clicked. Results are tagged
  // with the key they were fetched for, so a slow stale response can't overwrite a newer one.
  useEffect(() => {
    if (!ready || !tickerKey) return
    let cancelled = false
    const news: Promise<Article[]> = fetch(`/api/news?tickers=${tickerKey}`)
      .then((res) => res.json())
      .then((data) => data.articles ?? [])
      .catch(() => [])
    // Fetched with each feed load, so clicks since the last load count. No affinity = baseline order.
    const affinity = getAffinity().catch(() => null)
    Promise.all([news, affinity]).then(([articles, aff]) => {
      if (!cancelled) setResult({ key: fetchKey, articles: personalize(articles, aff), affinity: aff })
    })
    return () => { cancelled = true }
  }, [ready, tickerKey, fetchKey])

  const loading = tickerKey !== '' && result?.key !== fetchKey
  const articles = tickerKey && result ? result.articles : []
  const affinity = result?.affinity ?? null
  const lowTickers = lowEngagementTickers(tickers, affinity)
  const missed = missedArticles(articles, lowTickers)

  if (status === 'loading') return null

  if (status === 'unreachable') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <p className="text-sm">Couldn&apos;t reach the monolyth API. Is it running? (<code>./dev.sh</code> starts it)</p>
        <button onClick={retry} className="text-xs text-primary hover:underline">
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <HoldingsSidebar tickers={tickers} onChange={setTickers} />
      <main className="flex-1 overflow-y-auto p-6">
        {tickers.length > 0 && <FilingSearch />}
        <FilingsPanel tickerKey={tickerKey} />
        <div className="flex items-center justify-between mb-6">
          <div role="tablist" aria-label="News" className="flex items-center gap-4">
            {([
              ['latest', 'News Feed'],
              ['missed', `You may have missed${missed.length ? ` (${missed.length})` : ''}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={
                  tab === value
                    ? 'text-base font-semibold text-foreground'
                    : 'text-base text-muted-foreground hover:text-foreground transition-colors'
                }
              >
                {label}
              </button>
            ))}
          </div>
          {tickers.length > 0 && !loading && (
            <button
              onClick={() => setRefreshCount((n) => n + 1)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Refresh
            </button>
          )}
        </div>
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{error}</span>
            <button onClick={dismissError} aria-label="Dismiss" className="hover:opacity-70">✕</button>
          </div>
        )}
        {tab === 'latest' ? (
          <NewsFeed articles={articles} loading={loading} tickers={tickers} />
        ) : (
          <MissedFeed articles={missed} loading={loading} tickers={tickers} lowTickers={lowTickers} personalised={!!affinity?.personalised} />
        )}
      </main>
    </div>
  )
}
