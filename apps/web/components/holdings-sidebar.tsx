'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { X, TrendingUp, Sun, Moon, Monitor } from 'lucide-react'

type ThemeValue = 'light' | 'dark' | 'system'

const THEME_KEY = 'monolyth-theme'

const THEMES: { value: ThemeValue; label: string; icon: typeof Sun }[] = [
  { value: 'light',  label: 'Light',  icon: Sun },
  { value: 'dark',   label: 'Dark',   icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function applyTheme(t: ThemeValue) {
  const isDark =
    t === 'dark' ||
    (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem(THEME_KEY, t)
}

interface Props {
  tickers: string[]
  onChange: (tickers: string[]) => void
}

export default function HoldingsSidebar({ tickers, onChange }: Props) {
  const [input, setInput] = useState('')
  const [theme, setThemeState] = useState<ThemeValue>('dark')
  const [prefsOpen, setPrefsOpen] = useState(false)
  const prefsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as ThemeValue) ?? 'dark'
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  useEffect(() => {
    if (!prefsOpen) return
    const handler = (e: MouseEvent) => {
      if (prefsRef.current && !prefsRef.current.contains(e.target as Node)) {
        setPrefsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [prefsOpen])

  const handleThemeChange = (t: ThemeValue) => {
    setThemeState(t)
    applyTheme(t)
  }

  const add = () => {
    const ticker = input.trim().toUpperCase()
    if (ticker && !tickers.includes(ticker)) onChange([...tickers, ticker])
    setInput('')
  }

  const remove = (ticker: string) => onChange(tickers.filter((t) => t !== ticker))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') add()
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col p-4 gap-5">
      <div className="flex items-center gap-2 pt-1">
        <TrendingUp size={16} className="text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground tracking-tight">monolyth</span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Holdings</p>
        <div className="flex gap-2">
          <Input
            placeholder="AAPL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="text-sm h-8"
          />
          <Button size="sm" variant="secondary" onClick={add} className="h-8 px-2.5">
            +
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-0.5">
        {tickers.map((ticker) => (
          <li
            key={ticker}
            className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted group"
          >
            <span className="text-sm font-medium text-foreground">{ticker}</span>
            <button
              onClick={() => remove(ticker)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-auto relative" ref={prefsRef}>
        {prefsOpen && (
          <div className="absolute bottom-full mb-2 left-0 right-0 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <span className="text-xs font-semibold text-foreground">Preferences</span>
              <button
                onClick={() => setPrefsOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            <div className="p-3 flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground mb-1">Theme</p>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => handleThemeChange(value)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                    theme === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setPrefsOpen((o) => !o)}
          className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold hover:opacity-80 transition-opacity"
          aria-label="Settings"
        >
          M
        </button>
      </div>
    </aside>
  )
}
