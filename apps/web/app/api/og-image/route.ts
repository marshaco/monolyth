import { NextRequest, NextResponse } from 'next/server'

const OG_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:url["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
]

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

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
  const timeout = setTimeout(() => controller.abort(), 6000)

  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS })
    if (!res.ok || !res.body) return undefined

    // Read until </head> or 200KB — Yahoo Finance and similar Next.js sites
    // have large <head> sections (inline scripts) before the og:image meta tag
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>') || html.length > 200_000) {
        await reader.cancel()
        break
      }
    }

    // 1. Standard og/twitter meta tag patterns
    for (const pattern of OG_PATTERNS) {
      const match = html.match(pattern)
      if (match?.[1]) return resolve(match[1], url)
    }

    // 2. Next.js __NEXT_DATA__ fallback — catches Yahoo Finance and similar SSR apps
    //    where the og:image is populated server-side into the hydration JSON
    const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)
    if (nextData?.[1]) {
      const imgMatch = nextData[1].match(
        /"url"\s*:\s*"(https?:\\?\/\\?\/[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*?)"/i,
      )
      if (imgMatch?.[1]) {
        return resolve(imgMatch[1].replace(/\\\/|\\u002F/gi, '/'), url)
      }
    }

    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

function resolve(raw: string, base: string): string {
  const cleaned = raw.replace(/&amp;/g, '&')
  try { return new URL(cleaned, base).href } catch { return cleaned }
}
