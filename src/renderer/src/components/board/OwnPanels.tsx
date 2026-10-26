import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatCount, formatRate } from './funnel-reading'
import { Bar } from './kit/Bars'
import { KpiTile } from './kit/Kpi'
import { LineChart } from './kit/LineChart'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import {
  AFTER_COLUMNS,
  capturedAt,
  columnLabel,
  INSTAGRAM,
  kpiFromReading,
  oldestAt,
  valueOf,
  type OwnPostCard
} from './own-reading'

type OwnBoardData = EngineCallValue<'getOwnBoard'>
type Breakdown = OwnBoardData['audience']['followerSplit']
type TotalKey = keyof OwnBoardData['totals']

const signed = (value: number): string =>
  value > 0 ? `+${formatCount(value)}` : formatCount(value)

const dayFormat = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit' })
const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Views summed by the day each post went up, every day of the window drawn, so a day with no post reads 0. */
export function viewsByPostDay(
  posts: OwnPostCard[],
  days: number,
  now = new Date()
): { at: string; value: number }[] {
  const byDay = new Map<string, number>()
  for (const post of posts) {
    const views = valueOf(post.ig.views)
    if (views !== null) {
      const day = localDay(new Date(post.postedAt))
      byDay.set(day, (byDay.get(day) ?? 0) + views)
    }
  }
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i))
    return { at: date.toISOString(), value: byDay.get(localDay(date)) ?? 0 }
  })
}

/** A post whose newest pull failed still adds its last good numbers, so per-post totals are marked, never shown clean. */
const pullFailed = (board: OwnBoardData): boolean => board.posts.some((p) => p.pullError !== null)

