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
}

const parser = new Parser<object, FeedItem>({
  customFields: { item: [['media:content', 'mediaContent']] },
})

// Per-ticker RSS sources — each function receives the ticker and returns the feed URL.
// Sources that don't support per-ticker filtering (e.g. general market feeds) are excluded
// here; they would need a separate topic-based ingestion path.
const SOURCES: Array<(ticker: string) => string> = [
  (t) => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${t}&region=US&lang=en-US`,
  (t) => `https://search.cnbc.com/rs/search/combinedcombined/articles.xml?keywords=${t}&type=article&sort=newest`,
  (t) => `https://seekingalpha.com/api/sa/combined/${t}.xml`,
  (t) => `https://feeds.marketwatch.com/marketwatch/realtimeheadlines/?filter=${t}`,
]

// Common words excluded when building the dedup title key
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

  const results = await Promise.allSettled(
    tickers.flatMap((ticker) => SOURCES.map((urlFn) => fetchFeed(urlFn(ticker), ticker)))
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

      // Fuzzy dedup: same story covered by multiple outlets shares similar title words
      const key = titleKey(a.title)
      if (key && seenTitleKeys.has(key)) return false
      if (key) seenTitleKeys.add(key)

      return true
    })

  return NextResponse.json({ articles })
}

async function fetchFeed(url: string, ticker: string): Promise<ArticleResult[]> {
  try {
    // Cache RSS XML for 5 minutes to avoid hammering sources on every page load
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    const feed = await parser.parseString(xml)
    return feed.items.map((item): ArticleResult => ({
      ticker,
      title: item.title ?? '',
      link: item.link ?? '',
      pubDate: item.pubDate ?? new Date().toISOString(),
      source: extractDomain(item.link ?? ''),
      blurb: item.contentSnippet?.trim() || undefined,
      imageUrl:
        item.mediaContent?.$?.url ??
        (item.enclosure?.type?.startsWith('image/') ? item.enclosure.url : undefined),
    }))
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

// Build a 6-word key from meaningful title words for cross-source deduplication
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 6)
    .join(' ')
}
