import React, { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { useAppStore } from '@/store'
import { formatClock } from '../board/board-time'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { Actions, Dim, Num, PILL, Strong, Warn, type SourceRow } from './sidecar-card-view'
import { formatElapsed, SourcePullProgress, SourcePullSummary } from './source-pull-progress'
import { UmamiKeyForm, UmamiKeyHelp } from './umami-key-form'

/** What the Umami card shows: one state per prototype frame. */
type View =
  | 'not-connected'
  | 'form'
  | 'testing'
  | 'ready'
  | 'pulling'
  | 'done'
  | 'stopped'
  | 'partial'
  | 'error'
  | 'unreachable'

function viewOf(row: SourceRow, local: { testing: boolean; form: boolean }): View {
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
    return row.summary.down ? 'unreachable' : 'error'
  }
  if (row.state === 'partial') {
    return pull?.stop === 'stopped' ? 'stopped' : 'partial'
  }
  const pulledLast =
    row.pulledAt !== null && (row.checkedAt === null || row.pulledAt > row.checkedAt)
  return pull && pulledLast ? 'done' : 'ready'
}

const pages = (): string => translate('leadStudio.sources.umami.pages', 'pages')

type Totals = { visits: string; emails: string; checkouts: string }

const count = (n: number | null): string => (n === null ? '—' : new Intl.NumberFormat().format(n))

/** The funnel's Umami totals over every keyword, the same sums the Funnel board shows. */
function useFunnelTotals(active: boolean): Totals | null {
  const [totals, setTotals] = useState<Totals | null>(null)
  useEffect(() => {
    if (!active) {
      return
    }
    void window.api.crowsnest.call('getFunnelTotals').then((res) => {
      if (res.ok) {
        setTotals({
          visits: count(res.value.gift_page_visit),
          emails: count(res.value.email),
          checkouts: count(res.value.checkout)
        })
      }
    })
  }, [active])
  return totals
}

