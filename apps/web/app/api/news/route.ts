import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'

type FeedItem = {
  title?: string
  link?: string
  pubDate?: string
  contentSnippet?: string
  enclosure?: { url?: string; type?: string }
  mediaContent?: { $?: { url?: string; medium?: string } }
}

type ArticleResult = {
  ticker: string
  title: string
  link: string
  pubDate: string
  source: string
  blurb?: string
  imageUrl?: string
  isPaywalled: boolean
}

const parser = new Parser<object, FeedItem>({
  customFields: { item: [['media:content', 'mediaContent']] },
})

const PAYWALLED_PUBLISHERS = new Set([
  'Financial Times',
  'The Wall Street Journal',
  "Barron's",
  'Bloomberg',
  'The Economist',
  'Reuters',
  'The Times',
  'The Telegraph',
  'The Information',
  'Investor\'s Business Daily',
])

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'is', 'are', 'was', 'were', 'be', 'by', 'its', 'it', 'as',
  'with', 'has', 'have', 'had', 'says', 'said', 'after', 'over',
])

function bingNewsUrl(ticker: string) {
  const q = encodeURIComponent(`${ticker} stock`)
  return `https://www.bing.com/news/search?q=${q}&format=rss`
}

// Bing redirect links embed the real article URL as a `url=` query param.
// Extracting it gives us the actual article URL for og:image scraping.
function extractRealUrl(bingLink: string): string {
  try {
    const url = new URL(bingLink)
    const real = url.searchParams.get('url')
    return real ? decodeURIComponent(real) : bingLink
  } catch {
    return bingLink
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) return NextResponse.json({ articles: [] })

  const results = await Promise.allSettled(
    tickers.map((ticker) => fetchFeed(bingNewsUrl(ticker), ticker))
  )

  const seenLinks = new Set<string>()
  const seenTitleKeys = new Set<string>()

  const articles = results
    .filter((r): r is PromiseFulfilledResult<ArticleResult[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .filter((a) => {
      if (!a.link || seenLinks.has(a.link)) return false
      seenLinks.add(a.link)
      const key = titleKey(a.title)
      if (key && seenTitleKeys.has(key)) return false
      if (key) seenTitleKeys.add(key)
      return true
    })

  return NextResponse.json({ articles })
}

async function fetchFeed(url: string, ticker: string): Promise<ArticleResult[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const feed = await parser.parseString(xml)
    return feed.items.map((item): ArticleResult => {
      const link = extractRealUrl(item.link ?? '')
      const source = extractDomain(link)
      return {
        ticker,
        title: item.title ?? '',
        link,
        pubDate: item.pubDate ?? new Date().toISOString(),
        source,
        blurb: item.contentSnippet?.trim() || undefined,
        imageUrl:
          item.mediaContent?.$?.url ??
          (item.enclosure?.type?.startsWith('image/') ? item.enclosure.url : undefined),
        isPaywalled: PAYWALLED_PUBLISHERS.has(source),
      }
    })
  } catch {
    return []
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 6)
    .join(' ')
}
