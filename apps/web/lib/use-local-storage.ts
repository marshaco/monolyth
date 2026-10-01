import { useCallback, useMemo, useSyncExternalStore } from 'react'

// `storage` events only fire in other tabs, so same-tab writes dispatch this too
const LOCAL_EVENT = 'monolyth-local-storage'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(LOCAL_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(LOCAL_EVENT, onChange)
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export type Codec<T> = { parse: (raw: string) => T; stringify: (value: T) => string }

const JSON_CODEC: Codec<unknown> = { parse: JSON.parse, stringify: JSON.stringify }

// Returns [value, setValue, hydrated]. `hydrated` is false during SSR and the
// hydration render, when localStorage isn't available yet.
export function useLocalStorage<T>(
  key: string,
  fallback: T,
  codec: Codec<T> = JSON_CODEC as Codec<T>,
): [T, (next: T) => void, boolean] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => undefined,
  )

  const value = useMemo(() => {
    if (raw == null) return fallback
    try {
      return codec.parse(raw)
    } catch {
      return fallback
    }
    // fallback and codec are intentionally excluded: callers pass literals, which would re-parse every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const setValue = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, codec.stringify(next))
      } catch {}
      window.dispatchEvent(new Event(LOCAL_EVENT))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  return [value, setValue, raw !== undefined]
}
