import React, { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useWorktreeMap } from '@/store/selectors'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import {
  formatCount,
  formatRate,
  ReadingSource,
  ReadingValue,
  SourceLabel,
  stepLabel
} from './funnel-reading'
import { useBoardLoad } from './use-board-load'
import { STATE_LABELS } from './VaultBoard'

type TodayBoardData = EngineCallValue<'getTodayBoard'>
export type RunningWorkspace = { id: string; name: string; working: number; waiting: number }

const APP_SOURCE = 'Lead Studio'

const loadToday = () =>
  window.api.crowsnest
    .call('getTodayBoard')
    .then((result) => (result.ok ? { ok: true as const, value: [result.value] } : result))

/** Workspaces with an agent that is working, blocked or waiting, read from the app's live agent status. */
export function runningWorkspaces(
  statuses: Record<string, AgentStatusEntry>,
  tabsByWorktree: Record<string, TerminalTab[]>,
  nameOf: (worktreeId: string) => string | undefined
): RunningWorkspace[] {
  const worktreeOfTab = new Map(
    Object.values(tabsByWorktree)
      .flat()
      .map((tab) => [tab.id, tab.worktreeId])
  )
  const byId = new Map<string, RunningWorkspace>()
  for (const entry of Object.values(statuses)) {
    if (entry.state === 'done') {
      continue
    }
    const id = entry.worktreeId ?? worktreeOfTab.get(entry.paneKey.split(':')[0])
    if (!id) {
      continue
    }
    const row = byId.get(id) ?? { id, name: nameOf(id) ?? id, working: 0, waiting: 0 }
    if (entry.state === 'working') {
      row.working += 1
    } else {
      row.waiting += 1
    }
    byId.set(id, row)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function Block({
  testId,
  title,
  source,
  children
}: {
  testId: string
  title: string
  source: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <section data-testid={testId} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {source}
      </div>
      {children}
    </section>
  )
}

function DropLine({ drop, at }: { drop: TodayBoardData['drop']; at: string }): React.ReactNode {
  if (drop.status === 'value') {
    return (
      <p data-testid="today-drop" data-status="value" className="text-sm">
        {translate(
          'boards.today.drop',
          'Rơi nhiều nhất so với chuẩn: {{label}} {{rate}} (chuẩn {{target}}).',
          { label: drop.label, rate: formatRate(drop.rate), target: formatRate(drop.target) }
        )}{' '}
        <SourceLabel source={translate('boards.today.ledger', 'sổ chỉ số')} at={drop.capturedAt} />
      </p>
    )
  }
  return (
    <p data-testid="today-drop" data-status={drop.status} className="text-sm text-muted-foreground">
      {drop.status === 'no-target'
        ? translate(
            'boards.today.noTarget',
            'Chưa đặt chuẩn cho bước nào, nên chưa biết bước nào rơi nhiều nhất.'
          )
        : translate('boards.today.noRates', 'Chưa có tỉ lệ nào để so với chuẩn.')}{' '}
      <SourceLabel source={translate('boards.today.ledger', 'sổ chỉ số')} at={at} />
    </p>
  )
}

function WorkspacesBlock(): React.ReactNode {
  const statuses = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const worktrees = useWorktreeMap()
  const rows = useMemo(
    () => runningWorkspaces(statuses, tabsByWorktree, (id) => worktrees.get(id)?.displayName),
    [statuses, tabsByWorktree, worktrees]
  )
  return (
    <Block
      testId="today-workspaces"
      title={translate('boards.today.workspaces', 'Workspace đang chạy')}
      source={
        <SourceLabel source={`${APP_SOURCE} · ${translate('boards.today.live', 'trực tiếp')}`} />
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('boards.today.noWorkspaces', 'Không có agent nào đang chạy.')}
        </p>
      ) : (
        <ul className="scrollbar-sleek flex min-h-0 flex-col overflow-auto">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="today-workspace-row"
              className="flex items-center gap-3 border-b border-border py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {translate('boards.today.agentCounts', '{{working}} chạy · {{waiting}} chờ', {
                  working: row.working,
                  waiting: row.waiting
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

function TodayView({ board, reload }: { board: TodayBoardData; reload: () => void }) {
  const [checkout, purchase] = board.offer
  return (
    <div className="flex h-full flex-col gap-6 overflow-hidden p-4">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">{translate('boards.today.title', 'Hôm nay')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.today.subtitle',
              'Số tới offer, việc chờ anh duyệt, và những gì đã chạy đêm qua.'
            )}
          </p>
        </div>
        <SourceLabel source={APP_SOURCE} at={board.at} />
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

      <section
        data-testid="today-offer"
        className="flex flex-col gap-4 border-b border-border pb-6"
      >
        <span className="font-mono text-2xs text-muted-foreground">
          {translate('boards.today.offer', 'Người tới offer')}
        </span>
        <div className="flex items-end gap-10">
          {[checkout, purchase].map((step) => (
            <div
              key={step.id}
              data-testid="today-offer-step"
              data-step-id={step.id}
              className="flex flex-col gap-1"
            >
              <span className="text-3xl">
                <ReadingValue reading={step.total} format={formatCount} />
              </span>
              <span className="text-sm">{stepLabel(step)}</span>
              <ReadingSource step={step} reading={step.total} />
            </div>
          ))}
          <div className="ml-auto grid grid-cols-6 gap-x-6 gap-y-1">
            {board.steps.map((step) => (
              <div
                key={step.id}
                data-testid="today-step"
                data-step-id={step.id}
                className="flex flex-col gap-0.5"
              >
                <span className="font-mono text-2xs text-muted-foreground">{stepLabel(step)}</span>
                <span className="text-sm">
                  <ReadingValue reading={step.total} format={formatCount} />
                </span>
                <ReadingSource step={step} reading={step.total} />
              </div>
            ))}
          </div>
        </div>
        <DropLine drop={board.drop} at={board.at} />
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-8">
        <Block
          testId="today-gates"
          title={translate('boards.today.gates', 'Chờ anh duyệt')}
          source={<SourceLabel source={APP_SOURCE} at={board.at} />}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>{translate('boards.today.gate1', 'Cổng 1 · kế hoạch đề xuất')}</dt>
            <dd
              data-testid="today-gate-plans"
              data-num
              className="text-right font-mono tabular-nums"
            >
              {formatCount(board.gates.plans)}
            </dd>
            <dt>{translate('boards.today.gate2', 'Cổng 2 · bản nháp chờ gửi')}</dt>
            <dd
              data-testid="today-gate-drafts"
              data-num
              className="text-right font-mono tabular-nums"
            >
              {formatCount(board.gates.drafts)}
            </dd>
          </dl>
        </Block>

        <Block
          testId="today-pulls"
          title={translate('boards.today.lastNight', 'Đêm qua đã chạy')}
          source={<SourceLabel source={translate('boards.today.pullSource', 'lần kéo 05:00')} />}
        >
          <ul className="scrollbar-sleek flex min-h-0 flex-col overflow-auto">
            {board.pulls.map((pull) => (
              <li
                key={pull.id}
                data-testid="today-pull-row"
                data-connector-id={pull.id}
                data-state={pull.state}
                className="flex flex-col gap-0.5 border-b border-border py-1.5"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{pull.label}</span>
                  <Badge
                    variant={pull.state === 'error' ? 'destructive' : 'outline'}
                    className={cn('font-mono', pull.state === 'running' && 'text-status-success')}
                  >
                    {STATE_LABELS[pull.state]()}
                  </Badge>
                </span>
                <SourceLabel source={pull.label} at={pull.lastPull?.at} />
                {pull.lastPull?.detail ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {pull.lastPull.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>

        <WorkspacesBlock />
      </div>
    </div>
  )
}

export function TodayBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadToday)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate('boards.today.empty', 'Chưa có gì cho hôm nay.')}
    >
      {([board]) => <TodayView board={board} reload={retry} />}
    </BoardStates>
  )
}
