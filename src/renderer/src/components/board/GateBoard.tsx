import React, { Suspense, useMemo, useState } from 'react'
import { Check, Minus, Plus, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { DiffViewer } from '../editor/editor-lazy-views'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { useBoardLoad } from './use-board-load'

type GateBoardData = EngineCallValue<'getGateBoard'>
type Proposal = NonNullable<GateBoardData['proposal']>
type Change = Proposal['changes'][number]
type Reel = Change['after'] & {}

const rowsUnlessEmpty = (board: GateBoardData): GateBoardData[] =>
  board.proposal || board.lastApproval ? [board] : []

const loadGate = () =>
  window.api.crowsnest
    .call('getGateBoard')
    .then((result) =>
      result.ok ? { ok: true as const, value: rowsUnlessEmpty(result.value) } : result
    )

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'numeric',
  day: 'numeric'
})
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

const reelDay = (reel: Reel): string =>
  reel.date
    ? dayFormat.format(new Date(`${reel.date}T12:00:00`))
    : translate('gate.noDate', 'no date')

const reelLine = (reel: Reel): string =>
  [
    reelDay(reel),
    reel.time,
    reel.title,
    reel.keyword ? translate('gate.key', 'key {{keyword}}', { keyword: reel.keyword }) : null
  ]
    .filter(Boolean)
    .join(' · ')

const reelOrder = (a: Reel, b: Reel): number =>
  (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
  (a.time ?? '').localeCompare(b.time ?? '') ||
  a.key.localeCompare(b.key)

/** The live plan with only the kept changes applied, in plan order (as the server applies them). */
function applyChanges(live: Reel[], kept: Change[]): Reel[] {
  const reels = new Map(live.map((r) => [r.key, r]))
  for (const change of kept) {
    if (change.after) {
      reels.set(change.key, change.after)
    } else {
      reels.delete(change.key)
    }
  }
  return [...reels.values()].sort(reelOrder)
}

function periodName(period: Proposal['period'], key: string): string {
  if (period === 'week') {
    return translate('gate.week', 'week {{week}}', { week: Number(key.slice(6)) })
  }
  return monthFormat.format(new Date(`${key}-01T12:00:00`))
}

const KIND: Record<Change['kind'], { icon: React.ReactNode; tone: string; label: () => string }> = {
  remove: {
    icon: <Minus className="size-3" />,
    tone: 'text-destructive border-destructive/30 bg-destructive/10',
    label: () => translate('gate.kind.remove', 'Remove')
  },
  edit: {
    icon: <span className="text-2xs leading-none font-semibold">~</span>,
    tone: 'text-status-warning border-status-warning-border bg-status-warning-background',
    label: () => translate('gate.kind.edit', 'Edit')
  },
  add: {
    icon: <Plus className="size-3" />,
    tone: 'text-status-success border-status-success-border bg-status-success-background',
    label: () => translate('gate.kind.add', 'Add')
  }
}

function ChangeRow({
  change,
  on,
  onToggle
}: {
  change: Change
  on: boolean
  onToggle: (on: boolean) => void
}): React.ReactNode {
  const reel = change.after ?? change.before
  if (!reel) {
    return null
  }
  const kind = KIND[change.kind]
  return (
    <label
      data-testid="gate-change"
      data-change-key={change.key}
      data-kind={change.kind}
      className="flex cursor-pointer items-center gap-3 px-3 py-2"
    >
      <span
        aria-label={kind.label()}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-md border',
          kind.tone
        )}
      >
        {kind.icon}
      </span>
      <span className="w-24 shrink-0 font-mono text-2xs text-muted-foreground">
        {reelDay(reel)}
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', !on && 'text-muted-foreground')}>
        <span className={cn(change.kind === 'remove' && 'line-through')}>{reel.title}</span>
        {reel.keyword ? (
          <span className="text-muted-foreground">
            {' · '}
            {translate('gate.key', 'key {{keyword}}', { keyword: reel.keyword })}
          </span>
        ) : null}
        {reel.note ? (
          <span data-testid="gate-reason" className="text-muted-foreground">
            {' · '}
            {reel.note}
          </span>
        ) : null}
      </span>
      <Switch data-testid="gate-change-switch" checked={on} onCheckedChange={onToggle} />
    </label>
  )
}

function PlanDiff({ proposal, kept }: { proposal: Proposal; kept: Change[] }): React.ReactNode {
  const live = useMemo(
    () => [...(proposal.live?.reels ?? [])].sort(reelOrder),
    [proposal.live?.reels]
  )
  const next = useMemo(() => applyChanges(live, kept), [live, kept])
  const edited = useMemo(
    () => new Set(kept.filter((c) => c.kind === 'edit').map((c) => c.key)),
    [kept]
  )
  const markedLines = useMemo(
    () => ({
      original: live.flatMap((r, i) => (edited.has(r.key) ? [i + 1] : [])),
      modified: next.flatMap((r, i) => (edited.has(r.key) ? [i + 1] : [])),
      className: 'lead-diff-modified-line'
    }),
    [live, next, edited]
  )
  const file = `plan-${proposal.periodKey}.md`
  return (
    <div
      data-testid="gate-diff"
      className="flex h-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border"
    >
      <Suspense fallback={null}>
        <DiffViewer
          modelKey={`gate:${proposal.next.id}`}
          originalContent={live.map(reelLine).join('\n')}
          modifiedContent={next.map(reelLine).join('\n')}
          language="plaintext"
          filePath={file}
          relativePath={file}
          sideBySide
          markedLines={markedLines}
        />
      </Suspense>
    </div>
  )
}

