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

// Matched against the article's hostname, including subdomains (e.g. markets.ft.com)
const PAYWALLED_DOMAINS = [
  'ft.com',             // Financial Times
  'wsj.com',            // The Wall Street Journal
  'barrons.com',        // Barron's
  'bloomberg.com',      // Bloomberg
  'economist.com',      // The Economist
  'reuters.com',        // Reuters
  'thetimes.com',       // The Times
  'thetimes.co.uk',     // The Times (legacy domain)
  'telegraph.co.uk',    // The Telegraph
  'theinformation.com', // The Information
  'investors.com',      // Investor's Business Daily
]

function isPaywalledDomain(hostname: string): boolean {
  return PAYWALLED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))
}

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
    tickers.map(async (ticker) =>
      Promise.all((await fetchFeed(bingNewsUrl(ticker), ticker)).map(resolveMsnArticle)),
    ),
  )

  const seenLinks = new Set<string>()
  const seenTitleKeys = new Set<string>()

  const deduped = results
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

  return NextResponse.json({ articles: interleaveByTicker(deduped) })
}

// Round-robin across tickers so one busy holding can't fill the top of the feed.
// Input must be date-sorted; groups are ordered by their newest article.
function interleaveByTicker(articles: ArticleResult[]): ArticleResult[] {
  const groups = new Map<string, ArticleResult[]>()
  for (const a of articles) {
    const group = groups.get(a.ticker)
    if (group) group.push(a)
    else groups.set(a.ticker, [a])
  }

  const queues = [...groups.values()]
  const out: ArticleResult[] = []
  for (let i = 0; out.length < articles.length; i++) {
    for (const q of queues) {
      if (i < q.length) out.push(q[i])
    }
  }
  return out
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
        isPaywalled: isPaywalledDomain(source),
      }
    })
  } catch {
    return []
  }
}

// MSN pages are client-rendered shells with no og:image, and most MSN stories are
// syndicated. MSN's content API (undocumented, used by its own frontend) returns the
// original publisher's URL and the article images, so we link to the publisher instead.
// Any failure falls back to the MSN article unchanged.
const MSN_ARTICLE = /^\/([a-z]{2}-[a-z]{2})\/.*\/ar-([A-Za-z0-9]+)/

type MsnDetail = {
  sourceHref?: string
  imageResources?: { url?: string }[]
}

async function resolveMsnArticle(article: ArticleResult): Promise<ArticleResult> {
  if (article.source !== 'msn.com') return article

  let locale: string, id: string
  try {
    const match = new URL(article.link).pathname.match(MSN_ARTICLE)
    if (!match) return article
    ;[, locale, id] = match
  } catch {
    return article
  }

  try {
    const res = await fetch(`https://assets.msn.com/content/view/v2/Detail/${locale}/${id}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return article
    const detail: MsnDetail = await res.json()

    const imageUrl = article.imageUrl ?? detail.imageResources?.find((r) => r.url)?.url
    const original = detail.sourceHref?.startsWith('http') ? detail.sourceHref : undefined
    if (!original) return { ...article, imageUrl }

    const source = extractDomain(original)
    return { ...article, link: original, source, imageUrl, isPaywalled: isPaywalledDomain(source) }
  } catch {
    return article
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
