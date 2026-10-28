import React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
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
import { DataTable, type DataColumn } from './kit/DataTable'
import { kpiFromStep, KpiValue } from './kit/Kpi'
import { BlockHeader } from './kit/SourceTag'
import { useOnFunnelChanged } from '@/lib/funnel-changed'
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

type KeywordRow = FunnelBoardData['keywords'][number]

function keywordColumns(board: FunnelBoardData): DataColumn<KeywordRow>[] {
  return [
    {
      id: 'keyword',
      header: translate('boards.funnel.keyword', 'Keyword'),
      cell: (row) => <span className="font-mono text-xs">{row.keyword}</span>
    },
    {
      id: 'reel',
      header: translate('boards.funnel.reel', 'Reel'),
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.plan?.title ?? translate('boards.funnel.noReel', 'no reel')}
        </span>
      )
    },
    ...board.steps.map((step, i): DataColumn<KeywordRow> => ({
      id: step.id,
      align: 'end',
      header: stepLabel(step),
      cell: (row) => {
        const reading = row.steps[i]
        return reading.status === 'value' ? (
          <span data-num className="font-mono text-xs tabular-nums">
            {formatCount(reading.value)}
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {reading.status === 'not-connected'
              ? translate('boards.funnel.notConnected', 'not connected')
              : '—'}
          </span>
        )
      }
    }))
  ]
}

function FunnelView({ board, reload }: { board: FunnelBoardData; reload: () => void }) {
  const max = Math.max(
    0,
    ...board.steps.map((step) => (step.total.status === 'value' ? step.total.value : 0))
  )
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-8 overflow-auto px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">{translate('boards.funnel.title', 'Funnel')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.funnel.subtitle',
              '6 steps from viewer to buyer. Every number names its source and pull time.'
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

      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.funnel.steps', 'Steps')}>
          <StepsSourceTag steps={board.steps} />
        </BlockHeader>
        <div className="grid grid-cols-[10rem_1fr_8rem_8rem_6rem] items-center gap-x-6">
          <div className="col-span-full grid grid-cols-subgrid border-b border-border py-1 font-mono text-2xs text-muted-foreground">
            <span>{translate('boards.funnel.step.column', 'Step')}</span>
            <span />
            <span className="text-right">{translate('boards.funnel.count', 'Count')}</span>
            <span className="text-right">
              {translate('boards.funnel.rate', 'From previous step')}
            </span>
            <span className="text-right">{translate('boards.funnel.target', 'Target')}</span>
          </div>
          {board.steps.map((step) => {
            const data = kpiFromStep(step, sourceName(step.source))
            return (
              <div
                key={step.id}
                data-testid="funnel-step"
                data-step-id={step.id}
                data-status={step.total.status}
                className="col-span-full grid grid-cols-subgrid items-center border-b border-border py-2.5 text-sm"
              >
                <span>{stepLabel(step)}</span>
                <Bar value={data.value} max={max} muted={data.state.kind !== 'value'} />
                <KpiValue data={data} format={formatCount} size="sm" align="end" />
                <span data-testid="funnel-rate" className="self-start text-right font-mono text-xs">
                  {step.rate ? (
                    <ReadingValue
                      reading={step.rate.reading}
                      format={formatRate}
                      vaultLink={false}
                    />
                  ) : (
                    ''
                  )}
                </span>
                <span className="self-start text-right font-mono text-xs text-muted-foreground">
                  {step.rate
                    ? step.rate.target === null
                      ? translate('boards.funnel.noTarget', 'no target set')
                      : formatRate(step.rate.target)
                    : ''}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.funnel.byKeyword', 'By keyword')}>
          <StepsSourceTag steps={board.steps} />
        </BlockHeader>
        <DataTable
          testId="funnel-keywords"
          rowTestId="funnel-keyword-row"
          columns={keywordColumns(board)}
          rows={board.keywords}
          rowKey={(row) => row.keyword}
        />
      </section>

      <section className="flex flex-col gap-3">
        <BlockHeader title={translate('boards.funnel.coverage', 'How far we can link')} />
        <div className="flex gap-12">
          <CoverageLine
            testId="funnel-coverage-visits"
            label={translate('boards.funnel.coverageVisits', 'Gift page visits with a known reel')}
            coverage={board.coverage.visits}
          />
          <CoverageLine
            testId="funnel-coverage-orders"
            label={translate('boards.funnel.coverageOrders', 'Orders with a known reel')}
            coverage={board.coverage.orders}
          />
        </div>
      </section>
    </div>
  )
}

export function FunnelBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadFunnel)
  useOnFunnelChanged(retry)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate(
        'boards.funnel.empty',
        'No funnel numbers yet. Agents record numbers per keyword with crowsnest_save_funnel.'
      )}
    >
      {([board]) => <FunnelView board={board} reload={retry} />}
    </BoardStates>
  )
}
