import React from 'react'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatCount, ReadingValue, type Reading } from './funnel-reading'
import type { KpiData } from './kit/Kpi'

type OwnBoardData = EngineCallValue<'getOwnBoard'>
export type OwnTotal = OwnBoardData['totals']['views']
export type OwnPostCard = OwnBoardData['posts'][number]
export type AfterReading = OwnPostCard['after']['dm']
export type AfterKey = keyof OwnPostCard['after']

export const INSTAGRAM = 'Instagram'

export const AFTER_COLUMNS: { key: AfterKey; source: string }[] = [
  { key: 'dm', source: 'ChatbotX' },
  { key: 'gift_page_visit', source: 'Umami' },
  { key: 'purchase', source: 'Polar' }
]

export const columnLabel = (key: string): string => translate(`boards.own.col.${key}`, key)

export const valueOf = (reading: Reading | AfterReading): number | null =>
  reading.status === 'value' ? reading.value : null

export const capturedAt = (reading: Reading | AfterReading): string | undefined =>
  reading.status === 'value' ? reading.capturedAt : undefined

export function AfterValue({ reading }: { reading: AfterReading }): React.ReactNode {
  if (reading.status === 'no-keyword') {
    return (
      <span
        data-testid="reading-no-keyword"
        title={translate(
          'boards.own.noKeywordHint',
          "This reel has no keyword, so it can't be linked."
        )}
        className="font-mono text-xs text-muted-foreground"
      >
        {translate('boards.funnel.notConnected', 'not connected')}
      </span>
    )
  }
  return <ReadingValue reading={reading} format={formatCount} vaultLink={false} />
}

/** A reading as a Kpi. A total that lacks some posts' numbers is partial, and a failed newest pull marks the number it left behind. */
export function kpiFromReading(
  reading: Reading | OwnTotal,
  source: string,
  pullFailed = false
): KpiData {
  if (reading.status === 'not-connected') {
    return { value: null, state: { kind: 'not-connected' }, source }
  }
  const value = reading.status === 'value' ? reading.value : null
  if (pullFailed) {
    return { value, state: { kind: 'pull-failed' }, source }
  }
  if (reading.status === 'missing') {
    return { value: null, state: { kind: 'no-data' }, source }
  }
  const missing = 'postsWithoutNumber' in reading ? reading.postsWithoutNumber : 0
  return missing > 0
    ? { value, state: { kind: 'partial', missing, of: 'posts' }, source }
    : { value, state: { kind: 'value' }, source }
}

/** The oldest pull time among a block's numbers, so its source tag never claims fresher data than it holds. */
export const oldestAt = (readings: (Reading | AfterReading)[]): string | null =>
  readings
    .flatMap((r) => {
      const at = capturedAt(r)
      return at ? [at] : []
    })
    .reduce<string | null>((oldest, at) => (oldest === null || at < oldest ? at : oldest), null)
