// Feed ordering for the news route. Pure functions so the baseline is testable and
// personalization (#10) can later re-weight it instead of re-implementing it.
//
// Pipeline, applied to date-sorted, de-duplicated articles:
//   0. orderByReputation:         re-sort by age adjusted for outlet tier (config/outlet-tiers.json)
//   1. rotateOutlets per ticker:  within each holding, don't repeat an outlet until the others have had a turn
//   2. interleaveByTicker:        one article per holding in turn, so no holding dominates
//   3. capOutletsPerWindow:       across the whole feed, at most `cap` articles per outlet in any `window`

import outletTiers from '@/config/outlet-tiers.json'

export type RankableArticle = {
  ticker: string
  source: string
}

export type DatedArticle = RankableArticle & { pubDate: string }

export const PAGE_SIZE = 12
export const OUTLET_CAP_PER_PAGE = 2

// Second-level labels under which the registrable domain has three parts (bbc.co.uk, abc.net.au)
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov'])

// Groups subdomains of the same publisher: finance.yahoo.com and uk.finance.yahoo.com → yahoo.com.
// A heuristic, not a full public-suffix list, which is enough for news hostnames.
export function outletKey(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const keep = parts.at(-1)!.length === 2 && SECOND_LEVEL.has(parts.at(-2)!) ? 3 : 2
  return parts.slice(-keep).join('.')
}

// Round-robin across groups, preserving order within each group.
// Groups are ordered by first appearance, i.e. by their newest item for date-sorted input.
function roundRobin<T>(items: T[], key: (item: T) => string): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }

  const queues = [...groups.values()]
  const out: T[] = []
  for (let i = 0; out.length < items.length; i++) {
    for (const q of queues) {
      if (i < q.length) out.push(q[i])
    }
  }
  return out
}

export function interleaveByTicker<T extends RankableArticle>(articles: T[]): T[] {
  return roundRobin(articles, (a) => a.ticker)
}

// Applied per ticker, so each holding's own coverage is spread across outlets too.
export function rotateOutletsWithinTicker<T extends RankableArticle>(articles: T[]): T[] {
  const byTicker = new Map<string, T[]>()
  for (const a of articles) {
    const group = byTicker.get(a.ticker)
    if (group) group.push(a)
    else byTicker.set(a.ticker, [a])
  }
  return [...byTicker.values()].flatMap((group) => roundRobin(group, (a) => outletKey(a.source)))
}

// Greedy pass: each slot takes the earliest remaining article whose outlet hasn't hit `cap`
// in the last `window` placed. If every remaining article is over the cap (e.g. one outlet
// is all that's left), it takes the earliest anyway rather than dropping articles.
export function capOutletsPerWindow<T extends RankableArticle>(
  articles: T[],
  cap = OUTLET_CAP_PER_PAGE,
  window = PAGE_SIZE,
): T[] {
  const remaining = [...articles]
  const out: T[] = []
  while (remaining.length > 0) {
    const recent = out.slice(-(window - 1)).map((a) => outletKey(a.source))
    const idx = remaining.findIndex(
      (a) => recent.filter((k) => k === outletKey(a.source)).length < cap,
    )
    out.push(remaining.splice(idx === -1 ? 0 : idx, 1)[0])
  }
  return out
}

type TierConfig = { tiers: Record<string, { ageBonusHours: number; outlets: string[] }> }

const AGE_BONUS_HOURS: ReadonlyMap<string, number> = new Map(
  Object.values((outletTiers as TierConfig).tiers).flatMap((tier) =>
    tier.outlets.map((outlet) => [outlet, tier.ageBonusHours] as const),
  ),
)

export function outletAgeBonusHours(source: string): number {
  return AGE_BONUS_HOURS.get(outletKey(source)) ?? 0
}

// Stable sort by publish time shifted by the outlet's tier bonus: a Tier 1 story 10h old ranks
// beside a 2h-old unlisted one. Because this only reorders, every outlet's articles stay in the
// feed, and the later rotation and per-page cap still keep any one outlet from dominating.
export function orderByReputation<T extends DatedArticle>(articles: T[]): T[] {
  const effective = (a: T) => new Date(a.pubDate).getTime() + outletAgeBonusHours(a.source) * 3_600_000
  return articles
    .map((a, i) => ({ a, i, t: effective(a) }))
    .sort((x, y) => y.t - x.t || x.i - y.i)
    .map(({ a }) => a)
}

export function rankFeed<T extends DatedArticle>(articles: T[]): T[] {
  return capOutletsPerWindow(interleaveByTicker(rotateOutletsWithinTicker(orderByReputation(articles))))
}

export type FeedDistribution = {
  pageSize: number
  // Largest share any single outlet has of the first page, 0–1
  topOutletShare: number
  topOutlet: string | null
  outlets: number
}

// Logged and returned with the feed so imbalance is measurable going forward
export function feedDistribution(articles: RankableArticle[], pageSize = PAGE_SIZE): FeedDistribution {
  const page = articles.slice(0, pageSize)
  const counts = new Map<string, number>()
  for (const a of page) counts.set(outletKey(a.source), (counts.get(outletKey(a.source)) ?? 0) + 1)
  const [topOutlet, topCount] = [...counts].sort((x, y) => y[1] - x[1])[0] ?? [null, 0]
  return {
    pageSize,
    topOutletShare: page.length ? topCount / page.length : 0,
    topOutlet,
    outlets: counts.size,
  }
}
