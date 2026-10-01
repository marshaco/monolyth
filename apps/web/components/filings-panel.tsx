'use client'

import { useEffect, useState } from 'react'
import type { FilingSummary } from '@monolyth/types'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, FileText } from 'lucide-react'
import { listFilings } from '@/lib/filings-api'
import { cn } from '@/lib/utils'

// Filings this recent get a "New" marker until per-user read state exists
const NEW_WITHIN_DAYS = 7
const COLLAPSED_COUNT = 3

interface Props {
  // Changes whenever holdings change, so the list refetches for the new set
  tickerKey: string
}

function isNew(filedOn: string): boolean {
  const ageMs = Date.now() - new Date(`${filedOn}T00:00:00Z`).getTime()
  return ageMs < NEW_WITHIN_DAYS * 24 * 60 * 60 * 1000
}

function formatDate(filedOn: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${filedOn}T00:00:00Z`),
  )
}

function FilingCard({ filing }: { filing: FilingSummary }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="flex flex-col gap-2 bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs py-0 h-5">{filing.ticker}</Badge>
        <span className="text-xs font-medium text-muted-foreground">{filing.form}</span>
        <span className="text-xs text-muted-foreground/40">·</span>
        <span className="text-xs text-muted-foreground">{formatDate(filing.filed_on)}</span>
        {isNew(filing.filed_on) && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-primary">New</span>
        )}
      </div>
      <p className="text-sm font-semibold text-card-foreground leading-snug">
        {filing.summary_headline ?? `${filing.company_name} filed a ${filing.form}`}
      </p>
      {filing.summary && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          title={expanded ? 'Show less' : 'Show the full summary'}
          className={cn(
            'text-left text-xs text-muted-foreground leading-relaxed hover:text-foreground/80 transition-colors',
            !expanded && 'line-clamp-3',
          )}
        >
          {filing.summary}
        </button>
      )}
      <a
        href={filing.document_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto pt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Read the filing on SEC.gov <ExternalLink size={11} />
      </a>
    </article>
  )
}

export default function FilingsPanel({ tickerKey }: Props) {
  const [result, setResult] = useState<{ key: string; filings: FilingSummary[] } | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!tickerKey) return
    let cancelled = false
    listFilings()
      .catch(() => [] as FilingSummary[])
      .then((filings) => {
        if (!cancelled) setResult({ key: tickerKey, filings })
      })
    return () => { cancelled = true }
  }, [tickerKey])

  // While a refetch for changed holdings is in flight, keep showing the previous list so the layout doesn't jump
  const filings = tickerKey && result ? result.filings : []
  // Hidden until there's something to show: most holdings won't have a summarised filing yet
  if (filings.length === 0) return null

  const visible = showAll ? filings : filings.slice(0, COLLAPSED_COUNT)
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <FileText size={14} className="text-muted-foreground" />
          Filings
        </h2>
        {filings.length > COLLAPSED_COUNT && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? 'Show fewer' : `Show all ${filings.length}`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((f) => <FilingCard key={f.id} filing={f} />)}
      </div>
    </section>
  )
}
