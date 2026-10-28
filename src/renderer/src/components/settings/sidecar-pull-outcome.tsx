import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { formatClock } from '../board/board-time'
import {
  Actions,
  Dim,
  LimitWindow,
  later,
  Num,
  restOf,
  Warn,
  type Health,
  type SourceRow
} from './sidecar-card-view'
import { formatElapsed, SourcePullSummary } from './source-pull-progress'

export type PullOutcomeView = 'done' | 'stopped' | 'partial' | 'limited' | 'off-mid'

const rivals = (): string => translate('leadStudio.sources.sidecar.rivals', 'rivals')
const pullRestLabel = (count: number): string =>
  translate('leadStudio.sources.sidecar.pullRest', 'Pull the rest ({{count}})', { count })

/** How the last rival pull ended: the summary, or Partial after a stop, a limit, a failed rival or a lost sidecar. */
export function SidecarPullOutcome(props: {
  view: PullOutcomeView
  row: SourceRow
  health: Health | null
  onPull: (rest?: true) => Promise<void>
  onTurnOn: () => Promise<boolean>
  onOpenRivals: () => void
  testButton: React.ReactNode
}): React.ReactNode {
  const { row, health } = props
  const pull = row.summary.pull
  const updated = pull?.updated ?? 0
  const rest = restOf(pull)
  const at = (
    <Num>
      {updated}/{pull?.total ?? 0}
    </Num>
  )
  const pullRest = (disabled = false, label = pullRestLabel(rest)): React.ReactNode => (
    <Button
      data-testid="sidecar-pull-rest"
      size="sm"
      disabled={disabled}
      onClick={() => void props.onPull(true)}
    >
      {label}
    </Button>
  )

  switch (props.view) {
    case 'done':
      return (
        <>
          {pull && row.pulledAt ? (
            <SourcePullSummary
              headline={
                <>
                  {translate('leadStudio.sources.sidecar.pulled', 'Pulled')} {at} {rivals()}{' '}
                  {translate('leadStudio.sources.sidecar.at', 'at')}{' '}
                  <Num>{formatClock(row.pulledAt)}</Num>{' '}
                  {translate('leadStudio.sources.sidecar.in', 'in')}{' '}
                  <Num>{formatElapsed(pull.durationSec)}</Num>.
                </>
              }
              cells={[
                {
                  label: translate('leadStudio.sources.sidecar.rivalsUpdated', 'Rivals updated'),
                  value: pull.updated
                },
                {
                  label: translate('leadStudio.sources.sidecar.newReels', 'New reels found'),
                  value: pull.newItems
                },
                {
                  label: translate('leadStudio.sources.sidecar.failed', 'Failed'),
                  value: pull.failed
                }
              ]}
            />
          ) : null}
          <Actions>
            <Button data-testid="sidecar-open-rivals" size="sm" onClick={props.onOpenRivals}>
              {translate('leadStudio.sources.sidecar.openRivals', 'Open Rivals board')}
            </Button>
            <Button
              data-testid="sidecar-pull"
              variant="outline"
              size="sm"
              onClick={() => void props.onPull()}
            >
              {translate('leadStudio.sources.sidecar.pull', 'Pull rivals')}
            </Button>
            {props.testButton}
          </Actions>
        </>
      )
    case 'stopped':
      return (
        <>
          <Warn testId="sidecar-line">
            {translate('leadStudio.sources.sidecar.youStopped', 'You stopped the pull at')} {at}.
          </Warn>
          <Dim testId="sidecar-rest-line">
            {pull?.olderFrom
              ? translate(
                  'leadStudio.sources.sidecar.restKeepFrom',
                  '{{done}} rivals have new numbers. The other {{rest}} keep their numbers from {{time}}.',
                  {
                    done: updated,
                    rest,
                    time: formatClock(pull.olderFrom)
                  }
                )
              : translate(
                  'leadStudio.sources.sidecar.restKeep',
                  '{{done}} rivals have new numbers. The other {{rest}} keep their numbers.',
                  { done: updated, rest }
                )}
          </Dim>
          <Actions>
            {pullRest()}
            <Button
              data-testid="sidecar-pull"
              variant="outline"
              size="sm"
              onClick={() => void props.onPull()}
            >
              {translate('leadStudio.sources.sidecar.pullAll', 'Pull all again')}
            </Button>
          </Actions>
        </>
      )
    case 'partial': {
      const failed =
        pull?.items.filter((item) => item.result === 'failed').map((item) => item.label) ?? []
      return (
        <>
          <Warn testId="sidecar-line">
            {translate('leadStudio.sources.sidecar.partialAt', 'The pull finished with')} {at}{' '}
            {translate('leadStudio.sources.sidecar.partialUpdated', 'rivals updated.')}
          </Warn>
          <Dim testId="sidecar-rest-line">
            {failed.length
              ? translate(
                  'leadStudio.sources.sidecar.partialFailed',
                  'These failed and keep their older numbers: {{handles}}.',
                  { handles: failed.join(', ') }
                )
              : (row.detail ?? row.message)}
          </Dim>
          <Actions>{pullRest()}</Actions>
        </>
      )
    }
    case 'limited': {
      const waiting = later(row.retryAfter)
      const after = row.retryAfter ? formatClock(row.retryAfter) : null
      return (
        <>
          <Warn testId="sidecar-line">
            {translate(
              'leadStudio.sources.sidecar.limited',
              'Instagram is limiting requests. The pull stopped at'
            )}{' '}
            {at}.
          </Warn>
          <Dim testId="sidecar-rest-line">
            {translate(
              'leadStudio.sources.sidecar.limitedRest',
              '{{done}} rivals have new numbers. The other {{rest}} keep their older numbers.',
              { done: updated, rest }
            )}
            {after ? (
              <>
                {' '}
                {translate('leadStudio.sources.sidecar.pullRestAfter', 'Pull the rest after')}{' '}
                <Num>{after}</Num>.
              </>
            ) : null}
          </Dim>
          {pull ? <LimitWindow pull={pull} /> : null}
          <Actions>
            {pullRest(
              waiting,
              waiting && after
                ? translate(
                    'leadStudio.sources.sidecar.pullRestWait',
                    'Pull the rest ({{count}}) · after {{time}}',
                    { count: rest, time: after }
                  )
                : pullRestLabel(rest)
            )}
          </Actions>
        </>
      )
    }
    case 'off-mid':
      return (
        <>
          <Warn testId="sidecar-line">
            {pull?.stop === 'source-down'
              ? translate(
                  'leadStudio.sources.sidecar.diedAt',
                  'The sidecar stopped during the pull, at'
                )
              : translate(
                  'leadStudio.sources.sidecar.interruptedAt',
                  'The pull stopped before it finished, at'
                )}{' '}
            {at}.
          </Warn>
          <Dim testId="sidecar-rest-line">
            {health?.running
              ? translate(
                  'leadStudio.sources.sidecar.pullRestNow',
                  '{{done}} rivals have new numbers. Pull the rest when you are ready.',
                  { done: updated }
                )
              : translate(
                  'leadStudio.sources.sidecar.turnOnRest',
                  '{{done}} rivals have new numbers. Turn the sidecar on, then pull the rest.',
                  { done: updated }
                )}
          </Dim>
          <Actions>
            <Button
              data-testid="sidecar-pull-rest"
              size="sm"
              onClick={async () => {
                if (!health?.running && !(await props.onTurnOn())) {
                  return
                }
                await props.onPull(true)
              }}
            >
              {health?.running
                ? pullRestLabel(rest)
                : translate(
                    'leadStudio.sources.sidecar.turnOnPullRest',
                    'Turn on and pull the rest ({{count}})',
                    { count: rest }
                  )}
            </Button>
          </Actions>
        </>
      )
  }
}
