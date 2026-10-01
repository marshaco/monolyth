// Re-weights the baseline feed (lib/feed-ranking.ts) toward the outlets and tickers a user
// actually opens (#10). Applied after the fair baseline, so it adjusts from a neutral start.
import type { EngagementAffinity } from '@monolyth/types'
import { outletKey, type RankableArticle } from '@/lib/feed-ranking'

// The most places a favoured article can move up. Each article can also be passed by at most this
// many others, so nothing moves more than MAX_LIFT places either way: less-favoured outlets and
// tickers still appear near where the baseline put them (exploration, not a filter bubble).
export const MAX_LIFT = 6
const OUTLET_WEIGHT = 0.6
const TICKER_WEIGHT = 0.4

export function personalize<T extends RankableArticle>(articles: T[], affinity: EngagementAffinity | null): T[] {
  if (!affinity?.personalised) return articles
  return articles
    .map((article, i) => {
      const boost =
        OUTLET_WEIGHT * (affinity.outlets[outletKey(article.source)] ?? 0) +
        TICKER_WEIGHT * (affinity.tickers[article.ticker] ?? 0)
      return { article, i, position: i - MAX_LIFT * boost }
    })
    .sort((a, b) => a.position - b.position || a.i - b.i)
    .map(({ article }) => article)
}
