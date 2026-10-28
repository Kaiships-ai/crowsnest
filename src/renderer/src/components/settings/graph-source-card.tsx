import React, { useEffect, useState } from 'react'
import { Camera, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { useAppStore } from '@/store'
import { formatClock } from '../board/board-time'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import {
  callsLeft,
  GRAPH_CALLS_PER_HOUR,
  GraphPullOutcome,
  PILL,
  posts,
  TOKEN_HELP,
  viewOf
} from './graph-card-view'
import { Actions, Dim, later, Num, Strong, type SourceRow } from './sidecar-card-view'
import { SourceKeyForm } from './source-key-form'
import { SourcePullProgress } from './source-pull-progress'

/** Settings > Sources card for the Instagram Graph API: the token test, and your channel's pull with progress. */
export function GraphSourceCard({
  row,
  reload
}: {
  row: SourceRow
  reload: () => Promise<void>
}): React.ReactNode {
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState(false)
  const [stopping, setStopping] = useState(false)
  // A bridge call that never reached Graph records nothing, so it is shown here.
  const [callError, setCallError] = useState<string | null>(null)
  const view = viewOf(row, { testing, form })
  const pull = row.summary.pull

  useEffect(() => {
    if (view !== 'pulling') {
      setStopping(false)
      return
    }
    const timer = setInterval(() => void reload(), 1000)
    return () => clearInterval(timer)
  }, [view, reload])

  // Re-render when the hour frees calls again, so Pull the rest turns on.
  const [, setWaitEnded] = useState(0)
  useEffect(() => {
    if (!later(row.retryAfter)) {
      return
    }
    const timer = setTimeout(
      () => setWaitEnded((n) => n + 1),
      Date.parse(row.retryAfter ?? '') - Date.now() + 500
    )
    return () => clearTimeout(timer)
  }, [row.retryAfter])

  const startPull = async (rest: boolean): Promise<void> => {
    setCallError(null)
    const res = await window.api.crowsnest.call(
      'startGraphPullAction',
      rest ? { rest: true } : undefined
    )
    const failure = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    setCallError(failure)
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
  const openOwn = (): void => {
    useAppStore.getState().closeSettingsPage()
    void openBoardInActiveWorkspace('own')
  }

  const pullButton = (primary: boolean): React.ReactNode => (
    <Button
      data-testid="graph-pull"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => void startPull(false)}
    >
      {translate('leadStudio.sources.graph.pull', 'Pull my channel')}
    </Button>
  )
  const testButton = (
    <Button data-testid="graph-test" variant="outline" size="sm" onClick={() => void testCard()}>
      {translate('leadStudio.sources.testConnection', 'Test connection')}
    </Button>
  )
  const changeButton = (primary: boolean): React.ReactNode => (
    <Button
      data-testid="graph-enter"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm(true)}
    >
      {translate('leadStudio.sources.graph.change', 'Change token')}
    </Button>
  )
  const helpLink = (
    <Button
      data-testid="graph-token-help"
      variant="link"
      size="sm"
      onClick={() => window.api.shell.openUrl(TOKEN_HELP)}
    >
      {translate('leadStudio.sources.graph.help', 'How to get a token')}
      <ExternalLink className="size-3.5" />
    </Button>
  )
  const body = ((): React.ReactNode => {
    switch (view) {
      case 'not-connected':
        return (
          <>
            <Dim testId="graph-line">
              {translate(
                'leadStudio.sources.graph.needsToken',
                'Needs an access token from Business Login for Instagram.'
              )}
            </Dim>
            <Actions>
              <Button data-testid="graph-enter" size="sm" onClick={() => setForm(true)}>
                {translate('leadStudio.sources.graph.enter', 'Enter token')}
              </Button>
              {helpLink}
            </Actions>
          </>
        )
      case 'form':
        return (
          <SourceKeyForm
            testIdPrefix="graph"
            keyTestId="graph-token"
            label={translate('leadStudio.sources.graph.tokenLabel', 'Instagram Graph access token')}
            placeholder={translate('leadStudio.sources.graph.tokenPlaceholder', 'IGAA…')}
            hint={
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => window.api.shell.openUrl(TOKEN_HELP)}
              >
                {translate(
                  'leadStudio.sources.graph.helpLong',
                  'How to get a token (Business Login for Instagram)'
                )}
                <ExternalLink className="size-3.5" />
              </Button>
            }
            okText={(line) =>
              translate('leadStudio.sources.graph.tokenWorks', '✓ Token works · {{line}}', { line })
            }
            test={async (draft) => {
              const res = await window.api.crowsnest.call('testGraphTokenAction', draft)
              if (!res.ok) {
                return { ok: false, message: res.error.message }
              }
              return res.value.ok
                ? { ok: true, line: `@${res.value.username ?? '?'} · id ${res.value.userId}` }
                : { ok: false, message: res.value.message }
            }}
            save={async (draft) => {
              const res = await window.api.crowsnest.call('saveGraphTokenAction', draft)
              return !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
            }}
            onClose={async () => {
              await reload()
              setForm(false)
            }}
          />
        )
      case 'testing':
        return (
          <Dim testId="graph-line">
            {translate(
              'leadStudio.sources.graph.testingLine',
              'Testing the token with Instagram (/me)…'
            )}
          </Dim>
        )
      case 'ready':
        return (
          <>
            {row.summary.sample ? (
              <Strong testId="graph-sample">
                <Num>{row.summary.sample}</Num>
              </Strong>
            ) : (
              <Dim testId="graph-sample">
                {translate(
                  'leadStudio.sources.graph.noSample',
                  'Not tested yet. Press Test connection to check the token.'
                )}
              </Dim>
            )}
            <Dim testId="graph-last-pull">
              {row.pulledAt ? (
                <>
                  {translate('leadStudio.sources.graph.lastPull', 'Last pull:')}{' '}
                  <Num>
                    {formatClock(row.pulledAt)} · {pull ? `${pull.updated} ${posts()} · ` : ''}
                    {translate(
                      'leadStudio.sources.graph.callsLeft',
                      '{{left}} calls left this hour',
                      {
                        left: callsLeft(row)
                      }
                    )}
                  </Num>
                </>
              ) : (
                <>
                  {translate('leadStudio.sources.neverPulled', 'Never pulled')} ·{' '}
                  <Num>
                    {translate(
                      'leadStudio.sources.graph.callsLeft',
                      '{{left}} calls left this hour',
                      {
                        left: callsLeft(row)
                      }
                    )}
                  </Num>
                </>
              )}
            </Dim>
            <Actions>
              {pullButton(true)}
              {testButton}
              {changeButton(false)}
              {helpLink}
            </Actions>
          </>
        )
      case 'done':
      case 'stopped':
      case 'limited':
      case 'partial':
        return (
          <GraphPullOutcome
            view={view}
            row={row}
            onPull={startPull}
            onOpenOwn={openOwn}
            pullButton={pullButton(false)}
            testButton={testButton}
          />
        )
      case 'pulling': {
        const done = row.progress?.done ?? 0
        return (
          <SourcePullProgress
            label={row.progress?.label ?? null}
            done={done}
            total={row.progress?.total ?? null}
            unit={posts()}
            startedAt={row.progress?.startedAt ?? null}
            stopping={stopping}
            nowText={{
              pulling: translate(
                'leadStudio.sources.graph.pullingPost',
                'Pulling post “{{label}}”',
                {
                  label: row.progress?.label ?? ''
                }
              ),
              stopping: translate(
                'leadStudio.sources.graph.stoppingPost',
                'Stopping after this post…'
              )
            }}
            tally={[
              translate('leadStudio.sources.graph.measured', '✓ {{count}} measured', {
                count: done
              }),
              translate(
                'leadStudio.sources.graph.callsLeftShort',
                '{{count}} calls left this hour',
                {
                  count: row.graphCallsLeft ?? GRAPH_CALLS_PER_HOUR
                }
              )
            ]}
            slowReason={translate('leadStudio.sources.graph.slow', 'Graph is answering slowly.')}
            onStop={() => {
              setStopping(true)
              void window.api.crowsnest.call('stopGraphPullAction')
            }}
          />
        )
      }
      case 'error':
        return (
          <>
            <p data-testid="graph-line" className="text-xs text-destructive">
              {row.detail ?? row.message}
            </p>
            <Actions>
              {/* A pull's error stays until a pull passes; once a later test proves the token, the card offers that pull. */}
              {row.detail && row.checkedAt && row.pulledAt && row.checkedAt > row.pulledAt ? (
                <>
                  {pullButton(true)}
                  {testButton}
                  {changeButton(false)}
                </>
              ) : (
                <>
                  {changeButton(true)}
                  {testButton}
                </>
              )}
              {helpLink}
            </Actions>
          </>
        )
    }
  })()

  const pill = PILL[view]
  return (
    <div
      data-testid="source-card"
      data-connector-id={row.id}
      data-state={testing ? 'checking' : row.state}
      data-view={view}
    >
      <IntegrationCardShell
        icon={<Camera className="size-5" />}
        name={row.label}
        description={translate(
          'leadStudio.sources.graph.gives',
          'Your own channel: reels, reach, follows.'
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
