// Re-weights the baseline feed (lib/feed-ranking.ts) toward the outlets and tickers a user
// actually opens (#10). Applied after the fair baseline, so it adjusts from a neutral start.
import type { EngagementAffinity, OutletTrust } from '@monolyth/types'
import { outletKey, type RankableArticle } from '@/lib/feed-ranking'

// The most places a favoured article can move up for personal affinity (plus MAX_TRUST_LIFT for
// platform trust). Each article can also be passed by at most that many others, so nothing moves
// more than MAX_LIFT + MAX_TRUST_LIFT places either way: less-favoured outlets and tickers still
// appear near where the baseline put them (exploration, not a filter bubble).
export const MAX_LIFT = 6
const OUTLET_WEIGHT = 0.6
const TICKER_WEIGHT = 0.4
// Platform-wide outlet trust (#13) nudges everyone's feed, including new users, but far less than
// a user's own reading habits, so it complements personalisation rather than overriding it
export const MAX_TRUST_LIFT = 2

export function personalize<T extends RankableArticle>(
  articles: T[],
  affinity: EngagementAffinity | null,
  trust: OutletTrust | null = null,
): T[] {
  const personal = affinity?.personalised ? affinity : null
  const trusted = trust && Object.keys(trust.outlets).length > 0 ? trust : null
  if (!personal && !trusted) return articles
  return articles
    .map((article, i) => {
      const outlet = outletKey(article.source)
      const boost = personal
        ? OUTLET_WEIGHT * (personal.outlets[outlet] ?? 0) + TICKER_WEIGHT * (personal.tickers[article.ticker] ?? 0)
        : 0
      const lift = MAX_LIFT * boost + MAX_TRUST_LIFT * (trusted?.outlets[outlet] ?? 0)
      return { article, i, lift, position: i - lift }
    })
    // On a tie, the article that was lifted wins, so a lift of N overtakes exactly N articles
    .sort((a, b) => a.position - b.position || b.lift - a.lift || a.i - b.i)
    .map(({ article }) => article)
}
