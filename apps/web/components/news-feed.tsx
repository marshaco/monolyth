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
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <p className="text-sm">Add a ticker on the left to see news for your holdings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 max-w-2xl">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse">
            <div className="h-3 bg-muted rounded w-24 mb-3" />
            <div className="h-4 bg-muted rounded w-full mb-2" />
            <div className="h-4 bg-muted rounded w-3/4" />
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
    <div className="flex flex-col gap-2 max-w-2xl">
      {articles.map((article, i) => (
        <a
          key={i}
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col gap-2 bg-card border border-border hover:border-border/60 rounded-lg p-4 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs py-0 h-5"
            >
              {article.ticker}
            </Badge>
            <span className="text-xs text-muted-foreground">{article.source}</span>
            <span className="text-xs text-muted-foreground/40">·</span>
            <span className="text-xs text-muted-foreground">{formatDate(article.pubDate)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-card-foreground group-hover:text-foreground leading-snug transition-colors">
              {article.title}
            </p>
            <ExternalLink
              size={13}
              className="flex-shrink-0 mt-0.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors"
            />
          </div>
        </a>
      ))}
    </div>
  )
}
