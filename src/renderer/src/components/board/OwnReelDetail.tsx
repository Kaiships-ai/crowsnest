import React, { useCallback } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from './board-time'
import { BoardStates } from './BoardStates'
import {
  formatCount,
  formatRate,
  ReadingValue,
  sourceName,
  StepsSourceTag,
  stepLabel
} from './funnel-reading'
import { Bar } from './kit/Bars'
import { KpiTile, KpiValue } from './kit/Kpi'
import { LineChart } from './kit/LineChart'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import { openPostInBrowser } from './open-post'
import { capturedAt, INSTAGRAM, kpiFromReading, type OwnPostCard } from './own-reading'
import { useBoardLoad } from './use-board-load'

type ReelBoard = EngineCallValue<'getOwnReelBoard'>

const seconds = (ms: number): string => `${formatCount(Math.round(ms / 100) / 10)}s`
const percent = (value: number): string => `${formatCount(Math.round(value * 10) / 10)}%`

function IgStat({
  post,
  field,
  label,
  format = formatCount
}: {
  post: OwnPostCard
  field: keyof OwnPostCard['ig']
  label: string
  format?: (value: number) => string
}): React.ReactNode {
  return (
    <KpiTile
      testId={`own-reel-${field}`}
      label={label}
      data={kpiFromReading(post.ig[field], INSTAGRAM, post.pullError !== null)}
      format={format}
    />
  )
}

function IgBlock({
  post,
  title,
  children
}: {
  post: OwnPostCard
  title: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <BlockHeader title={title}>
        <SourceTag sources={[INSTAGRAM]} at={capturedAt(post.ig.views) ?? null} />
      </BlockHeader>
      <div className="grid grid-cols-3 gap-3">{children}</div>
    </section>
  )
}

function ViewsHistory({ history }: { history: ReelBoard['history'] }): React.ReactNode {
  if (history.length < 2) {
    return (
      <p data-testid="own-reel-history" className="text-sm text-muted-foreground">
        {translate(
          'boards.own.historyThin',
          'At least 2 measurements are needed to draw the views line.'
        )}
      </p>
    )
  }
  return (
    <LineChart
      testId="own-reel-history"
      points={history.map((h) => ({ at: h.capturedAt, value: h.views }))}
      format={formatCount}
    />
  )
}