/** Settings > Sources card for Umami: the address and key test, and the funnel pull with progress. */
export function UmamiSourceCard({
  row,
  reload
}: {
  row: SourceRow
  reload: () => Promise<void>
}): React.ReactNode {
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [address, setAddress] = useState('')
  // A bridge call that never reached Umami records nothing, so it is shown here.
  const [callError, setCallError] = useState<string | null>(null)
  const view = viewOf(row, { testing, form })
  const pull = row.summary.pull
  const totals = useFunnelTotals(view === 'done')

  useEffect(() => {
    void window.api.crowsnest.call('umamiAddressAction').then((res) => {
      if (res.ok && res.value) {
        setAddress(res.value)
      }
    })
  }, [form])

  useEffect(() => {
    if (view !== 'pulling') {
      setStopping(false)
      return
    }
    const timer = setInterval(() => void reload(), 1000)
    return () => clearInterval(timer)
  }, [view, reload])

  const host = address.replace(/^https?:\/\//, '')
  const startPull = async (): Promise<void> => {
    setCallError(null)
    const res = await window.api.crowsnest.call('startUmamiPullAction')
    setCallError(!res.ok ? res.error.message : !res.value.ok ? res.value.error : null)
    await reload()
  }
  const testCard = async (): Promise<void> => {
    setTesting(true)
    setCallError(null)
    const res = await window.api.crowsnest.call('sampleConnector', row.id)
    if (!res.ok) {
      setCallError(res.error.message)
    }
    await reload()
    setTesting(false)
  }
  const openFunnel = (): void => {
    useAppStore.getState().closeSettingsPage()
    void openBoardInActiveWorkspace('funnel')
  }

  const pullButton = (primary: boolean): React.ReactNode => (
    <Button
      data-testid="umami-pull"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => void startPull()}
    >
      {translate('leadStudio.sources.umami.pull', 'Pull funnel')}
    </Button>
  )
  const testButton = (
    <Button data-testid="umami-test" variant="outline" size="sm" onClick={() => void testCard()}>
      {translate('leadStudio.sources.testConnection', 'Test connection')}
    </Button>
  )
  const changeButton = (primary: boolean, label: string): React.ReactNode => (
    <Button
      data-testid="umami-enter"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm(true)}
    >
      {label}
    </Button>
  )
  const changeKey = (): string => translate('leadStudio.sources.umami.changeKey', 'Change API key')
  const pageCount = pull ? `${pull.done} / ${pull.total} ${pages()}` : ''
  const keepLine = (
    <Dim testId="umami-keep">
      {pull?.olderFrom
        ? translate(
            'leadStudio.sources.umami.keep',
            'Nothing new was stored. The funnel keeps its numbers from {{time}}.',
            { time: formatClock(pull.olderFrom) }
          )
        : translate(
            'leadStudio.sources.umami.keepNone',
            'Nothing new was stored. The funnel has no Umami numbers yet.'
          )}
    </Dim>
  )

  const body = ((): React.ReactNode => {
    switch (view) {
      case 'not-connected':
        return (
          <>
            <Dim testId="umami-line">
              {translate(
                'leadStudio.sources.umami.needsKey',
                'Needs your Umami address and an API key.'
              )}
            </Dim>
            <Actions>
              {changeButton(true, translate('leadStudio.sources.umami.connect', 'Connect Umami'))}
              <UmamiKeyHelp />
            </Actions>
          </>
        )
      case 'form':
        return (
          <UmamiKeyForm
            address={address}
            onClose={async () => {
              await reload()
              setForm(false)
            }}
          />
        )
      case 'testing':
        return (
          <Dim testId="umami-line">
            {translate('leadStudio.sources.umami.testingLine', 'Testing the key with {{host}}…', {
              host
            })}
          </Dim>
        )
      case 'ready':
        return (
          <>
            {row.summary.sample ? (
              <Strong testId="umami-sample">
                {translate('leadStudio.sources.umami.websiteLine', 'Website')}{' '}
                <Num>{row.summary.sample}</Num>
              </Strong>
            ) : (
              <Dim testId="umami-sample">
                {translate(
                  'leadStudio.sources.umami.noSample',
                  'Not tested yet. Press Test connection to check the key.'
                )}
              </Dim>
            )}
            <Dim testId="umami-last-pull">
              {row.pulledAt && pull ? (
                <>
                  {translate('leadStudio.sources.umami.lastPull', 'Last pull:')}{' '}
                  <Num>
                    {formatClock(row.pulledAt)} · {pull.total} {pages()}
                  </Num>
                </>
              ) : (
                translate('leadStudio.sources.neverPulled', 'Never pulled')
              )}
            </Dim>
            <Actions>
              {pullButton(true)}
              {testButton}
              {changeButton(false, changeKey())}
            </Actions>
          </>
        )
      case 'pulling': {
        const done = row.progress?.done ?? 0
        const total = row.progress?.total ?? null
        return (
          <SourcePullProgress
            label={row.progress?.label ?? null}
            done={done}
            total={total}
            unit={pages()}
            startedAt={row.progress?.startedAt ?? null}
            stopping={stopping}
            nowText={{
              pulling: translate('leadStudio.sources.pull.pullingLabel', 'Pulling {{label}}…', {
                label: row.progress?.label ?? ''
              }),
              stopping: translate(
                'leadStudio.sources.umami.stoppingPage',
                'Stopping after this page…'
              )
            }}
            tally={[
              translate('leadStudio.sources.umami.pagesRead', '✓ {{count}} read', {
                count: done
              }),
              translate('leadStudio.sources.pull.toGo', '{{count}} to go', {
                count: Math.max(0, (total ?? done) - done)
              })
            ]}
            slowReason={translate('leadStudio.sources.umami.slow', 'Umami is answering slowly.')}
            onStop={() => {
              setStopping(true)
              void window.api.crowsnest.call('stopUmamiPullAction')
            }}
          />
        )
      }
      case 'done':
        return (
          <>
            <SourcePullSummary
              headline={
                <>
                  {translate('leadStudio.sources.umami.pulledAt', 'Pulled the funnel at')}{' '}
                  <Num>{row.pulledAt ? formatClock(row.pulledAt) : ''}</Num>{' '}
                  {translate('leadStudio.sources.umami.in', 'in')}{' '}
                  <Num>{formatElapsed(pull?.durationSec ?? 0)}</Num> ({pageCount}).
                </>
              }
              cells={[
                {
                  label: translate('leadStudio.sources.umami.visits', 'Gift page visits'),
                  value: totals?.visits ?? '…'
                },
                {
                  label: translate('leadStudio.sources.umami.emails', 'Email signups'),
                  value: totals?.emails ?? '…'
                },
                {
                  label: translate('leadStudio.sources.umami.checkouts', 'Checkout clicks'),
                  value: totals?.checkouts ?? '…'
                }
              ]}
            />
            <Actions>
              <Button data-testid="umami-open-funnel" size="sm" onClick={openFunnel}>
                {translate('leadStudio.sources.umami.openFunnel', 'Open Funnel board')}
              </Button>
              {pullButton(false)}
            </Actions>
          </>
        )
      case 'stopped':
        return (
          <>
            <Warn testId="umami-line">
              {translate('leadStudio.sources.umami.stopped', 'You stopped the pull at')}{' '}
              <Num>{pageCount}</Num>.
            </Warn>
            {keepLine}
            <Actions>{pullButton(true)}</Actions>
          </>
        )
      case 'partial':
        return (
          <>
            <Warn testId="umami-line">
              {translate('leadStudio.sources.umami.partial', 'The pull stopped at')}{' '}
              <Num>{pageCount}</Num>: {row.detail}
            </Warn>
            {keepLine}
            <Actions>
              {pullButton(true)}
              {testButton}
            </Actions>
          </>
        )
      case 'error':
        return (
          <>
            <p data-testid="umami-line" className="text-xs text-destructive">
              {row.detail ?? row.message}
            </p>
            <Actions>
              {changeButton(true, changeKey())}
              {testButton}
            </Actions>
          </>
        )
      case 'unreachable':
        return (
          <>
            <p data-testid="umami-line" className="text-xs text-destructive">
              {row.detail ?? row.message}
            </p>
            <Actions>
              {pullButton(true)}
              {changeButton(
                false,
                translate('leadStudio.sources.umami.changeAddress', 'Change address')
              )}
            </Actions>
          </>
        )
    }
  })()

  const pill = PILL[view === 'unreachable' ? 'error' : view]
  return (
    <div
      data-testid="source-card"
      data-connector-id={row.id}
      data-state={testing ? 'checking' : row.state}
      data-view={view}
    >
      <IntegrationCardShell
        icon={<BarChart3 className="size-5" />}
        name={row.label}
        description={translate(
          'leadStudio.sources.umami.gives',
          'Gift page visits, email signups, checkout.'
        )}
        statusLabel={pill.label()}
        statusTone={pill.tone}
        statusBusy={pill.busy}
      >
        <IntegrationCardDetails>
          {body}
          {callError ? (
            <p data-testid="source-detail" className="font-mono text-2xs text-muted-foreground/70">
              {translate('leadStudio.sources.detail', 'Details: {{detail}}', { detail: callError })}
            </p>
          ) : null}
        </IntegrationCardDetails>
      </IntegrationCardShell>
    </div>
  )
}
