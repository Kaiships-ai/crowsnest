import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import { CP2_DECISIONS, setCp2, useCp2, type Cp2Key } from './cp2-variant'

function Row({ k }: { k: Cp2Key }): React.ReactNode {
  const value = useCp2(k)
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-2xs text-muted-foreground">{CP2_DECISIONS[k].label}</span>
      <div className="flex gap-0.5 rounded-md border border-border p-0.5">
        {CP2_DECISIONS[k].options.map((opt) => (
          <button
            key={opt}
            type="button"
            data-testid={`cp2-${k}-${opt}`}
            aria-pressed={value === opt}
            onClick={() => setCp2(k, opt)}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-medium transition-colors',
              value === opt
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Cp2Switcher(): React.ReactNode {
  const [open, setOpen] = useState(true)
  return (
    <div
      data-testid="cp2-switcher"
      className="fixed right-3 bottom-8 z-[60] flex flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-floating"
    >
      <button
        type="button"
        data-testid="cp2-toggle"
        onClick={() => setOpen(!open)}
        className="text-left font-mono text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        CP2 prototype {open ? '−' : '+'}
      </button>
      {open ? (Object.keys(CP2_DECISIONS) as Cp2Key[]).map((k) => <Row key={k} k={k} />) : null}
    </div>
  )
}
