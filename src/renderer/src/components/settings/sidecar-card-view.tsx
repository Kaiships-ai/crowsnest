import React from 'react'
import { translate } from '@/i18n/i18n'
import { formatClock } from '../board/board-time'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import type { IntegrationCardStatusTone } from './integration-card-shell'

export type SourceRow = EngineCallValue<'getVaultBoard'>[number]
export type PullSummary = NonNullable<SourceRow['summary']['pull']>
export type Health = { running: boolean; loggedIn: boolean; username: string | null }

/** What the sidecar card shows: one state per prototype frame. */
export type View =
  | 'off'
  | 'starting'
  | 'not-connected'
  | 'form'
  | 'testing'
  | 'ready'
  | 'pulling'
  | 'done'
  | 'stopped'
  | 'partial'
  | 'limited'
  | 'limited-test'
  | 'error'
  | 'off-mid'

export const PILL: Record<
  View,
  { label: () => string; tone: IntegrationCardStatusTone; busy?: true }
> = {
  off: { label: () => translate('boards.kit.state.off', 'Off'), tone: 'neutral' },
  starting: {
    label: () => translate('leadStudio.sources.sidecar.starting', 'Starting'),
    tone: 'neutral',
    busy: true
  },
  'not-connected': {
    label: () => translate('leadStudio.sources.sidecar.notConnected', 'Not connected'),
    tone: 'attention'
  },
  form: {
    label: () => translate('leadStudio.sources.sidecar.notConnected', 'Not connected'),
    tone: 'attention'
  },
  testing: {
    label: () => translate('boards.kit.state.checking', 'Testing'),
    tone: 'neutral',
    busy: true
  },
  ready: { label: () => translate('boards.kit.state.ready', 'Ready'), tone: 'connected' },
  pulling: {
    label: () => translate('boards.kit.state.pulling', 'Pulling'),
    tone: 'neutral',
    busy: true
  },
  done: { label: () => translate('boards.kit.state.ready', 'Ready'), tone: 'connected' },
  stopped: { label: () => translate('boards.kit.state.partial', 'Partial'), tone: 'attention' },
  partial: { label: () => translate('boards.kit.state.partial', 'Partial'), tone: 'attention' },
  limited: { label: () => translate('boards.kit.state.partial', 'Partial'), tone: 'attention' },
  'limited-test': { label: () => translate('boards.kit.state.error', 'Error'), tone: 'attention' },
  error: { label: () => translate('boards.kit.state.error', 'Error'), tone: 'attention' },
  'off-mid': { label: () => translate('boards.kit.state.partial', 'Partial'), tone: 'attention' }
}

export const later = (iso: string | null): boolean => iso !== null && Date.parse(iso) > Date.now()

export function viewOf(
  row: SourceRow,
  health: Health | null,
  local: { starting: boolean; testing: boolean; form: boolean }
): View {
  const pull = row.summary.pull
  if (local.starting) {
    return 'starting'
  }
  if (row.state === 'pulling') {
    return 'pulling'
  }
  if (local.testing) {
    return 'testing'
  }
  if (local.form) {
    return 'form'
  }
  if (row.state === 'partial' && (pull?.stop === 'source-down' || pull?.stop === 'interrupted')) {
    return 'off-mid'
  }
  if (row.state === 'off' || health?.running === false) {
    return 'off'
  }
  if (row.state === 'error') {
    return later(row.retryAfter) ? 'limited-test' : 'error'
  }
  if (health?.loggedIn === false) {
    return 'not-connected'
  }
  if (row.state === 'partial') {
    return pull?.stop === 'limited' ? 'limited' : pull?.stop === 'stopped' ? 'stopped' : 'partial'
  }
  const pulledLast =
    row.pulledAt !== null && (row.checkedAt === null || row.pulledAt > row.checkedAt)
  return pull && pulledLast ? 'done' : 'ready'
}

export const Num = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <span className="font-mono tabular-nums">{children}</span>
)

export function restOf(pull: PullSummary | undefined): number {
  return pull ? Math.max(0, pull.total - pull.updated) : 0
}

