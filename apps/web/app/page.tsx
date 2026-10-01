'use client'

import { useState, useEffect } from 'react'
import HoldingsSidebar from '@/components/holdings-sidebar'
import NewsFeed from '@/components/news-feed'
import { useLocalStorage } from '@/lib/use-local-storage'

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

const STORAGE_KEY = 'monolyth_holdings'

export default function Home() {
  const [tickers, setTickers, ready] = useLocalStorage<string[]>(STORAGE_KEY, [])
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

  if (!ready) return null

  return (
    <div className="flex h-screen bg-background text-foreground">
      <HoldingsSidebar tickers={tickers} onChange={setTickers} />
      <main className="flex-1 overflow-y-auto p-6">
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
        <NewsFeed articles={articles} loading={loading} tickers={tickers} />
      </main>
    </div>
  )
}
