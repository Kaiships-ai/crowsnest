import React, { useCallback, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { OwnContentTable } from './OwnContentTable'
import { AudiencePanel, OverviewPanel, PerformancePanel } from './OwnPanels'
import { OwnReelDetail } from './OwnReelDetail'
import { useBoardLoad } from './use-board-load'

type OwnBoardData = EngineCallValue<'getOwnBoard'>
type Days = 7 | 30

const isEmpty = (board: OwnBoardData): boolean =>
  board.username === null && board.posts.length === 0 && board.followers.status !== 'value'

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
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-5 overflow-auto px-6 py-5">
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
        <TabsContent value="home" data-testid="own-panel-home" className="flex flex-col gap-6 pt-4">
          <OverviewPanel board={board} />
        </TabsContent>
        <TabsContent value="perf" data-testid="own-panel-perf" className="flex flex-col gap-6 pt-4">
          <PerformancePanel board={board} />
        </TabsContent>
        <TabsContent value="content" data-testid="own-panel-content" className="pt-4">
          <OwnContentTable board={board} onOpen={onOpen} />
        </TabsContent>
        <TabsContent value="aud" data-testid="own-panel-aud" className="pt-4">
          <AudiencePanel board={board} />
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
        'Instagram has never been measured. Connect Instagram in Sources, then press Pull.'
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
