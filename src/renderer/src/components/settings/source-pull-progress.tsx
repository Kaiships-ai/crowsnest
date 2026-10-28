import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { translate } from '@/i18n/i18n'

/** A pull past this many seconds shows the long-pull note; the pill stays Pulling. */
export const LONG_PULL_SEC = 120

export function formatElapsed(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function useElapsedSec(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return startedAt ? Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000)) : 0
}

/** A pull in flight: what it is on, x of N, the elapsed time and Stop. Shared by every Sources card that pulls. */
export function SourcePullProgress(props: {
  label: string | null
  done: number
  total: number | null
  /** Plural noun for the items, such as "rivals". */
  unit: string
  startedAt: string | null
  stopping: boolean
  onStop: () => void
  /** The long-pull note's reason sentence, such as why Instagram is slow. */
  slowReason: string
  /** Replaces "Pulling <label>…" and "Stopping after <label>…", for a card whose label reads differently. */
  nowText?: { pulling: string; stopping: string }
  /** Replaces the tally line's "✓ x updated" and "n to go". */
  tally?: [React.ReactNode, React.ReactNode]
}): React.ReactNode {
  const elapsed = useElapsedSec(props.startedAt)
  const total = props.total ?? 0
  const left = Math.max(0, total - props.done)
  return (
    <div data-testid="source-pull-progress" className="space-y-3">
      <div className="space-y-2 rounded-md border border-border/60 p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
          <span data-testid="source-pull-current" className="min-w-0 flex-1 text-foreground">
            {props.nowText && (props.stopping || props.label)
              ? props.stopping
                ? props.nowText.stopping
                : props.nowText.pulling
              : props.stopping
                ? translate('leadStudio.sources.pull.stoppingAfter', 'Stopping after {{label}}…', {
                    label: props.label ?? ''
                  })
                : props.label
                  ? translate('leadStudio.sources.pull.pullingLabel', 'Pulling {{label}}…', {
                      label: props.label
                    })
                  : translate('leadStudio.sources.pull.starting', 'Starting the pull…')}
          </span>
          <span data-testid="source-pull-count" className="font-mono tabular-nums">
            {props.done} / {props.total ?? '?'} {props.unit}
          </span>
          <span
            data-testid="source-pull-elapsed"
            className="font-mono tabular-nums text-muted-foreground"
          >
            {formatElapsed(elapsed)}
          </span>
        </div>
        <Progress value={total ? (100 * props.done) / total : 0} className="h-1.5" />
        <div className="flex gap-4 font-mono text-2xs text-muted-foreground">
          <span data-testid="source-pull-tally-done">
            {props.tally?.[0] ??
              translate('leadStudio.sources.pull.updated', '✓ {{count}} updated', {
                count: props.done
              })}
          </span>
          <span data-testid="source-pull-tally-rest">
            {props.tally?.[1] ??
              translate('leadStudio.sources.pull.toGo', '{{count}} to go', { count: left })}
          </span>
        </div>
      </div>
      {elapsed >= LONG_PULL_SEC ? (
        <p
          data-testid="source-pull-long"
          className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"
        >
          {translate(
            'leadStudio.sources.pull.long',
            'Taking longer than usual ({{elapsed}}). {{reason}} You can leave Settings; the pull keeps going.',
            { elapsed: formatElapsed(elapsed), reason: props.slowReason }
          )}
        </p>
      ) : null}
      <Button
        data-testid="source-pull-stop"
        variant="outline"
        size="sm"
        disabled={props.stopping}
        onClick={props.onStop}
      >
        {props.stopping
          ? translate('leadStudio.sources.pull.stopping', 'Stopping…')
          : translate('leadStudio.sources.pull.stop', 'Stop')}
      </Button>
    </div>
  )
}

/** A finished pull's headline and its counts, three across. */
export function SourcePullSummary(props: {
  headline: React.ReactNode
  cells: { label: string; value: React.ReactNode }[]
}): React.ReactNode {
  return (
    <div data-testid="source-pull-summary" className="space-y-3">
      <p className="text-xs text-foreground">{props.headline}</p>
      <div className="grid grid-cols-3 gap-2">
        {props.cells.map((cell) => (
          <div key={cell.label} className="rounded-md border border-border/60 p-2.5">
            <div className="text-2xs text-muted-foreground">{cell.label}</div>
            <div className="font-mono text-sm tabular-nums text-foreground">{cell.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
