import { describe, expect, it } from 'vitest'
import { PER_TICKER, lowEngagementTickers, missedArticles, significance } from '@/lib/missed'

const NOW = Date.parse('2026-10-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const affinity = (tickers: Record<string, number>, personalised = true) => ({
  events: 20, half_life_days: 14, personalised, outlets: {}, tickers,
})
const art = (ticker: string, title: string, h = 1, coverage = 1) => ({ ticker, title, pubDate: hoursAgo(h), coverage })

describe('lowEngagementTickers', () => {
  it('is empty without enough history', () => {
    expect(lowEngagementTickers(['AAPL', 'NVDA'], null)).toEqual([])
    expect(lowEngagementTickers(['AAPL', 'NVDA'], affinity({ NVDA: 1 }, false))).toEqual([])
  })

  it('returns held tickers read much less than the favourite, including never-read ones', () => {
    expect(lowEngagementTickers(['AAPL', 'NVDA', 'MSFT', 'META'], affinity({ NVDA: 1, MSFT: 0.6, AAPL: 0.1 }))).toEqual([
      'AAPL',
      'META',
    ])
  })

  it('is empty when engagement is even', () => {
    expect(lowEngagementTickers(['AAPL', 'NVDA'], affinity({ NVDA: 1, AAPL: 0.9 }))).toEqual([])
  })
})

describe('significance', () => {
  it('ranks multi-outlet stories and material headlines above routine ones', () => {
    const routine = significance(art('AAPL', 'Is Apple stock a buy?', 1), NOW)
    const earnings = significance(art('AAPL', 'Apple earnings beat; guidance raised', 1), NOW)
    const covered = significance(art('AAPL', 'Apple opens new store', 1, 4), NOW)
    expect(earnings).toBeGreaterThan(routine)
    expect(covered).toBeGreaterThan(earnings)
  })

  it('prefers fresher news when otherwise equal', () => {
    expect(significance(art('AAPL', 'x', 2), NOW)).toBeGreaterThan(significance(art('AAPL', 'x', 60), NOW))
  })
})

describe('missedArticles', () => {
  it('only includes under-read tickers, within the window, most significant first', () => {
    const feed = [
      art('NVDA', 'Nvidia earnings', 1, 5), // favourite ticker: excluded
      art('AAPL', 'Apple stock: what to watch', 2),
      art('AAPL', 'Apple faces SEC probe', 3),
      art('AAPL', 'Apple earnings record', 100), // outside 72h
      art('META', 'Meta announces layoffs', 5, 3),
    ]
    expect(missedArticles(feed, ['AAPL', 'META'], NOW).map((a) => a.title)).toEqual([
      'Meta announces layoffs',
      'Apple faces SEC probe',
      'Apple stock: what to watch',
    ])
  })

  it(`caps each ticker at ${PER_TICKER}`, () => {
    const feed = Array.from({ length: 6 }, (_, i) => art('AAPL', `Apple story ${i}`, i + 1))
    expect(missedArticles(feed, ['AAPL'], NOW)).toHaveLength(PER_TICKER)
  })
})