/** Minutes back to the pull's start: "pull the rest" skips rivals that pull updated. */
export function sinceStartMinutes(pull: PullSummary | undefined): number | undefined {
  return pull?.startedAt
    ? Math.max(1, Math.ceil((Date.now() - Date.parse(pull.startedAt)) / 60_000))
    : undefined
}

/** The rival that hit the limit, with one row either side. */
export function LimitWindow({ pull }: { pull: PullSummary }): React.ReactNode {
  const at = pull.items.findIndex((item) => item.result === 'limited')
  if (at === -1) {
    return null
  }
  const words: Record<PullSummary['items'][number]['result'], [string, string, string]> = {
    updated: [
      '✓',
      'text-status-success',
      translate('leadStudio.sources.sidecar.itemUpdated', 'updated')
    ],
    limited: [
      '!',
      'text-destructive',
      translate('leadStudio.sources.sidecar.itemLimited', 'limited by Instagram')
    ],
    failed: ['!', 'text-destructive', translate('leadStudio.sources.sidecar.itemFailed', 'failed')],
    'not-pulled': [
      '·',
      'text-muted-foreground',
      translate('leadStudio.sources.sidecar.itemNotPulled', 'not pulled')
    ]
  }
  return (
    <div
      data-testid="sidecar-limit-window"
      className="divide-y divide-border/60 rounded-md border border-border/60"
    >
      {pull.items.slice(Math.max(0, at - 1), at + 2).map((item) => (
        <div key={item.label} className="flex items-center gap-3 px-3 py-1.5 text-xs">
          <span
            data-testid="sidecar-limit-mark"
            className={`w-3 font-mono ${words[item.result][1]}`}
          >
            {words[item.result][0]}
          </span>
          <span className="flex-1">{item.label}</span>
          <span className="font-mono text-2xs text-muted-foreground">{words[item.result][2]}</span>
        </div>
      ))}
    </div>
  )
}

export const Actions = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
)

export const Dim = ({
  testId,
  children
}: {
  testId: string
  children: React.ReactNode
}): React.ReactNode => (
  <p data-testid={testId} className="text-xs text-muted-foreground">
    {children}
  </p>
)

export const Strong = ({
  testId,
  children
}: {
  testId: string
  children: React.ReactNode
}): React.ReactNode => (
  <p data-testid={testId} className="text-xs text-foreground">
    {children}
  </p>
)

/** The headline of a Partial card: a stop, a limit, a failed rival or a lost sidecar. */
export const Warn = ({
  testId,
  children
}: {
  testId: string
  children: React.ReactNode
}): React.ReactNode => (
  <p data-testid={testId} className="text-xs text-status-warning">
    {children}
  </p>
)

/** Ready: the last test's sample and the last rivals pull, then the card's buttons. */
export function SidecarReadyBody({
  row,
  children
}: {
  row: SourceRow
  children: React.ReactNode
}): React.ReactNode {
  const pull = row.summary.pull
  return (
    <>
      {row.summary.sample ? (
        <Strong testId="sidecar-sample">
          {translate('leadStudio.sources.sidecar.sample', 'Sample:')}{' '}
          <Num>{row.summary.sample}</Num>
          {row.checkedAt ? (
            <span className="font-mono text-2xs text-muted-foreground">
              {' '}
              {translate('leadStudio.sources.sidecar.tested', '(tested {{time}})', {
                time: formatClock(row.checkedAt)
              })}
            </span>
          ) : null}
        </Strong>
      ) : (
        <Dim testId="sidecar-sample">
          {translate(
            'leadStudio.sources.sidecar.noSample',
            'Not tested yet. Press Test connection to pull a sample.'
          )}
        </Dim>
      )}
      <Dim testId="sidecar-last-pull">
        {pull && row.pulledAt ? (
          <>
            {translate('leadStudio.sources.sidecar.lastPull', 'Last rivals pull:')}{' '}
            <Num>
              {formatClock(row.pulledAt)} · {pull.updated}/{pull.total}{' '}
              {translate('leadStudio.sources.sidecar.rivals', 'rivals')}
            </Num>
          </>
        ) : (
          translate('leadStudio.sources.neverPulled', 'Never pulled')
        )}
      </Dim>
      <Actions>{children}</Actions>
    </>
  )
}
