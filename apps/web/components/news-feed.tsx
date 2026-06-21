'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Article } from '@/app/page'

interface Props {
  articles: Article[]
  loading: boolean
  tickers: string[]
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / 1000 / 60 / 60)
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)
  } catch {
    return ''
  }
}

function NewsCard({ article, index }: { article: Article; index: number }) {
  const [imgSrc, setImgSrc] = useState<string | null>(article.imageUrl ?? null)
  const [imgVisible, setImgVisible] = useState(false)

  useEffect(() => {
    if (imgSrc) return
    let cancelled = false
    fetch(`/api/og-image?url=${encodeURIComponent(article.link)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data.imageUrl) setImgSrc(data.imageUrl) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [article.link, imgSrc])

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col bg-card border border-border hover:border-primary/40 rounded-xl overflow-hidden transition-colors"
      style={{
        animation: 'fade-slide-in 0.35s ease-out both',
        animationDelay: `${index * 55}ms`,
      }}
    >
      {/* Image / gradient header */}
      <div className="relative aspect-video bg-gradient-to-br from-primary/20 via-primary/10 to-muted overflow-hidden flex-shrink-0">
        {imgSrc && (
          <img
            src={imgSrc}
            alt=""
            loading="lazy"
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-opacity duration-500',
              imgVisible ? 'opacity-100' : 'opacity-0',
            )}
            onLoad={() => setImgVisible(true)}
            onError={() => { setImgSrc(null); setImgVisible(false) }}
          />
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <p className="text-sm font-semibold text-card-foreground group-hover:text-foreground leading-snug line-clamp-2 transition-colors">
          {article.title}
        </p>

        {article.blurb && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {article.blurb}
          </p>
        )}

        {/* Metadata row */}
        <div className="flex items-center gap-2 mt-auto pt-3 flex-wrap">
          <Badge variant="outline" className="text-xs py-0 h-5 flex-shrink-0">
            {article.ticker}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">{article.source}</span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">{formatDate(article.pubDate)}</span>
          <ExternalLink
            size={11}
            className="ml-auto flex-shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors"
          />
        </div>
      </div>
    </a>
  )
}

export default function NewsFeed({ articles, loading, tickers }: Props) {
  if (tickers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Add a ticker on the left to see news for your holdings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl overflow-hidden animate-pulse">
            <div className="aspect-video bg-muted" />
            <div className="p-4 flex flex-col gap-3">
              <div className="h-4 bg-muted rounded w-full" />
              <div className="h-4 bg-muted rounded w-4/5" />
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="flex gap-2 mt-2">
                <div className="h-5 w-12 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted rounded self-center" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">No news found for your holdings.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {articles.map((article, i) => (
        <NewsCard key={article.link} article={article} index={i} />
      ))}
    </div>
  )
}
