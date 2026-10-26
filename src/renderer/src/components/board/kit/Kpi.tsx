import React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { openLeadSourcesSettings } from '@/lib/open-lead-sources-settings'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../../preload/api/crowsnest-api'

type BoardStep = EngineCallValue<'getFunnelBoard'>['steps'][number]

/** The five states a number can be in. A number that is not whole never reads as a clean value. */
export type KpiState =
  | { kind: 'value' }
  | { kind: 'partial'; missing: number }
  | { kind: 'not-connected' }
  | { kind: 'pull-failed' }
  | { kind: 'pull-partial' }
  | { kind: 'no-data' }

export type KpiData = { value: number | null; state: KpiState; source: string }

export function kpiFromStep(step: BoardStep, source: string): KpiData {
  const total = step.total
  const value = total.status === 'value' ? total.value : null
  if (total.status === 'not-connected') {
    return { value: null, state: { kind: 'not-connected' }, source }
  }
  if (step.pull === 'failed') {
    return { value, state: { kind: 'pull-failed' }, source }
  }
  if (step.pull === 'partial') {
    return { value, state: { kind: 'pull-partial' }, source }
  }
  if (total.status === 'missing') {
    return { value: null, state: { kind: 'no-data' }, source }
  }
  return total.keywordsWithoutNumber > 0
    ? { value, state: { kind: 'partial', missing: total.keywordsWithoutNumber }, source }
    : { value, state: { kind: 'value' }, source }
}

function stateText({ state, source }: KpiData): string {
  switch (state.kind) {
    case 'partial':
      return translate('boards.kit.missingKeywords', 'missing {{count}} keywords', {
        count: state.missing
      })
    case 'not-connected':
      return translate('boards.kit.notConnected', '{{source}} not connected', { source })
    case 'pull-failed':
      return translate('boards.kit.pullFailed', '{{source}} pull failed', { source })
    case 'pull-partial':
      return translate('boards.kit.pullPartial', '{{source}} pull incomplete', { source })
    case 'no-data':
      return translate('boards.kit.noData', 'no data yet')
    case 'value':
      return ''
  }
}

const BADGE_TONE: Record<KpiState['kind'], string> = {
  value: '',
  partial: 'border-status-warning-border text-status-warning',
  'not-connected': '',
  'pull-failed': 'border-destructive/40 text-destructive',
  'pull-partial': 'border-status-warning-border text-status-warning',
  'no-data': 'text-muted-foreground'
}

const SIZE = { lg: 'text-3xl', md: 'text-2xl', sm: 'text-base' } as const

/** Pick 3A: the number slot keeps its size; a small state badge sits under it. */
export function KpiValue({
  data,
  format,
  size = 'md',
  align = 'start'
}: {
  data: KpiData
  format: (value: number) => string
  size?: keyof typeof SIZE
  align?: 'start' | 'end'
}): React.ReactNode {
  const { value, state } = data
  const whole = state.kind === 'value'
  return (
    <div
      data-testid="kpi-value"
      data-state={state.kind}
      className={cn('flex flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')}
    >
      <span
        data-num={value === null ? undefined : true}
        className={cn(
          'font-mono leading-none tabular-nums',
          SIZE[size],
          value === null && 'text-muted-foreground/50',
          value !== null && !whole && 'text-muted-foreground'
        )}
      >
        {value === null ? '—' : format(value)}
      </span>
      <span className="flex h-5 max-w-full items-center">
        {whole ? null : (
          <Badge
            data-testid="kpi-state"
            variant="outline"
            className={cn('max-w-full justify-start font-normal', BADGE_TONE[state.kind])}
            title={stateText(data)}
            asChild={state.kind === 'not-connected'}
          >
            {state.kind === 'not-connected' ? (
              <button type="button" data-testid="open-sources" onClick={openLeadSourcesSettings}>
                <span className="min-w-0 truncate">{stateText(data)}</span>
                <ArrowUpRight />
              </button>
            ) : (
              <span className="min-w-0 truncate">{stateText(data)}</span>
            )}
          </Badge>
        )}
      </span>
    </div>
  )
}

export function KpiTile({
  label,
  data,
  format,
  testId,
  stepId
}: {
  label: string
  data: KpiData
  format: (value: number) => string
  testId?: string
  stepId?: string
}): React.ReactNode {
  return (
    <div
      data-testid={testId}
      data-step-id={stepId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <KpiValue data={data} format={format} />
    </div>
  )
}
