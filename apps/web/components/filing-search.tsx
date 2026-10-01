'use client'

import { FormEvent, useState } from 'react'
import type { SearchHit } from '@monolyth/types'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ExternalLink, Search, X } from 'lucide-react'
import { ApiError } from '@/lib/holdings-api'
import { searchFilings } from '@/lib/search-api'

type State =
  | { status: 'idle' }
  | { status: 'searching'; query: string }
  | { status: 'done'; query: string; hits: SearchHit[] }
  | { status: 'error'; query: string; message: string }

function formatDate(filedOn: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${filedOn}T00:00:00Z`),
  )
}

export default function FilingSearch() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const query = input.trim()
    if (query.length < 2) return
    setState({ status: 'searching', query })
    try {
      setState({ status: 'done', query, hits: await searchFilings(query) })
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 503
          ? "Search isn't set up yet: the API needs OPENAI_API_KEY."
          : "Search failed. Try again in a moment."
      setState({ status: 'error', query, message })
    }
  }

  const clear = () => {
    setInput('')
    setState({ status: 'idle' })
  }

  return (
    <section className="mb-8">
      <form onSubmit={submit} className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search your holdings' filings, e.g. what have they said about margin pressure?"
          aria-label="Search your holdings' filings"
          className="h-9 pl-9 pr-9 text-sm"
        />
        {state.status !== 'idle' && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </form>

      {state.status === 'searching' && (
        <p className="mt-3 text-xs text-muted-foreground">Searching filings…</p>
      )}
      {state.status === 'error' && <p className="mt-3 text-xs text-destructive">{state.message}</p>}
      {state.status === 'done' && state.hits.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing found for “{state.query}” in your holdings’ filings yet.
        </p>
      )}
      {state.status === 'done' && state.hits.length > 0 && (
        <ol className="mt-3 flex flex-col gap-3" aria-label={`Results for ${state.query}`}>
          {state.hits.map((hit, i) => (
            <li key={`${hit.document_url}-${i}`} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs py-0 h-5">{hit.ticker}</Badge>
                <span className="text-xs font-medium text-muted-foreground">{hit.form}</span>
                <span className="text-xs text-muted-foreground/40">·</span>
                <span className="text-xs text-muted-foreground">{formatDate(hit.filed_on)}</span>
                <a
                  href={hit.document_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Filing <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-xs text-card-foreground leading-relaxed line-clamp-5 whitespace-pre-line">{hit.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
