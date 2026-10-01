import { describe, expect, it } from 'vitest'
import { MAX_LIFT, MAX_TRUST_LIFT, personalize } from '@/lib/personalize'

const feed = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i, ticker: i % 2 ? 'AAPL' : 'NVDA', source: `outlet${i}.com` }))
const affinity = (outlets: Record<string, number>, tickers: Record<string, number> = {}, personalised = true) => ({
  events: 20,
  half_life_days: 14,
  personalised,
  outlets,
  tickers,
})

const trust = (outlets: Record<string, number>) => ({ users: 50, min_users: 5, outlets })

describe('personalize', () => {
  it('leaves the feed alone with no history (cold start)', () => {
    const f = feed(10)
    expect(personalize(f, null)).toBe(f)
    expect(personalize(f, affinity({ 'outlet9.com': 1 }, {}, false))).toBe(f)
  })

  it('lifts a favourite outlet, by at most MAX_LIFT places', () => {
    const out = personalize(feed(20), affinity({ 'outlet15.com': 1 }))
    expect(out.findIndex((a) => a.id === 15)).toBe(15 - Math.floor(MAX_LIFT * 0.6))
  })

  it('groups subdomains with their outlet', () => {
    const f = [...feed(10), { id: 99, ticker: 'NVDA', source: 'uk.finance.yahoo.com' }]
    expect(personalize(f, affinity({ 'yahoo.com': 1 })).findIndex((a) => a.id === 99)).toBe(10 - 3)
  })

  it('lifts favoured tickers too', () => {
    // 8 NVDA articles, then 4 AAPL: a ticker-only boost lifts each AAPL by MAX_LIFT * 0.4 = 2.4 places
    const f = Array.from({ length: 12 }, (_, i) => ({ id: i, ticker: i < 8 ? 'NVDA' : 'AAPL', source: `o${i}.com` }))
    const out = personalize(f, affinity({}, { AAPL: 1 }))
    expect(out.findIndex((a) => a.id === 8)).toBe(6)
    expect(out.findIndex((a) => a.id === 9)).toBe(8)
  })

  it('never moves any article more than MAX_LIFT + MAX_TRUST_LIFT places either way', () => {
    const f = feed(40)
    const favourites = Object.fromEntries(f.filter((a) => a.id % 3 === 0).map((a) => [a.source, 1]))
    const trusted = Object.fromEntries(f.filter((a) => a.id % 4 === 0).map((a) => [a.source, 1]))
    const out = personalize(f, affinity(favourites, { AAPL: 1 }), trust(trusted))
    out.forEach((a, newIndex) => expect(Math.abs(newIndex - a.id)).toBeLessThanOrEqual(MAX_LIFT + MAX_TRUST_LIFT))
    expect(new Set(out)).toEqual(new Set(f))
  })

  it('applies platform trust even for new users, by at most MAX_TRUST_LIFT', () => {
    const out = personalize(feed(10), null, trust({ 'outlet8.com': 1 }))
    expect(out.findIndex((a) => a.id === 8)).toBe(8 - MAX_TRUST_LIFT)
  })

  it('lets personal affinity outweigh platform trust', () => {
    // The user favours outlet9; the platform trusts outlet8 — the user's preference wins
    const out = personalize(feed(12), affinity({ 'outlet9.com': 1 }), trust({ 'outlet8.com': 1 }))
    expect(out.findIndex((a) => a.id === 9)).toBeLessThan(out.findIndex((a) => a.id === 8))
  })

  it('ignores an empty trust result', () => {
    const f = feed(5)
    expect(personalize(f, null, trust({}))).toBe(f)
  })
})
