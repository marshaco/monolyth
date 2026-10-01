import { describe, expect, it } from 'vitest'
import {
  capOutletsPerWindow,
  feedDistribution,
  interleaveByTicker,
  outletKey,
  rankFeed,
  rotateOutletsWithinTicker,
} from '@/lib/feed-ranking'

const a = (ticker: string, source: string, id = '') => ({ ticker, source, id: `${ticker}-${source}-${id}` })
const sources = (xs: { source: string }[]) => xs.map((x) => x.source)
const tickers = (xs: { ticker: string }[]) => xs.map((x) => x.ticker)

describe('outletKey', () => {
  it.each([
    ['finance.yahoo.com', 'yahoo.com'],
    ['uk.finance.yahoo.com', 'yahoo.com'],
    ['www.fool.com', 'fool.com'],
    ['fool.com', 'fool.com'],
    ['www.bbc.co.uk', 'bbc.co.uk'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['abc.net.au', 'abc.net.au'],
    ['watcher.guru', 'watcher.guru'],
    ['newsable.asianetnews.com', 'asianetnews.com'],
  ])('%s → %s', (host, key) => expect(outletKey(host)).toBe(key))
})

describe('interleaveByTicker', () => {
  it('takes one per ticker in turn, ordered by each ticker’s newest article', () => {
    const feed = [a('NVDA', 'x', '1'), a('NVDA', 'x', '2'), a('AAPL', 'x', '1'), a('NVDA', 'x', '3'), a('MSFT', 'x', '1')]
    expect(tickers(interleaveByTicker(feed))).toEqual(['NVDA', 'AAPL', 'MSFT', 'NVDA', 'NVDA'])
  })
})

describe('rotateOutletsWithinTicker', () => {
  it('does not repeat an outlet within a ticker until the others have had a turn', () => {
    const feed = [a('TSLA', 'coincentral.com', '1'), a('TSLA', 'coincentral.com', '2'), a('TSLA', 'fool.com'), a('TSLA', 'zacks.com')]
    expect(sources(rotateOutletsWithinTicker(feed))).toEqual(['coincentral.com', 'fool.com', 'zacks.com', 'coincentral.com'])
  })

  it('treats subdomains of one publisher as the same outlet', () => {
    const feed = [a('JPM', 'finance.yahoo.com'), a('JPM', 'uk.finance.yahoo.com'), a('JPM', 'zacks.com')]
    expect(sources(rotateOutletsWithinTicker(feed))).toEqual(['finance.yahoo.com', 'zacks.com', 'uk.finance.yahoo.com'])
  })
})

describe('capOutletsPerWindow', () => {
  const others = (n: number) => Array.from({ length: n }, (_, i) => a('X', `other${i}.com`))
  const blockonomi = (n: number) => Array.from({ length: n }, (_, i) => a('X', 'blockonomi.com', `${i}`))
  const maxPerWindow = (xs: { source: string }[], source: string, window: number) =>
    Math.max(...xs.map((_, i) => xs.slice(i, i + window).filter((x) => x.source === source).length))

  it('keeps every window of `window` articles at or under `cap` per outlet', () => {
    const out = capOutletsPerWindow([...blockonomi(3), ...others(20)], 2, 12)
    expect(maxPerWindow(out, 'blockonomi.com', 12)).toBe(2)
    expect(sources(out.slice(0, 2))).toEqual(['blockonomi.com', 'blockonomi.com'])
  })

  it('pushes an outlet’s excess past the first page when the cap cannot hold everywhere', () => {
    const out = capOutletsPerWindow([...blockonomi(6), ...others(10)], 2, 12)
    expect(out.slice(0, 12).filter((x) => x.source === 'blockonomi.com')).toHaveLength(2)
    expect(out).toHaveLength(16)
  })

  it('never drops articles, even when one outlet is all that is left', () => {
    const feed = Array.from({ length: 5 }, (_, i) => a('X', 'only.com', `${i}`))
    expect(capOutletsPerWindow(feed, 2, 12)).toHaveLength(5)
  })

  it('leaves an already-balanced feed in its original order', () => {
    const feed = ['a.com', 'b.com', 'c.com', 'a.com', 'b.com'].map((s, i) => a('X', s, `${i}`))
    expect(capOutletsPerWindow(feed, 2, 12)).toEqual(feed)
  })
})

describe('rankFeed', () => {
  it('keeps every article and spreads one dominant outlet across the first page', () => {
    const feed = ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'META', 'TSLA'].flatMap((t) => [
      a(t, 'blockonomi.com'),
      a(t, `${t.toLowerCase()}-news.com`, '1'),
      a(t, `${t.toLowerCase()}-news.com`, '2'),
    ])
    const out = rankFeed(feed)
    expect(out).toHaveLength(feed.length)
    expect(new Set(out)).toEqual(new Set(feed))
    expect(feedDistribution(out).topOutletShare).toBeLessThanOrEqual(2 / 12)
  })
})

describe('feedDistribution', () => {
  it('reports the top outlet’s share of the first page', () => {
    const feed = ['x.com', 'x.com', 'y.com', 'z.com'].map((s, i) => a('T', s, `${i}`))
    expect(feedDistribution(feed, 4)).toEqual({ pageSize: 4, topOutletShare: 0.5, topOutlet: 'x.com', outlets: 3 })
  })

  it('handles an empty feed', () => {
    expect(feedDistribution([])).toEqual({ pageSize: 12, topOutletShare: 0, topOutlet: null, outlets: 0 })
  })
})
