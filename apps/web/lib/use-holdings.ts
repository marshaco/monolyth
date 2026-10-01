import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, addHolding, listHoldings, removeHolding } from '@/lib/holdings-api'

// Where holdings lived before the API existed; migrated to the server on first load
const LEGACY_STORAGE_KEY = 'monolyth_holdings'

type State =
  | { status: 'loading' }
  | { status: 'unreachable' }
  | { status: 'ready'; tickers: string[] }

async function migrateLegacyHoldings() {
  let legacy: unknown
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null')
  } catch {
    legacy = null
  }
  if (!Array.isArray(legacy)) return

  const results = await Promise.allSettled(
    legacy.map((ticker) => addHolding({ ticker: String(ticker) })),
  )
  // 409 = already on the server, 422 = not a valid ticker; neither is worth retrying
  const retryable = results.some(
    (r) => r.status === 'rejected' && !(r.reason instanceof ApiError && [409, 422].includes(r.reason.status)),
  )
  if (!retryable) localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function useHoldings() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const tickersRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    migrateLegacyHoldings()
      .catch(() => {})
      .then(listHoldings)
      .then((holdings) => {
        if (cancelled) return
        tickersRef.current = holdings.map((h) => h.ticker)
        setState({ status: 'ready', tickers: tickersRef.current })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unreachable' })
      })
    return () => { cancelled = true }
  }, [loadCount])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setLoadCount((n) => n + 1)
  }, [])

  // Applies the change optimistically, then syncs each added/removed ticker.
  // On any failure, shows the error and reloads the server's list as the source of truth.
  const setTickers = useCallback(async (next: string[]) => {
    const prev = tickersRef.current
    tickersRef.current = next
    setState({ status: 'ready', tickers: next })
    setError(null)

    const added = next.filter((t) => !prev.includes(t))
    const removed = prev.filter((t) => !next.includes(t))
    try {
      await Promise.all([
        ...added.map((ticker) =>
          addHolding({ ticker }).catch((e) => {
            throw e instanceof ApiError && e.status === 422
              ? new ApiError(422, `"${ticker}" isn't a valid ticker`)
              : e
          }),
        ),
        ...removed.map(removeHolding),
      ])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your holdings")
      setLoadCount((n) => n + 1)
    }
  }, [])

  return {
    tickers: state.status === 'ready' ? state.tickers : [],
    status: state.status,
    error,
    dismissError: () => setError(null),
    setTickers,
    retry,
  }
}