function ProposalView({
  proposal,
  reload
}: {
  proposal: Proposal
  reload: () => void
}): React.ReactNode {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kept = useMemo(
    () => proposal.changes.filter((c) => !off.has(c.key)),
    [proposal.changes, off]
  )
  const count = (kind: Change['kind']): number => kept.filter((c) => c.kind === kind).length
  const { next, live } = proposal

  const approve = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.api.crowsnest.call(
      'approvePlanChanges',
      next.id,
      kept.map((c) => c.key)
    )
    setBusy(false)
    const message = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    if (message) {
      setError(message)
      return
    }
    reload()
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-medium">
            {translate('gate.title', 'Gate 1 · {{period}} plan', {
              period: periodName(proposal.period, proposal.periodKey)
            })}
          </h1>
          <span data-testid="gate-counts" className="font-mono text-2xs text-muted-foreground">
            +{count('add')} −{count('remove')} ~{count('edit')}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {translate(
            'gate.subtitle',
            'Switch off any change you do not want. The diff and the count follow the switches.'
          )}
        </p>
      </header>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {proposal.changes.map((change) => (
          <ChangeRow
            key={change.key}
            change={change}
            on={!off.has(change.key)}
            onToggle={(on) =>
              setOff((current) => {
                const nextOff = new Set(current)
                if (on) {
                  nextOff.delete(change.key)
                } else {
                  nextOff.add(change.key)
                }
                return nextOff
              })
            }
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-2xs text-muted-foreground">
        <span data-testid="gate-live-version">
          {live
            ? translate('gate.liveVersion', 'v{{version}} · live · approved {{time}} by {{who}}', {
                version: live.version,
                time: live.approvedAt ? formatBoardTime(live.approvedAt) : '-',
                who: live.approvedBy ?? '-'
              })
            : translate('gate.noLive', 'no live plan yet')}
        </span>
        <span data-testid="gate-next-version">
          {translate('gate.nextVersion', 'v{{version}} · proposed by {{agent}} · {{time}}', {
            version: next.version,
            agent: next.agent,
            time: formatBoardTime(next.createdAt)
          })}
        </span>
      </div>

      <PlanDiff proposal={proposal} kept={kept} />

      <div className="flex items-center justify-end gap-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button
          data-testid="gate-approve"
          size="sm"
          disabled={kept.length === 0 || busy}
          onClick={() => void approve()}
        >
          {kept.length === proposal.changes.length
            ? translate('gate.approve', 'Approve plan v{{version}} ({{count}} changes)', {
                version: next.version,
                count: kept.length
              })
            : translate(
                'gate.approveSome',
                'Approve {{count}} of {{total}} changes as a new version',
                {
                  count: kept.length,
                  total: proposal.changes.length
                }
              )}
        </Button>
      </div>
    </>
  )
}

function ApprovedView({
  approval,
  reload
}: {
  approval: NonNullable<GateBoardData['lastApproval']>
  reload: () => void
}): React.ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const undo = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.api.crowsnest.call(
      'undoPlanApproval',
      { period: approval.period, periodKey: approval.periodKey },
      approval.live.id
    )
    setBusy(false)
    const message = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    if (message) {
      setError(message)
      return
    }
    reload()
  }
  return (
    <div data-testid="gate-approved" className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-medium">
        {translate('gate.titleNone', 'Gate 1 · nothing waits for approval')}
      </h1>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-status-success">
          <Check />
          {translate('gate.liveNow', '{{period}} plan v{{version}} is live', {
            period: periodName(approval.period, approval.periodKey),
            version: approval.live.version
          })}
        </Badge>
        <span className="font-mono text-2xs text-muted-foreground">
          {translate('gate.approvedBy', 'approved {{time}} by {{who}}', {
            time: approval.live.approvedAt ? formatBoardTime(approval.live.approvedAt) : '-',
            who: approval.live.approvedBy ?? '-'
          })}
        </span>
        {approval.canUndo ? (
          <Button
            data-testid="gate-undo"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void undo()}
          >
            <Undo2 />
            {translate('gate.undo', 'Undo')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function GateView({ board, reload }: { board: GateBoardData; reload: () => void }) {
  return (
    <div
      data-testid="gate-board"
      className="scrollbar-sleek mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-auto px-6 py-5"
    >
      {board.proposal ? (
        <ProposalView key={board.proposal.next.id} proposal={board.proposal} reload={reload} />
      ) : board.lastApproval ? (
        <ApprovedView approval={board.lastApproval} reload={reload} />
      ) : null}
    </div>
  )
}

export function GateBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadGate)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate(
        'gate.empty',
        'No plan waits for approval. Agents propose plans with crowsnest_propose_plan.'
      )}
    >
      {([board]) => <GateView board={board} reload={retry} />}
    </BoardStates>
  )
}
