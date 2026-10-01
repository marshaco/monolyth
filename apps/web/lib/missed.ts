// "Things you may have missed" (#11): significant recent news for holdings the user rarely reads.
import type { EngagementAffinity } from '@monolyth/types'

export type MissableArticle = {
  ticker: string
  title: string
  pubDate: string
  coverage?: number
}

// A holding is "under-read" if its ticker affinity is below this share of the most-read one
export const LOW_ENGAGEMENT = 0.25
// Digest window: older news is history, not something you're about to miss
export const WINDOW_HOURS = 72
export const PER_TICKER = 3

// Headline terms that usually mark material news rather than routine coverage
const SIGNIFICANT = [
  /\bearnings?\b/i, /\bresults\b/i, /\bguidance\b/i, /\boutlook\b/i, /\bforecast\b/i,
  /\b(up|down)grade[sd]?\b/i, /\bacqui(re|res|red|sition)\b/i, /\bmerger\b/i, /\bdeal\b/i,
  /\blawsuit\b/i, /\bsue[sd]?\b/i, /\bprobe\b/i, /\binvestigation\b/i, /\bSEC\b/, /\brecall\b/i,
  /\bCEO\b/, /\bCFO\b/, /\bresign/i, /\blayoffs?\b/i, /\bdividend\b/i, /\bbuyback\b/i, /\bsplit\b/i,
  /\bplunge[sd]?\b/i, /\bsoar(s|ed)?\b/i, /\bsurge[sd]?\b/i, /\btumble[sd]?\b/i, /\brecord\b/i,
]

/** Held tickers the user under-reads. Empty until there's enough history to tell (cold start). */
export function lowEngagementTickers(tickers: string[], affinity: EngagementAffinity | null): string[] {
  if (!affinity?.personalised) return []
  return tickers.filter((t) => (affinity.tickers[t] ?? 0) < LOW_ENGAGEMENT)
}

export function significance(article: MissableArticle, now = Date.now()): number {
  const ageHours = (now - new Date(article.pubDate).getTime()) / 3_600_000
  const signals = SIGNIFICANT.filter((re) => re.test(article.title)).length
  // Coverage counts most: a story several outlets ran is rarely routine
  return 2 * ((article.coverage ?? 1) - 1) + 1.5 * Math.min(signals, 2) + Math.max(0, 1 - ageHours / WINDOW_HOURS)
}

/** The most significant recent articles for under-read tickers, at most PER_TICKER each. */
export function missedArticles<T extends MissableArticle>(articles: T[], lowTickers: string[], now = Date.now()): T[] {
  const low = new Set(lowTickers)
  const perTicker = new Map<string, number>()
  return articles
    .filter((a) => low.has(a.ticker) && now - new Date(a.pubDate).getTime() <= WINDOW_HOURS * 3_600_000)
    .map((a) => ({ a, score: significance(a, now) }))
    .sort((x, y) => y.score - x.score)
    .filter(({ a }) => {
      const n = perTicker.get(a.ticker) ?? 0
      perTicker.set(a.ticker, n + 1)
      return n < PER_TICKER
    })
    .map(({ a }) => a)
}
