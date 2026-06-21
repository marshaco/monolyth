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

type ParsedItem = {
  title: string
  link: string
  pubDate: string
  blurb?: string
  imageUrl?: string
}

type ArticleResult = {
  ticker: string
  title: string
  link: string
  pubDate: string
  source: string
  blurb?: string
  imageUrl?: string
}

const parser = new Parser<object, FeedItem>({
  customFields: { item: [['media:content', 'mediaContent']] },
})

// General finance/markets RSS feeds from reputable outlets.
// These are fetched once per request (cached), then filtered by ticker mention —
// no reliance on Yahoo Finance's unofficial per-ticker API.
const FEEDS = [
  'https://feeds.reuters.com/reuters/businessNews',
  'https://feeds.reuters.com/reuters/technologyNews',
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',    // Top News
  'https://www.cnbc.com/id/15839135/device/rss/rss.html',     // US Markets
  'https://www.cnbc.com/id/19854910/device/rss/rss.html',     // Technology
  'https://feeds.marketwatch.com/marketwatch/topstories/',
  'https://feeds.marketwatch.com/marketwatch/marketpulse/',
  'https://www.barrons.com/xml/rss/3_7514.xml',
  'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_top_headlines',
]

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'is', 'are', 'was', 'were', 'be', 'by', 'its', 'it', 'as',
  'with', 'has', 'have', 'had', 'says', 'said', 'after', 'over',
])

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) return NextResponse.json({ articles: [] })

  // Fetch all feeds in parallel; each is cached for 10 minutes
  const results = await Promise.allSettled(FEEDS.map(fetchFeed))

  const allItems = results
    .filter((r): r is PromiseFulfilledResult<ParsedItem[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  const seenLinks = new Set<string>()
  const seenTitleKeys = new Set<string>()
  const articles: ArticleResult[] = []

  for (const item of allItems) {
    if (!item.link || seenLinks.has(item.link)) continue
    seenLinks.add(item.link)

    const key = titleKey(item.title)
    if (key && seenTitleKeys.has(key)) continue
    if (key) seenTitleKeys.add(key)

    // Tag with the first ticker this article mentions
    const matchedTicker = tickers.find((t) => mentionsTicker(item, t))
    if (!matchedTicker) continue

    articles.push({
      ticker: matchedTicker,
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      source: extractDomain(item.link),
      blurb: item.blurb,
      imageUrl: item.imageUrl,
    })
  }

  return NextResponse.json({ articles })
}

async function fetchFeed(url: string): Promise<ParsedItem[]> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    const feed = await parser.parseString(xml)
    return feed.items.map((item): ParsedItem => ({
      title: item.title ?? '',
      link: item.link ?? '',
      pubDate: item.pubDate ?? new Date().toISOString(),
      blurb: item.contentSnippet?.trim() || undefined,
      imageUrl:
        item.mediaContent?.$?.url ??
        (item.enclosure?.type?.startsWith('image/') ? item.enclosure.url : undefined),
    }))
  } catch {
    return []
  }
}

// Match "$AAPL", "(AAPL)", "AAPL:" and plain "AAPL" as a whole word
function mentionsTicker(item: ParsedItem, ticker: string): boolean {
  const haystack = `${item.title} ${item.blurb ?? ''}`
  return new RegExp(`\\$?\\b${ticker}\\b`, 'i').test(haystack)
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
