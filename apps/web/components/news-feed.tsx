import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
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

export default function NewsFeed({ articles, loading, tickers }: Props) {
  if (tickers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-zinc-600 gap-2">
        <p className="text-sm">Add a ticker on the left to see news for your holdings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 max-w-2xl">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 animate-pulse">
            <div className="h-3 bg-zinc-800 rounded w-24 mb-3" />
            <div className="h-4 bg-zinc-800 rounded w-full mb-2" />
            <div className="h-4 bg-zinc-800 rounded w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-600">
        <p className="text-sm">No news found for your holdings.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 max-w-2xl">
      {articles.map((article, i) => (
        <a
          key={i}
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col gap-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-lg p-4 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs border-zinc-700 text-zinc-400 py-0 h-5"
            >
              {article.ticker}
            </Badge>
            <span className="text-xs text-zinc-500">{article.source}</span>
            <span className="text-xs text-zinc-700">·</span>
            <span className="text-xs text-zinc-500">{formatDate(article.pubDate)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-zinc-200 group-hover:text-white leading-snug transition-colors">
              {article.title}
            </p>
            <ExternalLink
              size={13}
              className="flex-shrink-0 mt-0.5 text-zinc-600 group-hover:text-zinc-400 transition-colors"
            />
          </div>
        </a>
      ))}
    </div>
  )
}
