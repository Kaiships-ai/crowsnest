import React, { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { useAppStore } from '@/store'
import { useWorktreeMap } from '@/store/selectors'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { formatCount, formatRate, sourceName, StepsSourceTag, stepLabel } from './funnel-reading'
import { kpiFromStep, KpiTile } from './kit/Kpi'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import { StatePill } from './kit/StatePill'
import { useBoardLoad } from './use-board-load'

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
    <section data-testid={testId} className="flex min-h-0 min-w-0 flex-col gap-3">
      <BlockHeader title={title}>{source}</BlockHeader>
      {children}
    </section>
  )
}

function DropLine({ drop }: { drop: TodayBoardData['drop'] }): React.ReactNode {
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
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <span className="text-xs text-muted-foreground">
        {translate('boards.today.dropTitle', 'Biggest drop against target')}
      </span>
      <p className="text-sm font-medium">{message}</p>
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
      source={<SourceTag sources={[APP_SOURCE]} live />}
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
                  { working: row.working, waiting: row.waiting }
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

function StepTiles({
  steps,
  testId,
  className
}: {
  steps: TodayBoardData['steps']
  testId: string
  className: string
}): React.ReactNode {
  return (
    <div className={className}>
      {steps.map((step) => (
        <KpiTile
          key={step.id}
          testId={testId}
          stepId={step.id}
          label={stepLabel(step)}
          data={kpiFromStep(step, sourceName(step.source))}
          format={formatCount}
        />
      ))}
    </div>
  )
}

function TodayView({ board, reload }: { board: TodayBoardData; reload: () => void }) {
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-8 overflow-auto px-6 py-5">
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

      <Block
        testId="today-offer"
        title={translate('boards.today.offer', 'People reaching the offer')}
        source={<StepsSourceTag steps={board.offer} />}
      >
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
          <StepTiles steps={board.offer} testId="today-offer-step" className="contents" />
          <DropLine drop={board.drop} />
        </div>
      </Block>

      <Block
        testId="today-funnel"
        title={translate('boards.today.funnel', 'Funnel')}
        source={<StepsSourceTag steps={board.steps} />}
      >
        <StepTiles steps={board.steps} testId="today-step" className="grid grid-cols-6 gap-3" />
      </Block>

      <div className="grid min-h-0 grid-cols-3 gap-8">
        <Block
          testId="today-gates"
          title={translate('boards.today.gates', 'Waiting for your approval')}
          source={<SourceTag sources={[APP_SOURCE]} live />}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>
              <Button
                data-testid="today-open-gate"
                variant="link"
                size="xs"
                className="h-auto px-0 text-sm font-normal text-foreground"
                onClick={() => openBoardInActiveWorkspace('gate')}
              >
                {translate('boards.today.gate1', 'Gate 1 · proposed plan')}
              </Button>
            </dt>
            <dd
              data-testid="today-gate-plans"
              data-num
              className="text-right font-mono tabular-nums"
            >
              {formatCount(board.gates.proposedPlansAhead)}
            </dd>
            <dt>
              <Button
                data-testid="today-open-gate2"
                variant="link"
                size="xs"
                className="h-auto px-0 text-sm font-normal text-foreground"
                onClick={() => openBoardInActiveWorkspace('gate2')}
              >
                {translate('boards.today.gate2', 'Gate 2 · drafts to send')}
              </Button>
            </dt>
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
          title={translate('boards.today.lastPulls', 'Last pulls')}
          source={
            <SourceTag sources={[translate('boards.today.pullSource', 'Settings > Sources')]} />
          }
        >
          <ul className="flex flex-col">
            {board.pulls.map((pull) => (
              <li
                key={pull.id}
                data-testid="today-pull-row"
                data-connector-id={pull.id}
                data-state={pull.state}
                className="flex items-center gap-2 border-b border-border py-1.5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{pull.label}</span>
                  <span className="font-mono text-2xs text-muted-foreground">
                    {pull.pulledAt
                      ? `${translate('boards.today.pulledAt', 'last pull')} ${formatBoardTime(pull.pulledAt)}`
                      : translate('boards.today.neverPulled', 'never pulled')}
                  </span>
                </span>
                <StatePill state={pull.state} />
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