function AfterReel({ reel }: { reel: ReelBoard }): React.ReactNode {
  if (!reel.after) {
    return (
      <p data-testid="own-after-none" className="text-sm text-muted-foreground">
        {translate(
          'boards.own.afterNone',
          "This reel has no keyword, so it can't be linked to DMs, site and orders. Add a keyword to the reel in Plan."
        )}
      </p>
    )
  }
  const max = Math.max(
    0,
    ...reel.after.steps.map((step) => (step.total.status === 'value' ? step.total.value : 0))
  )
  return (
    <section className="flex flex-col gap-2">
      <BlockHeader
        title={translate('boards.own.afterReelTitle', 'After the reel · keyword {{keyword}}', {
          keyword: reel.after.keyword
        })}
      >
        <StepsSourceTag steps={reel.after.steps} />
      </BlockHeader>
      <p className="text-sm text-muted-foreground">
        {translate(
          'boards.own.afterIntro',
          "Instagram doesn't show this. Lead Studio links keyword {{keyword}} through ChatbotX, Umami and Polar.",
          { keyword: reel.after.keyword }
        )}
      </p>
      <div className="grid grid-cols-[10rem_1fr_11rem_8rem] items-center gap-x-6">
        <div className="col-span-full grid grid-cols-subgrid border-b border-border py-1 font-mono text-2xs text-muted-foreground">
          <span>{translate('boards.funnel.step.column', 'Step')}</span>
          <span />
          <span className="text-right">{translate('boards.funnel.count', 'Count')}</span>
          <span className="text-right">
            {translate('boards.funnel.rate', 'From previous step')}
          </span>
        </div>
        {reel.after.steps.map((step) => {
          const data = kpiFromReading(step.total, sourceName(step.source))
          return (
            <div
              key={step.id}
              data-testid="own-after-step"
              data-step-id={step.id}
              data-status={step.total.status}
              className="col-span-full grid grid-cols-subgrid items-center border-b border-border py-2.5 text-sm"
            >
              <span>{stepLabel(step)}</span>
              <Bar value={data.value} max={max} muted={data.state.kind !== 'value'} />
              <KpiValue data={data} format={formatCount} size="sm" align="end" />
              <span className="self-start text-right font-mono text-xs">
                {step.rate ? (
                  <ReadingValue reading={step.rate.reading} format={formatRate} vaultLink={false} />
                ) : (
                  ''
                )}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BackButton({ onBack }: { onBack: () => void }): React.ReactNode {
  return (
    <Button
      data-testid="own-reel-back"
      variant="ghost"
      size="xs"
      className="self-start"
      onClick={onBack}
    >
      <ArrowLeft />
      {translate('boards.own.back', 'All content')}
    </Button>
  )
}

function ReelView({ reel, onBack }: { reel: ReelBoard; onBack: () => void }): React.ReactNode {
  const { post } = reel
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-5 overflow-auto px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <BackButton onBack={onBack} />
          <h1 className="truncate text-xl font-medium">
            {post.caption?.split('\n')[0] || post.format}
          </h1>
          <span className="font-mono text-2xs text-muted-foreground">
            {post.format} · {formatBoardTime(post.postedAt)}
            {post.keyword ? ` · ${post.keyword}` : ''}
          </span>
        </div>
        <Button
          data-testid="own-reel-open"
          variant="outline"
          size="xs"
          onClick={() => openPostInBrowser(post.permalink)}
        >
          <ExternalLink />
          {translate('boards.own.openPost', 'Open original post')}
        </Button>
      </header>
      {post.pullError ? (
        <p data-testid="own-reel-error" className="text-sm text-destructive">
          {translate(
            'boards.own.pullFailed',
            'The {{at}} measurement failed; the numbers below are from the last good one: {{error}}',
            {
              at: formatBoardTime(post.pullError.at),
              error: post.pullError.error
            }
          )}
        </p>
      ) : null}
      <Tabs defaultValue="ov">
        <TabsList variant="line">
          <TabsTrigger data-testid="own-reel-tab-ov" value="ov">
            {translate('boards.own.tab.home', 'Overview')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-reel-tab-eng" value="eng">
            {translate('boards.own.tab.eng', 'Engagement')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-reel-tab-after" value="after">
            {translate('boards.own.tab.after', 'After the reel')}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="ov"
          data-testid="own-reel-panel-ov"
          className="flex flex-col gap-6 pt-4"
        >
          <IgBlock post={post} title={translate('boards.own.reelReach', 'Reach and watch time')}>
            <IgStat post={post} field="views" label={translate('boards.own.views1', 'Views')} />
            <IgStat post={post} field="reach" label={translate('boards.own.reach', 'Reach')} />
            <KpiTile
              testId="own-reel-index"
              label={translate('boards.own.reachIndex', 'Reach vs channel median')}
              data={{
                value: post.reachIndex,
                state: { kind: post.reachIndex === null ? 'no-data' : 'value' },
                source: INSTAGRAM
              }}
              format={(value) => `${formatCount(value)}×`}
            />
            <IgStat
              post={post}
              field="avgWatchTimeMs"
              label={translate('boards.own.avgWatch', 'Avg watch time')}
              format={seconds}
            />
            <IgStat
              post={post}
              field="skipRate"
              label={translate('boards.own.skipRate', 'Skip rate')}
              format={percent}
            />
            <IgStat
              post={post}
              field="followsFromPost"
              label={translate('boards.own.follows', 'Follows from posts')}
            />
          </IgBlock>
          <section className="flex flex-col gap-2">
            <BlockHeader title={translate('boards.own.history', 'Views across measurements')}>
              <SourceTag sources={[INSTAGRAM]} at={reel.history.at(-1)?.capturedAt ?? null} />
            </BlockHeader>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <ViewsHistory history={reel.history} />
            </div>
          </section>
        </TabsContent>
        <TabsContent value="eng" data-testid="own-reel-panel-eng" className="pt-4">
          <IgBlock post={post} title={translate('boards.own.tab.eng', 'Engagement')}>
            <IgStat post={post} field="likes" label={translate('boards.own.likes', 'Likes')} />
            <IgStat
              post={post}
              field="comments"
              label={translate('boards.own.comments', 'Comments')}
            />
            <IgStat post={post} field="shares" label={translate('boards.own.shares', 'Shares')} />
            <IgStat post={post} field="saved" label={translate('boards.own.saved', 'Saves')} />
            <IgStat
              post={post}
              field="reposts"
              label={translate('boards.own.reposts', 'Reposts')}
            />
            <IgStat
              post={post}
              field="bioLinkTaps"
              label={translate('boards.own.bioLinkTaps', 'Bio link taps')}
            />
          </IgBlock>
        </TabsContent>
        <TabsContent value="after" data-testid="own-reel-panel-after" className="pt-4">
          <AfterReel reel={reel} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function OwnReelDetail({
  ownPostId,
  onBack
}: {
  ownPostId: string
  onBack: () => void
}): React.ReactNode {
  const load = useCallback(
    () =>
      window.api.crowsnest
        .call('getOwnReelBoard', ownPostId)
        .then((result) => (result.ok ? { ok: true as const, value: [result.value] } : result)),
    [ownPostId]
  )
  const { state, retry } = useBoardLoad(load)
  if (state.status === 'ready') {
    return <ReelView reel={state.rows[0]} onBack={onBack} />
  }
  return (
    <div className="flex h-full flex-col p-4">
      <BackButton onBack={onBack} />
      <BoardStates state={state} retry={retry} emptyMessage="">
        {() => null}
      </BoardStates>
    </div>
  )
}
