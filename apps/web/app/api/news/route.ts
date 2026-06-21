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

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'is', 'are', 'was', 'were', 'be', 'by', 'its', 'it', 'as',
  'with', 'has', 'have', 'had', 'says', 'said', 'after', 'over',
])

// Google News RSS returns results from across the web (FT, WSJ, Reuters, Bloomberg,
// Barron's, etc.) for any search query — no API key, no pre-chosen outlet list.
function googleNewsUrl(ticker: string) {
  const q = encodeURIComponent(`${ticker} stock`)
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
}

// Google News titles are formatted "Article headline - Source Name".
// Split on the last " - " to recover the clean title and outlet name.
function parseTitle(raw: string): { title: string; source: string } {
  const idx = raw.lastIndexOf(' - ')
  if (idx === -1) return { title: raw, source: '' }
  return { title: raw.slice(0, idx), source: raw.slice(idx + 3) }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) return NextResponse.json({ articles: [] })

  const results = await Promise.allSettled(
    tickers.map((ticker) => fetchFeed(googleNewsUrl(ticker), ticker))
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
      const { title, source } = parseTitle(item.title ?? '')
      return {
        ticker,
        title,
        link: item.link ?? '',
        pubDate: item.pubDate ?? new Date().toISOString(),
        source,
        blurb: item.contentSnippet?.trim() || undefined,
        imageUrl:
          item.mediaContent?.$?.url ??
          (item.enclosure?.type?.startsWith('image/') ? item.enclosure.url : undefined),
      }
    })
  } catch {
    return []
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