function BreakdownBars({
  testId,
  title,
  rows
}: {
  testId: string
  title: string
  rows: Breakdown
}): React.ReactNode {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <span className="font-mono text-xs text-muted-foreground">
          {translate('boards.kit.noData', 'no data yet')}
        </span>
      ) : (
        rows.slice(0, 6).map((r) => (
          <div key={r.key} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate">{r.key}</span>
            <Bar value={r.value} max={total} scale="linear" />
            <span data-num className="text-right font-mono text-xs tabular-nums">
              {formatRate(total > 0 ? r.value / total : 0)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function IgTiles({
  board,
  keys
}: {
  board: OwnBoardData
  keys: { key: TotalKey; label: string }[]
}): React.ReactNode {
  return (
    <div className="grid grid-cols-3 gap-3">
      {keys.map(({ key, label }) => (
        <KpiTile
          key={key}
          testId={`own-stat-${key}`}
          label={label}
          data={kpiFromReading(board.totals[key], INSTAGRAM, pullFailed(board))}
          format={formatCount}
        />
      ))}
    </div>
  )
}

export function OverviewPanel({ board }: { board: OwnBoardData }): React.ReactNode {
  const { totals, after } = board
  const viewsMissing = board.posts.filter((p) => valueOf(p.ig.views) === null).length
  const viewsStale = board.posts.filter((p) => p.pullError !== null).length
  return (
    <>
      <section className="flex flex-col gap-2">
        <BlockHeader
          title={translate('boards.own.igBlock', 'Instagram · last {{count}} days', {
            count: board.windowDays
          })}
        >
          <SourceTag
            sources={[INSTAGRAM]}
            at={oldestAt([totals.views, board.followers, board.netFollowers])}
          />
        </BlockHeader>
        <div className="grid grid-cols-3 gap-3">
          <KpiTile
            testId="own-stat-views"
            label={translate('boards.own.views', 'Post views in range')}
            data={kpiFromReading(totals.views, INSTAGRAM, pullFailed(board))}
            format={formatCount}
          />
          <KpiTile
            testId="own-stat-followers"
            label={translate('boards.own.followers', 'Followers')}
            data={kpiFromReading(board.followers, INSTAGRAM)}
            format={formatCount}
          />
          <KpiTile
            testId="own-stat-net"
            label={translate('boards.own.net', 'Net follows')}
            data={kpiFromReading(board.netFollowers, INSTAGRAM)}
            format={signed}
          />
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {translate('boards.own.viewsByDay', 'Views by post date')}
            {viewsMissing > 0
              ? ` · ${translate('boards.kit.missingPosts', 'missing {{count}} posts', {
                  count: viewsMissing
                })}`
              : ''}
            {viewsStale > 0
              ? ` · ${translate(
                  'boards.own.postsPullFailed',
                  '{{count}} posts kept old numbers after a failed pull',
                  {
                    count: viewsStale
                  }
                )}`
              : ''}
          </span>
          <LineChart
            testId="own-views-line"
            points={viewsByPostDay(board.posts, board.windowDays)}
            format={formatCount}
            formatAt={(at) => dayFormat.format(new Date(at))}
          />
        </div>
      </section>
      <section data-testid="own-after-totals" className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.own.afterTitle', 'After the reel · Lead Studio')}>
          <SourceTag
            sources={AFTER_COLUMNS.map((c) => c.source)}
            at={oldestAt(AFTER_COLUMNS.map((c) => after[c.key]))}
          />
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0"
            onClick={() => openBoardInActiveWorkspace('funnel')}
          >
            {translate('boards.own.openFunnel', 'Open Funnel')}
          </Button>
        </BlockHeader>
        <div className="grid grid-cols-3 gap-3">
          {AFTER_COLUMNS.map((c) => (
            <KpiTile
              key={c.key}
              testId={`own-total-${c.key}`}
              label={columnLabel(c.key)}
              data={kpiFromReading(after[c.key], c.source)}
              format={formatCount}
            />
          ))}
        </div>
      </section>
    </>
  )
}

export function PerformancePanel({ board }: { board: OwnBoardData }): React.ReactNode {
  const at = capturedAt(board.totals.views) ?? null
  const formatMax = Math.max(0, ...board.viewsByFormat.map((f) => valueOf(f.views) ?? 0))
  return (
    <>
      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.own.engagement', 'Views and engagement')}>
          <SourceTag sources={[INSTAGRAM]} at={at} />
        </BlockHeader>
        <IgTiles
          board={board}
          keys={[
            { key: 'views', label: translate('boards.own.views', 'Post views in range') },
            { key: 'likes', label: translate('boards.own.likes', 'Likes') },
            { key: 'comments', label: translate('boards.own.comments', 'Comments') },
            { key: 'shares', label: translate('boards.own.shares', 'Shares') },
            { key: 'saved', label: translate('boards.own.saved', 'Saves') }
          ]}
        />
      </section>
      <section data-testid="own-by-format" className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.own.byFormat', 'Views by content type')}>
          <SourceTag sources={[INSTAGRAM]} at={at} />
        </BlockHeader>
        {board.viewsByFormat.map((f) => (
          <div
            key={f.format}
            data-testid="own-format-row"
            data-format={f.format}
            className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3 text-sm"
          >
            <span>{f.format}</span>
            <Bar value={valueOf(f.views)} max={formatMax} scale="linear" />
            <span data-num className="text-right font-mono text-xs tabular-nums">
              {valueOf(f.views) === null ? '—' : formatCount(valueOf(f.views) ?? 0)}
            </span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.own.profile', 'Profile activity')}>
          <SourceTag sources={[INSTAGRAM]} at={at} />
        </BlockHeader>
        <IgTiles
          board={board}
          keys={[
            {
              key: 'profileVisits',
              label: translate('boards.own.profileVisits', 'Profile visits')
            },
            { key: 'bioLinkTaps', label: translate('boards.own.bioLinkTaps', 'Bio link taps') },
            { key: 'followsFromPost', label: translate('boards.own.follows', 'Follows from posts') }
          ]}
        />
      </section>
    </>
  )
}

export function AudiencePanel({ board }: { board: OwnBoardData }): React.ReactNode {
  const { audience } = board
  return (
    <section className="flex flex-col gap-3">
      <BlockHeader title={translate('boards.own.audienceTitle', 'Audience')}>
        <SourceTag
          sources={[INSTAGRAM]}
          at={audience.audienceAt ?? audience.followerSplitAt ?? null}
        />
        <span className="font-mono text-2xs text-muted-foreground">
          {translate(
            'boards.own.audienceNote',
            'Audience numbers are account-wide, not per range.'
          )}
        </span>
      </BlockHeader>
      {audience.followerSplitError || audience.audienceError ? (
        <p data-testid="own-audience-error" className="text-sm text-muted-foreground">
          {[audience.followerSplitError, audience.audienceError].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-x-10 gap-y-6">
        <BreakdownBars
          testId="own-follower-split"
          title={translate('boards.own.followerSplit', 'Views from followers and non-followers')}
          rows={audience.followerSplit}
        />
        <BreakdownBars
          testId="own-audience-gender"
          title={translate('boards.own.gender', 'Gender')}
          rows={audience.audience.gender}
        />
        <BreakdownBars
          testId="own-audience-age"
          title={translate('boards.own.age', 'Age')}
          rows={audience.audience.age}
        />
        <BreakdownBars
          testId="own-audience-country"
          title={translate('boards.own.country', 'Country')}
          rows={audience.audience.country}
        />
      </div>
    </section>
  )
}
