import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { CookAction, CookCard, CookSegment, CookView } from './cook-pane-state'

const TONE: Record<CookCard['tone'], string> = {
  run: 'border-border bg-card',
  need: 'border-status-warning-border bg-status-warning-background',
  err: 'border-destructive/30 bg-destructive/10',
  ok: 'border-status-success-border bg-status-success-background',
  idle: 'border-border bg-muted/50'
}

function Signal({ tone }: { tone: CookCard['tone'] }): React.ReactNode {
  if (tone === 'run') {
    return <Loader2 className="size-3.5 animate-spin text-chart-2" />
  }
  if (tone === 'need') {
    return <span className="size-2 rotate-45 rounded-[2px] bg-status-warning" />
  }
  if (tone === 'idle') {
    return <span className="size-2 rounded-full bg-muted-foreground" />
  }
  return (
    <span
      className={cn(
        'grid size-4 place-items-center rounded-full text-[10px] font-bold text-background',
        tone === 'err' ? 'bg-destructive' : 'bg-status-success'
      )}
    >
      {tone === 'err' ? '!' : '✓'}
    </span>
  )
}

const ACTION_LABEL: Record<CookAction, () => string> = {
  retry: () => translate('boards.cook.retry', 'Retry cook'),
  resume: () => translate('boards.cook.resume', 'Resume cook'),
  terminal: () => translate('boards.cook.terminal', 'Show terminal')
}

export function StatusCard({
  card,
  onAction,
  children
}: {
  card: CookCard
  onAction: (action: CookAction) => void
  children?: React.ReactNode
}): React.ReactNode {
  return (
    <section
      data-testid="cook-card"
      data-state={card.state}
      data-tone={card.tone}
      className={cn('flex flex-col gap-2.5 rounded-xl border px-4 py-3.5', TONE[card.tone])}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-5 w-[18px] flex-none place-items-center" aria-hidden>
          <Signal tone={card.tone} />
        </span>
        <div className="min-w-0">
          <h3 data-testid="cook-card-head" className="text-[15px] leading-snug font-semibold">
            {card.head}
          </h3>
          {card.sub ? (
            <p
              data-testid="cook-card-sub"
              className="mt-0.5 text-[13px] break-words text-muted-foreground"
            >
              {card.sub}
            </p>
          ) : null}
        </div>
      </div>
      <div className="ml-7 flex flex-col gap-2.5">
        {children}
        {card.note ? (
          <p
            data-testid="cook-card-note"
            className="rounded-lg border border-status-warning-border bg-status-warning-background px-2.5 py-1.5 text-[12.5px]"
          >
            {card.note}
          </p>
        ) : null}
        {card.acts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {card.acts.map((action, i) => (
              <Button
                key={action}
                data-testid={`cook-${action}`}
                size="sm"
                variant={i === 0 && action !== 'terminal' ? 'default' : 'outline'}
                onClick={() => onAction(action)}
              >
                {ACTION_LABEL[action]()}
              </Button>
            ))}
          </div>
        ) : null}
        {card.can || card.wait ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            {card.can ? (
              <>
                <dt className="font-mono text-2xs leading-[1.9] tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                  {translate('boards.cook.youCan', 'You can')}
                </dt>
                <dd>{card.can}</dd>
              </>
            ) : null}
            {card.wait ? (
              <>
                <dt className="font-mono text-2xs leading-[1.9] tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                  {translate('boards.cook.ifYouWait', 'If you wait')}
                </dt>
                <dd>{card.wait}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  )
}

const SEGMENT_BAR: Record<CookSegment['state'], string> = {
  done: 'bg-foreground/80',
  current: 'bg-chart-2',
  waiting: 'bg-status-warning',
  failed: 'bg-destructive',
  paused: 'bg-muted-foreground/50',
  pending: ''
}

export function Strip({ segments }: { segments: CookSegment[] }): React.ReactNode {
  return (
    <div data-testid="cook-strip" role="list" className="grid grid-cols-6 gap-1.5">
      {segments.map((seg) => (
        <div
          key={seg.group}
          role="listitem"
          data-testid="cook-segment"
          data-state={seg.state}
          className="flex min-w-0 flex-col gap-1.5"
        >
          <i className="relative block h-[5px] overflow-hidden rounded-full bg-muted">
            {/* No pct = indeterminate: a faint full-width pulse, never a width job.json did not give. */}
            <b
              data-testid="cook-segment-bar"
              data-indeterminate={seg.state === 'current' && seg.pct == null ? 'true' : undefined}
              className={cn(
                'absolute inset-y-0 left-0 rounded-full',
                SEGMENT_BAR[seg.state],
                seg.state === 'current' && seg.pct == null && 'animate-pulse opacity-40'
              )}
              style={{
                width:
                  seg.state === 'pending'
                    ? 0
                    : seg.state === 'current' && seg.pct != null
                      ? `${seg.pct}%`
                      : '100%'
              }}
            />
          </i>
          <span
            className={cn(
              'truncate text-[11.5px]',
              seg.state === 'done' || seg.state === 'pending'
                ? 'text-muted-foreground'
                : 'font-medium text-foreground'
            )}
          >
            {seg.state === 'done' ? '✓ ' : ''}
            {translate(`boards.cook.step.${seg.group}`, seg.group)}
          </span>
          {seg.time ? (
            <em className="-mt-1 font-mono text-[11px] text-muted-foreground not-italic">
              {seg.time}
            </em>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function scriptRows(lines: string[]): [string, string][] {
  return lines.map((line, i) => [
    i === 0 ? 'HOOK' : i === lines.length - 1 && lines.length > 1 ? 'CTA' : String(i),
    line
  ])
}

export function ScriptBox({ view }: { view: CookView }): React.ReactNode {
  const fromVo = view.scriptLines != null
  const lines =
    view.scriptLines ??
    (view.planScript ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  if (lines.length === 0) {
    return null
  }
  return (
    <div
      data-testid="cook-script"
      data-source={fromVo ? 'vo' : 'plan'}
      className="rounded-xl border border-border bg-card px-4 py-3"
    >
      <h4 className="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold">
        {translate('boards.cook.script', 'Script')}
        <span className="font-mono text-2xs font-normal text-muted-foreground">
          {fromVo
            ? translate('boards.cook.voScript', 'vo/script.json · word for word')
            : translate('boards.cook.fromPlan', 'from Plan · Claude reads it next')}
        </span>
      </h4>
      <div className={cn('flex flex-col gap-1 text-sm', !fromVo && 'text-muted-foreground')}>
        {scriptRows(lines).map(([label, text], i) => (
          <p key={i} className="grid grid-cols-[2.75rem_1fr] gap-1">
            <span className="pt-0.5 font-mono text-2xs text-muted-foreground">{label}</span>
            <span>{text}</span>
          </p>
        ))}
      </div>
    </div>
  )
}

const slotFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
})

export function slotLabel(view: CookView): string | null {
  return view.plannedDate
    ? `${slotFormat.format(new Date(`${view.plannedDate}T12:00:00`)).replace(',', '')}${view.plannedTime ? ` · ${view.plannedTime}` : ''}`
    : null
}

export function metaLine(view: CookView): string {
  return [
    `films/${view.slug}/`,
    view.style,
    view.keyword ? `keyword ${view.keyword}` : null,
    slotLabel(view)
  ]
    .filter(Boolean)
    .join(' · ')
}
