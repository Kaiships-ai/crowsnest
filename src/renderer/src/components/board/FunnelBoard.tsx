import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import {
  formatCount,
  formatRate,
  KeywordGap,
  ReadingSource,
  ReadingValue,
  sourceName,
  stepLabel
} from './funnel-reading'
import { useBoardLoad } from './use-board-load'

type FunnelBoardData = EngineCallValue<'getFunnelBoard'>
type Coverage = FunnelBoardData['coverage']['visits']

const rowsUnlessNoKeyword = (board: FunnelBoardData): FunnelBoardData[] =>
  board.keywords.length > 0 ? [board] : []

const loadFunnel = () =>
  window.api.crowsnest
    .call('getFunnelBoard')
    .then((result) =>
      result.ok ? { ok: true as const, value: rowsUnlessNoKeyword(result.value) } : result
    )

function CoverageLine({
  testId,
  label,
  coverage
}: {
  testId: string
  label: string
  coverage: Coverage
}): React.ReactNode {
  return (
    <div data-testid={testId} data-status={coverage.status} className="flex flex-col gap-1">
      <span className="font-mono text-2xs text-muted-foreground">{label}</span>
      {coverage.status === 'value' ? (
        <span data-num className="font-mono text-lg tabular-nums">
          {formatCount(coverage.tied)} / {formatCount(coverage.total)}
        </span>
      ) : (
        <ReadingValue reading={coverage} format={formatCount} />
      )}
    </div>
  )
}

function FunnelView({ board, reload }: { board: FunnelBoardData; reload: () => void }) {
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-6 overflow-auto py-4">
      <header className="flex items-start gap-3 px-4">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">{translate('boards.funnel.title', 'Phễu')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.funnel.subtitle',
              '6 bước từ người xem tới người mua. Mỗi số ghi nguồn và giờ lấy.'
            )}
          </p>
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

      <section className="grid grid-cols-[1fr_auto_auto_auto] content-start gap-x-6">
        <div className="col-span-full grid grid-cols-subgrid border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground">
          <span>{translate('boards.funnel.step.column', 'Bước')}</span>
          <span className="text-right">{translate('boards.funnel.count', 'Số')}</span>
          <span className="text-right">{translate('boards.funnel.rate', 'Từ bước trước')}</span>
          <span className="text-right">{translate('boards.funnel.target', 'Chuẩn')}</span>
        </div>
        {board.steps.map((step) => (
          <div
            key={step.id}
            data-testid="funnel-step"
            data-step-id={step.id}
            data-status={step.total.status}
            className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-2 text-sm"
          >
            <span className="flex flex-col">
              <span>{stepLabel(step)}</span>
              <ReadingSource step={step} reading={step.total} />
            </span>
            <span className="flex flex-col items-end">
              <ReadingValue reading={step.total} format={formatCount} />
              <KeywordGap total={step.total} />
            </span>
            <span data-testid="funnel-rate" className="text-right">
              {step.rate ? (
                <ReadingValue reading={step.rate.reading} format={formatRate} vaultLink={false} />
              ) : (
                '-'
              )}
            </span>
            <span className="text-right font-mono text-xs text-muted-foreground">
              {step.rate
                ? step.rate.target === null
                  ? translate('boards.funnel.noTarget', 'chưa đặt chuẩn')
                  : formatRate(step.rate.target)
                : ''}
            </span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-medium">
          {translate('boards.funnel.byKeyword', 'Theo keyword')}
        </h2>
        <div className="grid grid-cols-[auto_1fr_repeat(6,auto)] content-start gap-x-6">
          <div className="col-span-full grid grid-cols-subgrid border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground">
            <span>{translate('boards.funnel.keyword', 'Keyword')}</span>
            <span>{translate('boards.funnel.reel', 'Reel')}</span>
            {board.steps.map((step) => (
              <span key={step.id} className="text-right">
                {stepLabel(step)}
                <br />
                {sourceName(step.source)}
              </span>
            ))}
          </div>
          {board.keywords.map((row) => (
            <div
              key={row.keyword}
              data-testid="funnel-keyword-row"
              data-keyword={row.keyword}
              className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-1.5 text-sm"
            >
              <span className="font-mono text-xs">{row.keyword}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {row.plan?.title ?? translate('boards.funnel.noReel', 'không có reel')}
              </span>
              {row.steps.map((reading, i) => (
                <span key={board.steps[i].id} className="text-right text-xs">
                  {reading.status === 'value' ? (
                    <ReadingValue reading={reading} format={formatCount} />
                  ) : (
                    <span className="font-mono text-muted-foreground">
                      {reading.status === 'not-connected'
                        ? translate('boards.funnel.notConnected', 'chưa nối')
                        : '-'}
                    </span>
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 px-4">
        <h2 className="text-sm font-medium">
          {translate('boards.funnel.coverage', 'Nối được tới đâu')}
        </h2>
        <div className="flex gap-12">
          <CoverageLine
            testId="funnel-coverage-visits"
            label={translate('boards.funnel.coverageVisits', 'Lượt vào trang quà biết reel')}
            coverage={board.coverage.visits}
          />
          <CoverageLine
            testId="funnel-coverage-orders"
            label={translate('boards.funnel.coverageOrders', 'Đơn biết reel')}
            coverage={board.coverage.orders}
          />
        </div>
      </section>
    </div>
  )
}

export function FunnelBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadFunnel)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate(
        'boards.funnel.empty',
        'Chưa có số phễu nào. Agent ghi số theo keyword bằng crowsnest_save_funnel.'
      )}
    >
      {([board]) => <FunnelView board={board} reload={retry} />}
    </BoardStates>
  )
}
