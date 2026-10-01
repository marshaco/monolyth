import NewsFeed from '@/components/news-feed'
import type { Article } from '@/app/page'
import { WINDOW_HOURS } from '@/lib/missed'

interface Props {
  articles: Article[]
  loading: boolean
  tickers: string[]
  lowTickers: string[]
  personalised: boolean
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
      <p className="text-sm max-w-md text-center">{children}</p>
    </div>
  )
}

export default function MissedFeed({ articles, loading, tickers, lowTickers, personalised }: Props) {
  if (tickers.length === 0 || loading) return <NewsFeed articles={[]} loading={loading} tickers={tickers} />
  if (!personalised) {
    return <Empty>Read a few articles and this tab will start flagging important news on the holdings you tend to skip.</Empty>
  }
  if (lowTickers.length === 0) {
    return <Empty>You&apos;re keeping up with all your holdings. Nothing to flag.</Empty>
  }
  if (articles.length === 0) {
    return (
      <Empty>
        No major news in the last {WINDOW_HOURS / 24} days for {lowTickers.join(', ')}.
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The biggest recent stories for holdings you don&apos;t often read: {lowTickers.join(', ')}.
      </p>
      <NewsFeed articles={articles} loading={false} tickers={tickers} />
    </div>
  )
}
