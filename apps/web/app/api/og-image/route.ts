import { NextRequest, NextResponse } from 'next/server'

const OG_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:url["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
]

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ imageUrl: null })

  const imageUrl = await extractOgImage(url)
  return NextResponse.json({ imageUrl: imageUrl ?? null }, {
    headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' },
  })
}

async function extractOgImage(url: string): Promise<string | undefined> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Monolyth/1.0; +https://monolyth.app)',
        Accept: 'text/html',
      },
    })

    if (!res.ok || !res.body) return undefined

    // Stream only until we find og:image or reach </head> — avoids reading full page
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>') || html.length > 80_000) {
        await reader.cancel()
        break
      }
    }

    for (const pattern of OG_PATTERNS) {
      const match = html.match(pattern)
      if (match?.[1]) {
        const raw = match[1].replace(/&amp;/g, '&')
        // Resolve relative URLs
        try {
          return new URL(raw, url).href
        } catch {
          return raw
        }
      }
    }

    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}
