import React from 'react'
import { formatBoardTime } from '../board-time'

export type LinePoint = { at: string; value: number }

/** A small line over time, drawn like Orca's status-bar sparkline: one polyline, no axes, first and last time under it. */
export function LineChart({
  points,
  format,
  testId,
  formatAt = formatBoardTime
}: {
  points: LinePoint[]
  format: (value: number) => string
  testId?: string
  formatAt?: (at: string) => string
}): React.ReactNode {
  const max = Math.max(...points.map((p) => p.value), 1)
  const line = points
    .map((p, i) => `${(100 * i) / Math.max(points.length - 1, 1)},${40 - (38 * p.value) / max}`)
    .join(' ')
  const first = points[0]
  const last = points.at(-1)
  return (
    <div data-testid={testId} data-points={points.length} className="flex flex-col gap-1">
      <div className="flex justify-end font-mono text-2xs text-muted-foreground">
        <span data-num>{format(max)}</span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-24 w-full text-chart-2"
        aria-hidden
      >
        <polygon points={`0,40 ${line} 100,40`} fill="currentColor" fillOpacity={0.08} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {first && last ? (
        <div className="flex justify-between font-mono text-2xs text-muted-foreground">
          <span>{formatAt(first.at)}</span>
          <span>{formatAt(last.at)}</span>
        </div>
      ) : null}
    </div>
  )
}
