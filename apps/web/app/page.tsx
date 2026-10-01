'use client'

import { useState, useEffect } from 'react'
import HoldingsSidebar from '@/components/holdings-sidebar'
import NewsFeed from '@/components/news-feed'
import FilingsPanel from '@/components/filings-panel'
import FilingSearch from '@/components/filing-search'
import { useHoldings } from '@/lib/use-holdings'

export type Article = {
  ticker: string
  title: string
  link: string
  pubDate: string
  source: string
  blurb?: string
  imageUrl?: string
  isPaywalled?: boolean
}

export default function Home() {
  const { tickers, status, error, dismissError, setTickers, retry } = useHoldings()
  const ready = status === 'ready'
  const [refreshCount, setRefreshCount] = useState(0)
  const [result, setResult] = useState<{ key: string; articles: Article[] } | null>(null)

  const tickerKey = tickers.join(',')
  const fetchKey = `${tickerKey}#${refreshCount}`

  // Refetch whenever the holdings change or Refresh is clicked. Results are tagged
  // with the key they were fetched for, so a slow stale response can't overwrite a newer one.
  useEffect(() => {
    if (!ready || !tickerKey) return
    let cancelled = false
    fetch(`/api/news?tickers=${tickerKey}`)
      .then((res) => res.json())
      .then((data) => data.articles ?? [])
      .catch(() => [])
      .then((articles: Article[]) => {
        if (!cancelled) setResult({ key: fetchKey, articles })
      })
    return () => { cancelled = true }
  }, [ready, tickerKey, fetchKey])

  const loading = tickerKey !== '' && result?.key !== fetchKey
  const articles = tickerKey && result ? result.articles : []

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
          <h1 className="text-base font-semibold text-foreground">News Feed</h1>
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
        <NewsFeed articles={articles} loading={loading} tickers={tickers} />
      </main>
    </div>
  )
}
