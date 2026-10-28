import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { openBoardInActiveWorkspace } from '@/lib/open-board-tab'
import { useAppStore } from '@/store'
import { formatClock } from '../board/board-time'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import {
  Actions,
  Dim,
  later,
  Num,
  PILL,
  SidecarReadyBody,
  viewOf,
  type Health,
  type SourceRow
} from './sidecar-card-view'
import { SidecarPullOutcome } from './sidecar-pull-outcome'
import { SidecarSessionForm } from './sidecar-session-form'
import { SourcePullProgress } from './source-pull-progress'

type Progress = {
  jobId: string
  label: string | null
  done: number
  total: number | null
  startedAt: string
  stopping: boolean
}
type CallFailure = { error: string } | null

/** Settings > Sources card for the Instagram sidecar: the switch, the session id test, and the rival pull with progress. */
export function SidecarSourceCard({
  row,
  reload
}: {
  row: SourceRow
  reload: () => Promise<void>
}): React.ReactNode {
  const [health, setHealth] = useState<Health | null>(null)
  const [starting, setStarting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form, setForm] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [stopping, setStopping] = useState(false)
  // The pull this card started; after a remount it is unknown and the poll reads the running job.
  const jobId = useRef<string | null>(null)
  // A bridge call that never reached the sidecar records nothing, so it is shown here.
  const [callError, setCallError] = useState<string | null>(null)

  const readHealth = useCallback(async () => {
    const res = await window.api.crowsnest.call('getIgStatusAction')
    setHealth(
      res.ok && res.value.ok
        ? {
            running: true,
            loggedIn: res.value.status.loggedIn,
            username: res.value.status.username
          }
        : { running: false, loggedIn: false, username: null }
    )
  }, [])
  const refresh = useCallback(async () => {
    await Promise.all([reload(), readHealth()])
  }, [reload, readHealth])
  useEffect(() => {
    void readHealth()
  }, [readHealth])

  // Re-render when Instagram's wait ends, so the buttons it held off turn on.
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

  const view = viewOf(row, health, { starting, testing, form })

  useEffect(() => {
    if (view !== 'pulling') {
      setProgress(null)
      setStopping(false)
      return
    }
    let stopped = false
    const poll = async (): Promise<void> => {
      const res = await window.api.crowsnest.call('getSyncProgressAction', jobId.current)
      const p = res.ok && res.value.ok ? res.value.progress : null
      if (stopped) {
        return
      }
      if (p?.status === 'running') {
        setProgress({
          jobId: p.jobId,
          label: p.currentChannelHandle,
          done: p.channelsDone,
          total: p.channelsTotal,
          startedAt: p.startedAt,
          stopping: p.cancelRequested
        })
      } else {
        jobId.current = null
        await refresh()
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [view, refresh])

  const run = async (call: () => Promise<CallFailure>): Promise<void> => {
    setCallError(null)
    const failure = await call()
    if (failure) {
      setCallError(failure.error)
    }
    await refresh()
  }
  const pullRivals = (rest?: true): Promise<void> =>
    run(async () => {
      const res = await window.api.crowsnest.call(
        'startSyncAction',
        undefined,
        rest ? { rest } : undefined
      )
      if (!res.ok) {
        return { error: res.error.message }
      }
      if (!res.value.ok) {
        return { error: res.value.error }
      }
      jobId.current = res.value.jobId
      return null
    })
  const setOn = async (on: boolean): Promise<boolean> => {
    if (on) {
      setStarting(true)
    }
    setCallError(null)
    const res = await window.api.crowsnest.call(on ? 'startSidecarAction' : 'stopSidecarAction')
    const error = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    setCallError(error)
    await refresh()
    setStarting(false)
    return error === null
  }
  const testCard = async (): Promise<void> => {
    setTesting(true)
    await run(async () => {
      const res = await window.api.crowsnest.call('sampleConnector', row.id)
      return res.ok ? null : { error: res.error.message }
    })
    setTesting(false)
  }
  const closeForm = async (): Promise<void> => {
    await refresh()
    setForm(false)
  }
  const openRivals = (): void => {
    useAppStore.getState().closeSettingsPage()
    void openBoardInActiveWorkspace('rivals')
  }

  const testButton = (
    <Button data-testid="sidecar-test" variant="outline" size="sm" onClick={() => void testCard()}>
      {translate('leadStudio.sources.testConnection', 'Test connection')}
    </Button>
  )
  const changeButton = (primary: boolean): React.ReactNode => (
    <Button
      data-testid="sidecar-enter"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm(true)}
    >
      {translate('leadStudio.sources.sidecar.change', 'Change session id')}
    </Button>
  )

  const body = ((): React.ReactNode => {
    switch (view) {
      case 'off':
        return (
          <Dim testId="sidecar-line">
            {translate(
              'leadStudio.sources.sidecar.off',
              'The sidecar is off. Turn it on to connect Instagram.'
            )}
          </Dim>
        )
      case 'starting':
        return (
          <Dim testId="sidecar-line">
            {translate('leadStudio.sources.sidecar.startingLine', 'Starting the sidecar…')}
          </Dim>
        )
      case 'not-connected':
        return (
          <>
            <Dim testId="sidecar-line">
              {translate(
                'leadStudio.sources.sidecar.noSession',
                'The sidecar is running. No session id yet.'
              )}
            </Dim>
            <Actions>
              <Button data-testid="sidecar-enter" size="sm" onClick={() => setForm(true)}>
                {translate('leadStudio.sources.sidecar.enter', 'Enter session id')}
              </Button>
              <Button
                data-testid="sidecar-session-help"
                variant="outline"
                size="sm"
                onClick={() => setForm(true)}
              >
                {translate('leadStudio.sources.sidecar.sessionHelp', 'How to get a session id')}
              </Button>
            </Actions>
          </>
        )
      case 'form':
        return <SidecarSessionForm onClose={closeForm} />
      case 'testing':
        return (
          <Dim testId="sidecar-line">
            {health?.username
              ? translate(
                  'leadStudio.sources.sidecar.testingLine',
                  'Pulling a sample: profile @{{handle}}…',
                  { handle: health.username }
                )
              : translate('leadStudio.sources.sidecar.testingAny', 'Pulling a sample…')}
          </Dim>
        )
      case 'ready':
        return (
          <SidecarReadyBody row={row}>
            <Button data-testid="sidecar-pull" size="sm" onClick={() => void pullRivals()}>
              {translate('leadStudio.sources.sidecar.pull', 'Pull rivals')}
            </Button>
            {testButton}
            {changeButton(false)}
          </SidecarReadyBody>
        )
      case 'pulling':
        return (
          <SourcePullProgress
            label={progress?.label ?? row.progress?.label ?? null}
            done={progress?.done ?? row.progress?.done ?? 0}
            total={progress?.total ?? row.progress?.total ?? null}
            unit={translate('leadStudio.sources.sidecar.rivals', 'rivals')}
            startedAt={progress?.startedAt ?? row.progress?.startedAt ?? null}
            stopping={stopping || (progress?.stopping ?? false)}
            slowReason={translate(
              'leadStudio.sources.sidecar.slow',
              'Instagram is answering slowly, so Lead Studio waits between rivals to avoid a limit.'
            )}
            onStop={() => {
              // Before the first poll lands, the id startSyncAction returned is the pull to stop.
              const id = progress?.jobId ?? jobId.current
              if (!id) {
                return
              }
              setStopping(true)
              void window.api.crowsnest.call('cancelSyncAction', id)
            }}
          />
        )
      case 'limited-test': {
        const after = row.retryAfter ? formatClock(row.retryAfter) : ''
        return (
          <>
            <p data-testid="sidecar-line" className="text-xs text-destructive">
              {translate(
                'leadStudio.sources.sidecar.limitedTest',
                'Instagram is limiting requests. Try again after'
              )}{' '}
              <Num>{after}</Num>.
            </p>
            <Actions>
              <Button data-testid="sidecar-test" variant="outline" size="sm" disabled>
                {translate(
                  'leadStudio.sources.sidecar.testAfter',
                  'Test connection · after {{time}}',
                  { time: after }
                )}
              </Button>
            </Actions>
          </>
        )
      }
      case 'error':
        return (
          <>
            <p data-testid="sidecar-line" className="text-xs text-destructive">
              {row.detail ?? row.message}
            </p>
            <Actions>
              {changeButton(true)}
              {testButton}
            </Actions>
          </>
        )
      case 'done':
      case 'stopped':
      case 'partial':
      case 'limited':
      case 'off-mid':
        return (
          <SidecarPullOutcome
            view={view}
            row={row}
            health={health}
            onPull={pullRivals}
            onTurnOn={() => setOn(true)}
            onOpenRivals={openRivals}
            testButton={testButton}
          />
        )
    }
  })()

  const pill = PILL[view]
  const on = starting || (row.state !== 'off' && health?.running !== false)
  return (
    <div
      data-testid="source-card"
      data-connector-id={row.id}
      data-state={testing ? 'checking' : row.state}
      data-view={view}
    >
      <IntegrationCardShell
        icon={<Camera className="size-5" />}
        name={translate('leadStudio.sources.sidecar.name', 'Instagram sidecar')}
        description={translate(
          'leadStudio.sources.sidecar.gives',
          "Rivals' public numbers for the Rivals board."
        )}
        statusLabel={pill.label()}
        statusTone={pill.tone}
        statusBusy={pill.busy}
        actions={
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              data-testid="sidecar-switch"
              checked={on}
              disabled={starting}
              onCheckedChange={(checked) => void setOn(checked)}
            />
            {on
              ? translate('leadStudio.sources.sidecar.on', 'On')
              : translate('leadStudio.sources.sidecar.offSwitch', 'Off')}
          </label>
        }
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
