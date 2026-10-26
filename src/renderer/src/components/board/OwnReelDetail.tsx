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
  ReadingSource,
  ReadingValue,
  SourceLabel,
  stepLabel
} from './funnel-reading'
import { openPostInBrowser } from './open-post'
import { capturedAt, INSTAGRAM, Stat, type OwnPostCard } from './own-reading'
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
    <Stat
      testId={`own-reel-${field}`}
      label={label}
      source={INSTAGRAM}
      at={capturedAt(post.ig[field])}
    >
      <ReadingValue reading={post.ig[field]} format={format} hero />
    </Stat>
  )
}

function ViewsHistory({ history }: { history: ReelBoard['history'] }): React.ReactNode {
  if (history.length < 2) {
    return (
      <p data-testid="own-reel-history" className="text-sm text-muted-foreground">
        {translate('boards.own.historyThin', 'Cần ít nhất 2 lần đo để vẽ đường lượt xem.')}
      </p>
    )
  }
  const [first] = history
  const last = history.at(-1) ?? first
  const max = Math.max(...history.map((h) => h.views), 1)
  const points = history
    .map((h, i) => `${(100 * i) / (history.length - 1)},${40 - (40 * h.views) / max}`)
    .join(' ')
  return (
    <div data-testid="own-reel-history" className="flex flex-col gap-1">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full text-chart-2">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between font-mono text-2xs text-muted-foreground">
        <span>{formatBoardTime(first.capturedAt)}</span>
        <span>{formatBoardTime(last.capturedAt)}</span>
      </div>
    </div>
  )
}

function AfterReel({ reel }: { reel: ReelBoard }): React.ReactNode {
  if (!reel.after) {
    return (
      <p data-testid="own-after-none" className="text-sm text-muted-foreground">
        {translate(
          'boards.own.afterNone',
          'Reel này không có keyword, nên chưa nối được tới DM, web và đơn. Gắn keyword cho reel trong Kế hoạch.'
        )}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {translate(
          'boards.own.afterIntro',
          'Phần này Instagram không có. Lead Studio nối keyword {{keyword}} qua ChatbotX, Umami và Polar.',
          { keyword: reel.after.keyword }
        )}
      </p>
      <div className="grid grid-cols-[1fr_auto_auto] content-start gap-x-6">
        <div className="col-span-full grid grid-cols-subgrid border-b border-border py-1 font-mono text-2xs text-muted-foreground">
          <span>{translate('boards.funnel.step.column', 'Bước')}</span>
          <span className="text-right">{translate('boards.funnel.count', 'Số')}</span>
          <span className="text-right">{translate('boards.funnel.rate', 'Từ bước trước')}</span>
        </div>
        {reel.after.steps.map((step) => (
          <div
            key={step.id}
            data-testid="own-after-step"
            data-step-id={step.id}
            data-status={step.total.status}
            className="col-span-full grid grid-cols-subgrid items-center border-b border-border py-2 text-sm"
          >
            <span className="flex flex-col">
              <span>{stepLabel(step)}</span>
              <ReadingSource step={step} reading={step.total} />
            </span>
            <span className="text-right">
              <ReadingValue reading={step.total} format={formatCount} />
            </span>
            <span className="text-right text-xs">
              {step.rate ? (
                <ReadingValue reading={step.rate.reading} format={formatRate} vaultLink={false} />
              ) : (
                '-'
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
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
      {translate('boards.own.back', 'Mọi nội dung')}
    </Button>
  )
}

function ReelView({ reel, onBack }: { reel: ReelBoard; onBack: () => void }): React.ReactNode {
  const { post } = reel
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-5 overflow-auto p-4">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <BackButton onBack={onBack} />
          <h1 className="truncate text-xl font-medium">
            {post.caption?.split('\n')[0] || post.format}
          </h1>
          <SourceLabel source={`${post.format} · ${formatBoardTime(post.postedAt)}`} />
        </div>
        <Button
          data-testid="own-reel-open"
          variant="outline"
          size="xs"
          onClick={() => openPostInBrowser(post.permalink)}
        >
          <ExternalLink />
          {translate('boards.own.openPost', 'Mở bài gốc')}
        </Button>
      </header>
      {post.insightsError ? (
        <p data-testid="own-reel-error" className="text-sm text-destructive">
          {post.insightsError}
        </p>
      ) : null}
      <Tabs defaultValue="ov">
        <TabsList variant="line">
          <TabsTrigger data-testid="own-reel-tab-ov" value="ov">
            {translate('boards.own.tab.home', 'Tổng quan')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-reel-tab-eng" value="eng">
            {translate('boards.own.tab.eng', 'Tương tác')}
          </TabsTrigger>
          <TabsTrigger data-testid="own-reel-tab-after" value="after">
            {translate('boards.own.tab.after', 'Sau reel')}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="ov"
          data-testid="own-reel-panel-ov"
          className="flex flex-col gap-6 pt-3"
        >
          <div className="grid grid-cols-3 gap-6">
            <IgStat post={post} field="views" label={translate('boards.own.views1', 'Lượt xem')} />
            <IgStat post={post} field="reach" label={translate('boards.own.reach', 'Tiếp cận')} />
            <IgStat
              post={post}
              field="avgWatchTimeMs"
              label={translate('boards.own.avgWatch', 'Xem trung bình')}
              format={seconds}
            />
            <IgStat
              post={post}
              field="skipRate"
              label={translate('boards.own.skipRate', 'Tỉ lệ lướt qua')}
              format={percent}
            />
            <IgStat
              post={post}
              field="followsFromPost"
              label={translate('boards.own.follows', 'Follow từ bài')}
            />
            <Stat
              testId="own-reel-index"
              label={translate('boards.own.reachIndex', 'Tiếp cận so với trung vị kênh')}
              source={INSTAGRAM}
              at={capturedAt(post.ig.reach)}
            >
              {post.reachIndex === null ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {translate('boards.funnel.missing', 'chưa có số')}
                </span>
              ) : (
                <span data-num className="font-mono tabular-nums">
                  {formatCount(post.reachIndex)}×
                </span>
              )}
            </Stat>
          </div>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {translate('boards.own.history', 'Lượt xem qua các lần đo')}
            </h2>
            <ViewsHistory history={reel.history} />
          </section>
        </TabsContent>
        <TabsContent value="eng" data-testid="own-reel-panel-eng" className="pt-3">
          <div className="grid grid-cols-3 gap-6">
            <IgStat post={post} field="likes" label={translate('boards.own.likes', 'Thích')} />
            <IgStat
              post={post}
              field="comments"
              label={translate('boards.own.comments', 'Comment')}
            />
            <IgStat post={post} field="shares" label={translate('boards.own.shares', 'Chia sẻ')} />
            <IgStat post={post} field="saved" label={translate('boards.own.saved', 'Lưu')} />
            <IgStat
              post={post}
              field="reposts"
              label={translate('boards.own.reposts', 'Đăng lại')}
            />
            <IgStat
              post={post}
              field="bioLinkTaps"
              label={translate('boards.own.bioLinkTaps', 'Bấm link bio')}
            />
          </div>
        </TabsContent>
        <TabsContent value="after" data-testid="own-reel-panel-after" className="pt-3">
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
