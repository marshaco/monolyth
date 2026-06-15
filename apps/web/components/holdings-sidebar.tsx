'use client'

import { useState, KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X, TrendingUp } from 'lucide-react'

interface Props {
  tickers: string[]
  onChange: (tickers: string[]) => void
}

export default function HoldingsSidebar({ tickers, onChange }: Props) {
  const [input, setInput] = useState('')

  const add = () => {
    const ticker = input.trim().toUpperCase()
    if (ticker && !tickers.includes(ticker)) {
      onChange([...tickers, ticker])
    }
    setInput('')
  }

  const remove = (ticker: string) => {
    onChange(tickers.filter((t) => t !== ticker))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') add()
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col p-4 gap-5">
      <div className="flex items-center gap-2 pt-1">
        <TrendingUp size={16} className="text-zinc-400" />
        <span className="text-sm font-semibold text-zinc-100 tracking-tight">monolyth</span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Holdings</p>
        <div className="flex gap-2">
          <Input
            placeholder="AAPL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-sm h-8"
          />
          <Button
            size="sm"
            onClick={add}
            className="h-8 px-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 border-0"
          >
            +
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-0.5">
        {tickers.map((ticker) => (
          <li
            key={ticker}
            className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-zinc-800 group"
          >
            <span className="text-sm font-medium text-zinc-200">{ticker}</span>
            <button
              onClick={() => remove(ticker)}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
