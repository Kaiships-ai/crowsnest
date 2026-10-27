import React from 'react'
import { cn } from '@/lib/utils'

/** One horizontal bar. The default log scale keeps a funnel's last steps visible next to its views; shares of a whole use linear. */
export function Bar({
  value,
  max,
  muted = false,
  scale = 'log'
}: {
  value: number | null
  max: number
  muted?: boolean
  scale?: 'log' | 'linear'
}): React.ReactNode {
  const width =
    value === null || value <= 0 || max <= 0
      ? 0
      : scale === 'linear'
        ? (value / max) * 100
        : (Math.log10(value + 1) / Math.log10(max + 1)) * 100
  return (
    <div data-testid="kit-bar" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn('h-full rounded-full', muted ? 'bg-muted-foreground/40' : 'bg-foreground/70')}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
