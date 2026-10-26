import React from 'react'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatCount, ReadingValue, SourceLabel, type Reading } from './funnel-reading'

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
          'Reel này không có keyword, nên chưa nối được.'
        )}
        className="font-mono text-xs text-muted-foreground"
      >
        {translate('boards.funnel.notConnected', 'chưa nối')}
      </span>
    )
  }
  return <ReadingValue reading={reading} format={formatCount} vaultLink={false} />
}

export function TotalValue({
  total,
  format = formatCount
}: {
  total: OwnTotal
  format?: (value: number) => string
}): React.ReactNode {
  return (
    <span className="flex flex-col">
      <ReadingValue reading={total} format={format} hero />
      {total.status === 'value' && total.postsWithoutNumber > 0 ? (
        <span data-testid="reading-post-gap" className="font-mono text-2xs text-muted-foreground">
          {translate('boards.own.missingPosts', 'thiếu {{count}} bài', {
            count: total.postsWithoutNumber
          })}
        </span>
      ) : null}
    </span>
  )
}

export function Stat({
  testId,
  label,
  source,
  at,
  children
}: {
  testId: string
  label: string
  source: string
  at: string | undefined
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-2xs text-muted-foreground">{label}</span>
      <span className="text-2xl leading-8">{children}</span>
      <SourceLabel source={source} at={at} />
    </div>
  )
}
