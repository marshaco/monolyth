import { NextRequest, NextResponse } from 'next/server'
import Parser from 'rss-parser'

type FeedItem = {
  title?: string
  link?: string
  pubDate?: string
  contentSnippet?: string
}

const parser = new Parser<object, FeedItem>()

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) {
    return NextResponse.json({ articles: [] })
  }

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`
      const feed = await parser.parseURL(url)
      return feed.items.map((item) => ({
        ticker,
        title: item.title ?? '',
        link: item.link ?? '',
        pubDate: item.pubDate ?? '',
        source: extractDomain(item.link ?? ''),
      }))
    })
  )

  const seen = new Set<string>()
  const articles = results
    .filter((r): r is PromiseFulfilledResult<ReturnType<typeof toArticle>[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((a) => {
      if (!a.link || seen.has(a.link)) return false
      seen.add(a.link)
      return true
    })
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())

  return NextResponse.json({ articles })
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function toArticle(item: FeedItem, ticker: string) {
  return {
    ticker,
    title: item.title ?? '',
    link: item.link ?? '',
    pubDate: item.pubDate ?? '',
    source: extractDomain(item.link ?? ''),
  }
}
