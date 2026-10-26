import React, { useCallback, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatCount, formatRate, ReadingValue, SourceLabel } from './funnel-reading'
import { AFTER_COLUMNS, capturedAt, columnLabel, INSTAGRAM, Stat, TotalValue } from './own-reading'
import { OwnContentTable } from './OwnContentTable'
import { OwnReelDetail } from './OwnReelDetail'
import { useBoardLoad } from './use-board-load'

type OwnBoardData = EngineCallValue<'getOwnBoard'>
type Days = 7 | 30
type Breakdown = OwnBoardData['audience']['followerSplit']

const signed = (value: number): string =>
  value > 0 ? `+${formatCount(value)}` : formatCount(value)

const isEmpty = (board: OwnBoardData): boolean =>
  board.username === null && board.posts.length === 0 && board.followers.status !== 'value'

function BreakdownList({
  testId,
  title,
  rows
}: {
  testId: string
  title: string
  rows: Breakdown
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <span className="font-mono text-xs text-muted-foreground">
          {translate('boards.funnel.missing', 'no data yet')}
        </span>
      ) : (
        rows.slice(0, 6).map((r) => (
          <div key={r.key} className="flex items-center gap-3 text-sm">
            <span className="w-28 truncate">{r.key}</span>
            <span className="h-1.5 flex-1 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-chart-2"
                style={{ width: `${(100 * r.value) / total}%` }}
              />
            </span>
            <span data-num className="w-14 text-right font-mono text-xs">
              {formatRate(r.value / total)}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function OwnView({
  board,
  days,
  setDays,
  tab,
  setTab,
  reload,
  onOpen
}: {
  board: OwnBoardData
  days: Days
  setDays: (days: Days) => void
  tab: string
  setTab: (tab: string) => void
  reload: () => void
  onOpen: (id: string) => void
}) {
  const { totals, after, audience } = board
  const ig = (key: keyof typeof totals, label: string) => (
    <Stat testId={`own-stat-${key}`} label={label} source={INSTAGRAM} at={capturedAt(totals[key])}>
      <TotalValue total={totals[key]} />
    </Stat>
  )
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-5 overflow-auto p-4">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">
            {translate('boards.own.title', 'My channel')}
            {board.username ? (
              <span className="ml-2 text-muted-foreground">@{board.username}</span>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.own.subtitle',
              'Laid out like the Instagram dashboard, plus what Instagram lacks: which reel drives DMs, site visits and orders.'
            )}
          </p>
        </div>
        <div className="flex gap-1">
          {([7, 30] as const).map((d) => (
            <Button
              key={d}
              data-testid={`own-days-${d}`}
              variant={days === d ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setDays(d)}
            >
              {translate('boards.own.days', '{{count}} days', { count: d })}
            </Button>
          ))}
        </div>
        <Button
          data-testid="board-refresh"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('boards.refresh', 'Refresh')}
          onClick={reload}
        >
          <RefreshCw />
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line">
          <TabsTrigger data-testid="own-tab-home" value="home">
            {translate('boards.own.tab.home', 'Overview')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-tab-perf" value="perf">
            {translate('boards.own.tab.perf', 'Performance')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-tab-content" value="content">
            {translate('boards.own.tab.content', 'Content')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-tab-aud" value="aud">
            {translate('boards.own.tab.aud', 'Audience')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="home" data-testid="own-panel-home" className="flex flex-col gap-6 pt-3">
          <div className="grid grid-cols-3 gap-6">
            {ig('views', translate('boards.own.views', 'Post views in range'))}
            <Stat
              testId="own-stat-followers"
              label={translate('boards.own.followers', 'Followers')}
              source={INSTAGRAM}
              at={capturedAt(board.followers)}
            >
              <ReadingValue reading={board.followers} format={formatCount} hero />
            </Stat>
            <Stat
              testId="own-stat-net"
              label={translate('boards.own.net', 'Net follows')}
              source={INSTAGRAM}
              at={capturedAt(board.netFollowers)}
            >
              <ReadingValue reading={board.netFollowers} format={signed} hero />
            </Stat>
          </div>
          <section
            data-testid="own-after-totals"
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-medium">
                {translate('boards.own.afterTitle', 'After Instagram · Lead Studio')}
              </h2>
              <Button variant="link" size="xs" onClick={() => openBoardInActiveWorkspace('funnel')}>
                {translate('boards.own.openFunnel', 'Open Funnel')}
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-6">
              {AFTER_COLUMNS.map((c) => (
                <Stat
                  key={c.key}
                  testId={`own-total-${c.key}`}
                  label={columnLabel(c.key)}
                  source={c.source}
                  at={capturedAt(after[c.key])}
                >
                  <TotalValue total={after[c.key]} />
                </Stat>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="perf" data-testid="own-panel-perf" className="flex flex-col gap-6 pt-3">
          <div className="grid grid-cols-3 gap-6">
            {ig('views', translate('boards.own.views', 'Post views in range'))}
            {ig('likes', translate('boards.own.likes', 'Likes'))}
            {ig('comments', translate('boards.own.comments', 'Comments'))}
            {ig('shares', translate('boards.own.shares', 'Shares'))}
            {ig('saved', translate('boards.own.saved', 'Saves'))}
          </div>
          <section data-testid="own-by-format" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {translate('boards.own.byFormat', 'Views by content type')}
            </h2>
            {board.viewsByFormat.map((f) => (
              <div key={f.format} className="flex items-baseline gap-3 text-sm">
                <span className="w-28">{f.format}</span>
                <TotalValue total={f.views} />
              </div>
            ))}
            <SourceLabel source={INSTAGRAM} at={capturedAt(totals.views)} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {translate('boards.own.profile', 'Profile activity')}
            </h2>
            <div className="grid grid-cols-3 gap-6">
              {ig('profileVisits', translate('boards.own.profileVisits', 'Profile visits'))}
              {ig('bioLinkTaps', translate('boards.own.bioLinkTaps', 'Bio link taps'))}
              {ig('followsFromPost', translate('boards.own.follows', 'Follows from posts'))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="content" data-testid="own-panel-content" className="pt-3">
          <OwnContentTable board={board} onOpen={onOpen} />
        </TabsContent>

        <TabsContent value="aud" data-testid="own-panel-aud" className="flex flex-col gap-6 pt-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xs text-muted-foreground">
              {translate(
                'boards.own.audienceNote',
                'Audience numbers are account-wide, not per range.'
              )}
            </span>
            <SourceLabel
              source={INSTAGRAM}
              at={audience.audienceAt ?? audience.followerSplitAt ?? undefined}
            />
          </div>
          {audience.followerSplitError || audience.audienceError ? (
            <p data-testid="own-audience-error" className="text-sm text-muted-foreground">
              {[audience.followerSplitError, audience.audienceError].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-8">
            <BreakdownList
              testId="own-follower-split"
              title={translate(
                'boards.own.followerSplit',
                'Views from followers and non-followers'
              )}
              rows={audience.followerSplit}
            />
            <BreakdownList
              testId="own-audience-gender"
              title={translate('boards.own.gender', 'Gender')}
              rows={audience.audience.gender}
            />
            <BreakdownList
              testId="own-audience-age"
              title={translate('boards.own.age', 'Age')}
              rows={audience.audience.age}
            />
            <BreakdownList
              testId="own-audience-country"
              title={translate('boards.own.country', 'Country')}
              rows={audience.audience.country}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function OwnBoard(): React.ReactNode {
  const [days, setDays] = useState<Days>(30)
  const [tab, setTab] = useState('home')
  const [reel, setReel] = useState<string | null>(null)
  const load = useCallback(
    () =>
      window.api.crowsnest
        .call('getOwnBoard', days)
        .then((result) =>
          result.ok
            ? { ok: true as const, value: isEmpty(result.value) ? [] : [result.value] }
            : result
        ),
    [days]
  )
  const { state, retry } = useBoardLoad(load)
  if (reel) {
    return <OwnReelDetail ownPostId={reel} onBack={() => setReel(null)} />
  }
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate(
        'boards.own.empty',
        'Instagram has never been measured. Connect Instagram in Sources; the app measures at 05:00.'
      )}
    >
      {([board]) => (
        <OwnView
          board={board}
          days={days}
          setDays={setDays}
          tab={tab}
          setTab={setTab}
          reload={retry}
          onOpen={setReel}
        />
      )}
    </BoardStates>
  )
}
