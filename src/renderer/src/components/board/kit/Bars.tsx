import React from 'react'
import { cn } from '@/lib/utils'

/** One horizontal bar on a log scale, so a funnel's last steps stay visible next to its views. */
export function Bar({
  value,
  max,
  muted = false
}: {
  value: number | null
  max: number
  muted?: boolean
}): React.ReactNode {
  const width =
    value === null || value <= 0 || max <= 0
      ? 0
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
