import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
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

export const stepLabel = (step: Pick<FunnelStep, 'id' | 'label'>): string =>
  translate(`boards.funnel.step.${step.id}`, step.label)

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

export function ReadingValue({
  reading,
  format,
  vaultLink = true
}: {
  reading: Reading
  format: (value: number) => string
  vaultLink?: boolean
}): React.ReactNode {
  if (reading.status === 'value') {
    return (
      <span data-testid="reading-value" data-num className="font-mono tabular-nums">
        {format(reading.value)}
      </span>
    )
  }
  if (reading.status === 'missing') {
    return (
      <span data-testid="reading-missing" className="font-mono text-xs text-muted-foreground">
        {translate('boards.funnel.missing', 'chưa có số')}
      </span>
    )
  }
  return (
    <span
      data-testid="reading-not-connected"
      data-connector={reading.connector}
      className="inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap text-muted-foreground"
    >
      {translate('boards.funnel.notConnected', 'chưa nối')}
      {vaultLink ? (
        <Button
          data-testid="open-vault"
          variant="link"
          size="xs"
          className="h-auto px-0 text-xs"
          onClick={() => openBoardInActiveWorkspace('vault')}
        >
          {translate('boards.funnel.vault', 'Vault')}
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
