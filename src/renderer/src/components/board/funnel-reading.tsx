import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from './board-time'

export type FunnelStep = EngineCallValue<'getFunnelBoard'>['steps'][number]
export type Reading = FunnelStep['total'] | NonNullable<FunnelStep['rate']>['reading']

const SOURCE_NAMES: Record<FunnelStep['source'], string> = {
  instagram: 'Instagram',
  umami: 'Umami',
  chatbotx: 'ChatbotX',
  polar: 'Polar',
  skool: 'Skool'
}

export const sourceName = (source: FunnelStep['source']): string => SOURCE_NAMES[source]

const STEP_EN: Record<string, string> = {
  view: 'Reel views',
  comment_keyword: 'Keyword comments',
  dm: 'Gift DMs',
  gift_page_visit: 'Gift page visits',
  checkout: 'Checkout clicks',
  purchase: 'Purchases'
}

export const stepLabel = (step: Pick<FunnelStep, 'id' | 'label'>): string =>
  translate(`boards.funnel.step.${step.id}`, STEP_EN[step.id] ?? step.label)

const countFormat = new Intl.NumberFormat()
const rateFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1
})

export const formatCount = (value: number): string => countFormat.format(value)
export const formatRate = (value: number): string => rateFormat.format(value)

export function SourceLabel({ source, at }: { source: string; at?: string }): React.ReactNode {
  return (
    <span data-testid="source-label" className="font-mono text-2xs text-muted-foreground">
      {at ? `${source} · ${formatBoardTime(at)}` : source}
    </span>
  )
}

export function KeywordGap({ total }: { total: FunnelStep['total'] }): React.ReactNode {
  if (total.keywordsWithoutNumber === 0) {
    return null
  }
  return (
    <span data-testid="reading-keyword-gap" className="font-mono text-2xs text-muted-foreground">
      {translate('boards.funnel.missingKeywords', 'missing {{count}} keywords', {
        count: total.keywordsWithoutNumber
      })}
    </span>
  )
}

export function ReadingValue({
  reading,
  format,
  vaultLink = true,
  hero = false
}: {
  reading: Reading
  format: (value: number) => string
  vaultLink?: boolean
  hero?: boolean
}): React.ReactNode {
  const gapSize = hero ? '' : 'text-xs'

  if (reading.status === 'value') {
    return (
      <span data-testid="reading-value" data-num className="font-mono tabular-nums">
        {format(reading.value)}
      </span>
    )
  }
  if (reading.status === 'missing') {
    return (
      <span
        data-testid="reading-missing"
        className={cn('font-mono text-muted-foreground', gapSize)}
      >
        {translate('boards.funnel.missing', 'no data yet')}
      </span>
    )
  }
  return (
    <span
      data-testid="reading-not-connected"
      data-connector={reading.connector}
      className={cn(
        'inline-flex items-baseline gap-2 font-mono whitespace-nowrap text-muted-foreground',
        gapSize
      )}
    >
      {translate('boards.funnel.notConnected', 'not connected')}
      {vaultLink ? (
        <Button
          data-testid="open-vault"
          variant="link"
          size="xs"
          className="h-auto px-0 text-xs"
          onClick={() => openBoardInActiveWorkspace('vault')}
        >
          {translate('boards.funnel.vault', 'Sources')}
        </Button>
      ) : null}
    </span>
  )
}

export function ReadingSource({
  step,
  reading
}: {
  step: FunnelStep
  reading: Reading
}): React.ReactNode {
  return (
    <SourceLabel
      source={sourceName(step.source)}
      at={reading.status === 'value' ? reading.capturedAt : undefined}
    />
  )
}
