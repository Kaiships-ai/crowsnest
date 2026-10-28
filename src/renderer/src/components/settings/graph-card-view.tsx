import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatClock } from '../board/board-time'
import type { IntegrationCardStatusTone } from './integration-card-shell'
import { Actions, Dim, later, Num, restOf, Warn, type SourceRow } from './sidecar-card-view'
import { formatElapsed, SourcePullSummary } from './source-pull-progress'

export const GRAPH_CALLS_PER_HOUR = 200
export const TOKEN_HELP = 'https://developers.facebook.com/docs/instagram-platform'

/** What the Graph card shows: one state per prototype frame. */
export type View =
  | 'not-connected'
  | 'form'
  | 'testing'
  | 'ready'
  | 'pulling'
  | 'done'
  | 'stopped'
  | 'limited'
  | 'partial'
  | 'error'

const ready = {
  label: () => translate('boards.kit.state.ready', 'Ready'),
  tone: 'connected' as const
}
const partial = {
  label: () => translate('boards.kit.state.partial', 'Partial'),
  tone: 'attention' as const
}
export const PILL: Record<
  View,
  { label: () => string; tone: IntegrationCardStatusTone; busy?: true }
> = {
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
  ready,
  pulling: {
    label: () => translate('boards.kit.state.pulling', 'Pulling'),
    tone: 'neutral',
    busy: true
  },
  done: ready,
  stopped: partial,
  limited: partial,
  partial,
  error: { label: () => translate('boards.kit.state.error', 'Error'), tone: 'attention' }
}

export function viewOf(row: SourceRow, local: { testing: boolean; form: boolean }): View {
  const pull = row.summary.pull
  if (row.state === 'pulling') {
    return 'pulling'
  }
  if (local.testing) {
    return 'testing'
  }
  if (local.form) {
    return 'form'
  }
  if (row.state === 'not-connected') {
    return 'not-connected'
  }
  if (row.state === 'error') {
    return 'error'
  }
  if (row.state === 'partial') {
    return pull?.stop === 'stopped' ? 'stopped' : pull?.stop === 'limited' ? 'limited' : 'partial'
  }
  const pulledLast =
    row.pulledAt !== null && (row.checkedAt === null || row.pulledAt > row.checkedAt)
  return pull && pulledLast ? 'done' : 'ready'
}

export const posts = (): string => translate('leadStudio.sources.graph.posts', 'posts')
export const callsLeft = (row: SourceRow): string =>
  `${row.graphCallsLeft ?? GRAPH_CALLS_PER_HOUR}/${GRAPH_CALLS_PER_HOUR}`

