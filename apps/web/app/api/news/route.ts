import { NextRequest, NextResponse } from 'next/server'

type PolygonArticle = {
  title: string
  article_url: string
  image_url?: string
  description?: string
  published_utc: string
  tickers?: string[]
  publisher: {
    name: string
    favicon_url?: string
  }
}

type PolygonResponse = {
  results: PolygonArticle[]
  status: string
  next_url?: string
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

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'is', 'are', 'was', 'were', 'be', 'by', 'its', 'it', 'as',
  'with', 'has', 'have', 'had', 'says', 'said', 'after', 'over',
])

export async function GET(req: NextRequest) {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey || apiKey === 'your_polygon_api_key_here') {
    return NextResponse.json({ error: 'POLYGON_API_KEY not configured' }, { status: 500 })
  }

  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) return NextResponse.json({ articles: [] })

  const url = new URL('https://api.polygon.io/v2/reference/news')
  url.searchParams.set('ticker.any_of', tickers.join(','))
  url.searchParams.set('limit', '50')
  url.searchParams.set('order', 'desc')
  url.searchParams.set('sort', 'published_utc')
  url.searchParams.set('apiKey', apiKey)

  const res = await fetch(url.toString(), {
    next: { revalidate: 600 },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({ error: `Polygon error ${res.status}: ${body}` }, { status: 502 })
  }

  const data: PolygonResponse = await res.json()

  const seenLinks = new Set<string>()
  const seenTitleKeys = new Set<string>()

  const articles: ArticleResult[] = (data.results ?? [])
    .filter((article) => {
      if (!article.article_url || seenLinks.has(article.article_url)) return false
      seenLinks.add(article.article_url)
      const key = titleKey(article.title)
      if (key && seenTitleKeys.has(key)) return false
      if (key) seenTitleKeys.add(key)
      return true
    })
    .map((article) => {
      // Tag with the first matching ticker from the user's holdings;
      // fall back to the first ticker Polygon tagged if none overlap
      const matchedTicker =
        tickers.find((t) => article.tickers?.includes(t)) ?? article.tickers?.[0] ?? tickers[0]
      return {
        ticker: matchedTicker,
        title: article.title,
        link: article.article_url,
        pubDate: article.published_utc,
        source: article.publisher.name,
        blurb: article.description || undefined,
        imageUrl: article.image_url || undefined,
      }
    })

  return NextResponse.json({ articles })
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
