'use client'

import { useState, useEffect, useCallback } from 'react'
import HoldingsSidebar from '@/components/holdings-sidebar'
import NewsFeed from '@/components/news-feed'

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
  const [tickers, setTickers] = useState<string[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  const fetchNews = useCallback(async (t: string[]) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/news?tickers=${t.join(',')}`)
      const data = await res.json()
      setArticles(data.articles ?? [])
    } catch {
      setArticles([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleTickersChange = (next: string[]) => {
    setTickers(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    if (next.length === 0) {
      setArticles([])
    } else {
      fetchNews(next)
    }
  }

  // Load saved holdings and fetch their news once on mount
  useEffect(() => {
    let stored: string[] = []
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    } catch {}
    setTickers(stored)
    setReady(true)
    if (stored.length > 0) fetchNews(stored)
  }, [fetchNews])

  if (!ready) return null

  return (
    <div className="flex h-screen bg-background text-foreground">
      <HoldingsSidebar tickers={tickers} onChange={handleTickersChange} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-base font-semibold text-foreground">News Feed</h1>
          {tickers.length > 0 && !loading && (
            <button
              onClick={() => fetchNews(tickers)}
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
