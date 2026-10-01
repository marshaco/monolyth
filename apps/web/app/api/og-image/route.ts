import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_REDIRECTS = 3

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
    const res = await safeFetch(url, controller.signal)
    if (!res || !res.ok || !res.body) return undefined

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

// The URL comes from the client, so only fetch public http(s) hosts — and
// re-check every redirect hop, since a public URL can redirect to an internal one.
async function safeFetch(url: string, signal: AbortSignal): Promise<Response | undefined> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isPublicHttpUrl(current))) return undefined
    const res = await fetch(current, { signal, headers: HEADERS, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return res
    current = new URL(location, current).href
  }
  return undefined
}

async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  const host = url.hostname.replace(/^\[|\]$/g, '')
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
    return addrs.length > 0 && addrs.every(({ address }) => !isPrivateAddress(address))
  } catch {
    return false
  }
}

function isPrivateAddress(addr: string): boolean {
  const ip = addr.toLowerCase()
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1])

  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }

  return (
    ip === '::' || ip === '::1' ||
    /^f[cd]/.test(ip) ||        // fc00::/7 unique local
    /^fe[89ab]/.test(ip) ||     // fe80::/10 link-local
    ip.startsWith('::ffff:')    // hex-form v4-mapped — reject rather than decode
  )
}

function resolve(raw: string, base: string): string {
  const cleaned = raw.replace(/&amp;/g, '&')
  try { return new URL(cleaned, base).href } catch { return cleaned }
}
