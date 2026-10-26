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
  KeywordGap,
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

export function runningWorkspaces(
  statuses: Record<string, Pick<AgentStatusEntry, 'paneKey' | 'state' | 'worktreeId'>>,
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id' | 'worktreeId'>[]>,
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
  const message =
    drop.status === 'value'
      ? translate('boards.today.drop', '{{label}} {{rate}}, target {{target}}.', {
          label: drop.label,
          rate: formatRate(drop.rate),
          target: formatRate(drop.target)
        })
      : drop.status === 'no-target'
        ? translate(
            'boards.today.noTarget',
            'No step has a target yet, so the biggest drop is unknown.'
          )
        : translate('boards.today.noRates', 'No rates to compare with a target yet.')
  return (
    <div
      data-testid="today-drop"
      data-status={drop.status}
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-border px-4 py-3"
    >
      <span className="font-mono text-2xs text-muted-foreground">
        {translate('boards.today.dropTitle', 'Biggest drop against target')}
      </span>
      <p className="text-base font-medium">{message}</p>
      <SourceLabel
        source={translate('boards.today.ledger', 'metrics ledger')}
        at={drop.status === 'value' ? drop.capturedAt : at}
      />
    </div>
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
      title={translate('boards.today.workspaces', 'Running workspaces')}
      source={<SourceLabel source={`${APP_SOURCE} · ${translate('boards.today.live', 'live')}`} />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('boards.today.noWorkspaces', 'No agents running.')}
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
                {translate(
                  'boards.today.agentCounts',
                  '{{working}} working · {{waiting}} waiting',
                  {
                    working: row.working,
                    waiting: row.waiting
                  }
                )}
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
          <h1 className="text-xl font-medium">{translate('boards.today.title', 'Today')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.today.subtitle',
              'Numbers to the offer, what waits for your approval, and what ran overnight.'
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
          {translate('boards.today.offer', 'People reaching the offer')}
        </span>
        <div className="flex items-start gap-10">
          {[checkout, purchase].map((step) => (
            <div
              key={step.id}
              data-testid="today-offer-step"
              data-step-id={step.id}
              className="flex flex-col gap-1"
            >
              <span className="text-3xl leading-9">
                <ReadingValue reading={step.total} format={formatCount} hero />
              </span>
              <span className="text-sm">{stepLabel(step)}</span>
              <KeywordGap total={step.total} />
              <ReadingSource step={step} reading={step.total} />
            </div>
          ))}
          <DropLine drop={board.drop} at={board.at} />
        </div>
        <div className="grid grid-cols-6 gap-x-4">
          {board.steps.map((step) => (
            <div
              key={step.id}
              data-testid="today-step"
              data-step-id={step.id}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <span className="truncate font-mono text-2xs text-muted-foreground">
                {stepLabel(step)}
              </span>
              <span className="text-sm">
                <ReadingValue reading={step.total} format={formatCount} vaultLink={false} />
              </span>
              <KeywordGap total={step.total} />
              <ReadingSource step={step} reading={step.total} />
            </div>
          ))}
        </div>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-8">
        <Block
          testId="today-gates"
          title={translate('boards.today.gates', 'Waiting for your approval')}
          source={<SourceLabel source={APP_SOURCE} at={board.at} />}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>{translate('boards.today.gate1', 'Gate 1 · proposed plan')}</dt>
            <dd
              data-testid="today-gate-plans"
              data-num
              className="text-right font-mono tabular-nums"
            >
              {formatCount(board.gates.proposedPlansAhead)}
            </dd>
            <dt>{translate('boards.today.gate2', 'Gate 2 · drafts to send')}</dt>
            <dd
              data-testid="today-gate-drafts"
              data-num
              className="text-right font-mono tabular-nums"
            >
              {formatCount(board.gates.pendingDrafts)}
            </dd>
          </dl>
        </Block>

        <Block
          testId="today-pulls"
          title={translate('boards.today.lastNight', 'Ran overnight')}
          source={<SourceLabel source={translate('boards.today.pullSource', '05:00 pull')} />}
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
                <SourceLabel
                  source={
                    pull.lastPull
                      ? translate('boards.today.pulledAt', 'last pull')
                      : translate('boards.today.neverPulled', 'never pulled')
                  }
                  at={pull.lastPull?.at}
                />
                {pull.state === 'error' || pull.state === 'partial' ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {pull.lastPull?.detail}
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
      emptyMessage={translate('boards.today.empty', 'Nothing for today yet.')}
    >
      {([board]) => <TodayView board={board} reload={retry} />}
    </BoardStates>
  )
}