/** How the last Graph pull ended: the summary, or Partial after a stop, the hour's calls running out, or failed posts. */
export function GraphPullOutcome(props: {
  view: 'done' | 'stopped' | 'limited' | 'partial'
  row: SourceRow
  onPull: (rest: boolean) => Promise<void>
  onOpenOwn: () => void
  pullButton: React.ReactNode
  testButton: React.ReactNode
}): React.ReactNode {
  const { row } = props
  const pull = row.summary.pull
  const updated = pull?.updated ?? 0
  const total = pull?.total ?? 0
  const rest = restOf(pull)
  const pullRest = (disabled: boolean, label: string): React.ReactNode => (
    <Button
      data-testid="graph-pull-rest"
      size="sm"
      disabled={disabled}
      onClick={() => void props.onPull(true)}
    >
      {label}
    </Button>
  )
  const pullRestLabel = translate(
    'leadStudio.sources.sidecar.pullRest',
    'Pull the rest ({{count}})',
    {
      count: rest
    }
  )
  switch (props.view) {
    case 'done':
      return (
        <>
          {pull && row.pulledAt ? (
            <SourcePullSummary
              headline={
                <>
                  {translate('leadStudio.sources.sidecar.pulled', 'Pulled')}{' '}
                  <Num>
                    {updated}/{total} {posts()}
                  </Num>{' '}
                  {translate('leadStudio.sources.sidecar.at', 'at')}{' '}
                  <Num>{formatClock(row.pulledAt)}</Num>{' '}
                  {translate('leadStudio.sources.sidecar.in', 'in')}{' '}
                  <Num>{formatElapsed(pull.durationSec)}</Num>.
                </>
              }
              cells={[
                {
                  label: translate('leadStudio.sources.graph.postsMeasured', 'Posts measured'),
                  value: pull.updated
                },
                {
                  label: translate('leadStudio.sources.graph.followers', 'Followers'),
                  value: pull.followers ? (
                    <>
                      {pull.followers.count.toLocaleString('en-US')}
                      {pull.followers.delta !== null ? (
                        <span className="text-2xs text-muted-foreground">
                          {' '}
                          {pull.followers.delta >= 0 ? '+' : ''}
                          {pull.followers.delta.toLocaleString('en-US')}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '?'
                  )
                },
                {
                  label: translate(
                    'leadStudio.sources.graph.callsLeftCell',
                    'Calls left this hour'
                  ),
                  value: callsLeft(row)
                }
              ]}
            />
          ) : null}
          <Actions>
            <Button data-testid="graph-open-own" size="sm" onClick={props.onOpenOwn}>
              {translate('leadStudio.sources.graph.openOwn', 'Open My channel board')}
            </Button>
            {props.pullButton}
            {props.testButton}
          </Actions>
        </>
      )
    case 'stopped':
      return (
        <>
          <Warn testId="graph-line">
            {translate('leadStudio.sources.sidecar.youStopped', 'You stopped the pull at')}{' '}
            <Num>
              {updated}/{total}
            </Num>{' '}
            {posts()}.
          </Warn>
          <Dim testId="graph-rest-line">
            {translate(
              'leadStudio.sources.graph.restKeep',
              '{{done}} posts have new numbers. The other {{rest}} keep their older numbers.',
              { done: updated, rest }
            )}
          </Dim>
          <Actions>{pullRest(false, pullRestLabel)}</Actions>
        </>
      )
    case 'limited': {
      const waiting = later(row.retryAfter)
      const after = row.retryAfter ? formatClock(row.retryAfter) : null
      return (
        <>
          <Warn testId="graph-line">
            {translate('leadStudio.sources.sidecar.pulled', 'Pulled')}{' '}
            <Num>
              {updated}/{total}
            </Num>{' '}
            {translate(
              'leadStudio.sources.graph.usedUp',
              'posts. The {{limit}} calls for this hour are used up.',
              { limit: GRAPH_CALLS_PER_HOUR }
            )}
          </Warn>
          <Dim testId="graph-rest-line">
            {translate(
              'leadStudio.sources.graph.limitedRest',
              'The other {{rest}} posts keep their older numbers.',
              { rest }
            )}
            {after ? (
              <>
                {' '}
                {translate('leadStudio.sources.sidecar.pullRestAfter', 'Pull the rest after')}{' '}
                <Num>{after}</Num>.
              </>
            ) : null}
          </Dim>
          <Actions>
            {pullRest(
              waiting,
              waiting && after
                ? translate(
                    'leadStudio.sources.sidecar.pullRestWait',
                    'Pull the rest ({{count}}) · after {{time}}',
                    { count: rest, time: after }
                  )
                : pullRestLabel
            )}
          </Actions>
        </>
      )
    }
    case 'partial':
      // A pull the app quit mid-way never finished, so it reads as stopped, not as finished with failures.
      return pull?.stop === 'interrupted' ? (
        <>
          <Warn testId="graph-line">
            {translate(
              'leadStudio.sources.sidecar.interruptedAt',
              'The pull stopped before it finished, at'
            )}{' '}
            <Num>
              {updated}/{total}
            </Num>
            .
          </Warn>
          <Dim testId="graph-rest-line">
            {translate(
              'leadStudio.sources.graph.limitedRest',
              'The other {{rest}} posts keep their older numbers.',
              { rest }
            )}
          </Dim>
          <Actions>{pullRest(false, pullRestLabel)}</Actions>
        </>
      ) : (
        <>
          <Warn testId="graph-line">
            {translate('leadStudio.sources.sidecar.partialAt', 'The pull finished with')}{' '}
            <Num>
              {updated}/{total}
            </Num>{' '}
            {translate('leadStudio.sources.graph.partialMeasured', 'posts measured.')}
          </Warn>
          <Dim testId="graph-rest-line">{row.detail ?? row.message}</Dim>
          <Actions>{pullRest(false, pullRestLabel)}</Actions>
        </>
      )
  }
}
