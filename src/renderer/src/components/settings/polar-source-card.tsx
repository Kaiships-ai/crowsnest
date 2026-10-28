import React, { useCallback, useEffect, useState } from 'react'
import { CreditCard, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { SOURCE_STATE } from '../board/kit/StatePill'
import {
  IntegrationCardDetails,
  IntegrationCardShell,
  type IntegrationCardStatusTone
} from './integration-card-shell'

type SourceRow = EngineCallValue<'getVaultBoard'>[number]
type View = 'not-connected' | 'form' | 'testing' | 'ready' | 'error'
type FormTest =
  | { state: 'idle' | 'testing' }
  | { state: 'ok'; organization: string }
  | { state: 'err'; message: string }

const TOKEN_HELP = 'https://docs.polar.sh/api-reference/introduction'
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function pillOf(
  view: View,
  row: SourceRow
): { label: string; tone: IntegrationCardStatusTone; busy?: true } {
  if (view === 'testing') {
    return { label: translate('boards.kit.state.checking', 'Testing'), tone: 'neutral', busy: true }
  }
  if (row.state === 'not-connected') {
    return {
      label: translate('leadStudio.sources.polar.notConnected', 'Not connected'),
      tone: 'attention'
    }
  }
  const state = row.state === 'ready' ? 'ready' : 'error'
  return { label: SOURCE_STATE[state].label(), tone: SOURCE_STATE[state].tone }
}

const Dim = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <p data-testid="polar-line" className="text-xs text-muted-foreground">
    {children}
  </p>
)

const Actions = ({ children }: { children: React.ReactNode }): React.ReactNode => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
)

function HelpLink({ label }: { label: string }): React.ReactNode {
  return (
    <Button
      data-testid="polar-help"
      variant="link"
      size="sm"
      className="h-auto self-start px-0"
      onClick={() => window.api.shell.openUrl(TOKEN_HELP)}
    >
      {label}
      <ExternalLink className="size-3" />
    </Button>
  )
}

/** The token form: nothing tests on paste, Test connection tests, Save turns on only after a pass. */
function PolarTokenForm({
  onClose
}: {
  onClose: (saved: boolean) => Promise<void>
}): React.ReactNode {
  const [draft, setDraft] = useState('')
  const [formTest, setFormTest] = useState<FormTest>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const busy = formTest.state === 'testing' || saving

  const test = async (): Promise<void> => {
    setFormTest({ state: 'testing' })
    const res = await window.api.crowsnest.call('testPolarTokenAction', draft)
    if (!res.ok) {
      setFormTest({ state: 'err', message: res.error.message })
      return
    }
    setFormTest(
      res.value.ok
        ? { state: 'ok', organization: res.value.organization }
        : { state: 'err', message: res.value.message }
    )
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const res = await window.api.crowsnest.call('savePolarTokenAction', draft)
    setSaving(false)
    const failure = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    if (failure) {
      setFormTest({ state: 'err', message: failure })
      return
    }
    await onClose(true)
  }

  return (
    <div data-testid="polar-form" className="flex flex-col gap-2">
      <Label htmlFor="polar-token-input" className="text-xs">
        {translate('leadStudio.sources.polar.tokenLabel', 'Polar organization access token')}
      </Label>
      <Input
        id="polar-token-input"
        data-testid="polar-token-input"
        type="password"
        autoComplete="off"
        className="font-mono"
        placeholder={translate('leadStudio.sources.polar.tokenPlaceholder', 'polar_oat_…')}
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value)
          setFormTest({ state: 'idle' })
        }}
      />
      <HelpLink
        label={translate(
          'leadStudio.sources.polar.helpForm',
          'How to create a token: Polar › Settings › Developers'
        )}
      />
      {formTest.state === 'testing' ? (
        <p
          data-testid="polar-form-check"
          data-check="testing"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3 animate-spin" />
          {translate('leadStudio.sources.testing', 'Testing…')}
        </p>
      ) : formTest.state === 'ok' ? (
        <p data-testid="polar-form-check" data-check="ok" className="text-xs text-status-success">
          {translate(
            'leadStudio.sources.polar.tokenWorks',
            '✓ Token works · organization {{name}}',
            { name: formTest.organization }
          )}
        </p>
      ) : formTest.state === 'err' ? (
        <p data-testid="polar-form-check" data-check="err" className="text-xs text-destructive">
          {formTest.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          data-testid="polar-form-cancel"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void onClose(false)}
        >
          {translate('leadStudio.sources.cancel', 'Cancel')}
        </Button>
        <Button
          data-testid="polar-form-test"
          variant="outline"
          size="sm"
          disabled={!draft.trim() || busy}
          onClick={() => void test()}
        >
          {translate('leadStudio.sources.testConnection', 'Test connection')}
        </Button>
        <Button
          data-testid="polar-form-save"
          size="sm"
          disabled={formTest.state !== 'ok' || saving}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          {translate('leadStudio.sources.save', 'Save')}
        </Button>
      </div>
      {formTest.state === 'ok' ? null : (
        <p className="text-right font-mono text-2xs text-muted-foreground">
          {translate('leadStudio.sources.saveAfterTest', 'Save turns on after a passing test.')}
        </p>
      )}
    </div>
  )
}

/** Settings > Sources: the Polar card. It tests a token and has no pull yet. */
export function PolarSourceCard({
  row,
  reload
}: {
  row: SourceRow
  reload: () => Promise<void>
}): React.ReactNode {
  const [form, setForm] = useState(false)
  const [testing, setTesting] = useState(false)
  const [organization, setOrganization] = useState<string | null>(null)
  // A bridge call that never reached the connector records nothing, so it is shown here.
  const [callError, setCallError] = useState<string | null>(null)

  const loadOrganization = useCallback(async () => {
    const res = await window.api.crowsnest.call('getPolarOrganization')
    setOrganization(res.ok ? res.value : null)
  }, [])
  useEffect(() => {
    void loadOrganization()
  }, [loadOrganization])

  const view: View = form
    ? 'form'
    : testing
      ? 'testing'
      : row.state === 'not-connected'
        ? 'not-connected'
        : row.state === 'ready' && !callError
          ? 'ready'
          : 'error'
  const pill = pillOf(view, row)

  const testSaved = async (): Promise<void> => {
    setTesting(true)
    setCallError(null)
    try {
      const res = await window.api.crowsnest.call('testConnector', row.id)
      if (!res.ok) {
        setCallError(res.error.message)
      }
      await Promise.all([reload(), loadOrganization()])
    } finally {
      setTesting(false)
    }
  }

  const closeForm = async (saved: boolean): Promise<void> => {
    if (saved) {
      setCallError(null)
      await Promise.all([reload(), loadOrganization()])
    }
    setForm(false)
  }

  const testButton = (
    <Button data-testid="polar-test" variant="outline" size="sm" onClick={() => void testSaved()}>
      {translate('leadStudio.sources.testConnection', 'Test connection')}
    </Button>
  )
  const changeButton = (primary: boolean): React.ReactNode => (
    <Button
      data-testid="polar-change"
      variant={primary ? 'default' : 'outline'}
      size="sm"
      onClick={() => setForm(true)}
    >
      {translate('leadStudio.sources.polar.change', 'Change token')}
    </Button>
  )

  const body = ((): React.ReactNode => {
    switch (view) {
      case 'not-connected':
        return (
          <>
            <Dim>
              {translate(
                'leadStudio.sources.polar.needsToken',
                'Orders and revenue. Needs an organization access token.'
              )}
            </Dim>
            <Actions>
              <Button data-testid="polar-enter" size="sm" onClick={() => setForm(true)}>
                {translate('leadStudio.sources.polar.enter', 'Enter access token')}
              </Button>
              <HelpLink
                label={translate('leadStudio.sources.polar.help', 'How to create a token')}
              />
            </Actions>
          </>
        )
      case 'form':
        return <PolarTokenForm onClose={closeForm} />
      case 'testing':
        return (
          <Dim>
            {translate('leadStudio.sources.polar.testingLine', 'Testing the token with Polar…')}
          </Dim>
        )
      case 'ready':
        return (
          <>
            <p data-testid="polar-organization" className="text-xs text-foreground">
              {organization
                ? translate('leadStudio.sources.polar.organization', 'Organization {{name}}', {
                    name: organization
                  })
                : translate('leadStudio.sources.polar.untested', 'Token saved, not tested yet')}
              {row.checkedAt ? (
                <span className="text-muted-foreground">
                  {translate('leadStudio.sources.polar.tested', ' · tested {{time}}', {
                    time: clock.format(new Date(row.checkedAt))
                  })}
                </span>
              ) : null}
            </p>
            <Dim>
              {translate(
                'leadStudio.sources.polar.pullLater',
                'Pulling orders comes in a later release. The key is saved and tested.'
              )}
            </Dim>
            <Actions>
              {testButton}
              {changeButton(false)}
            </Actions>
          </>
        )
      case 'error':
        return (
          <>
            <p data-testid="polar-line" className="text-xs text-destructive">
              {callError ??
                row.message ??
                translate(
                  'leadStudio.sources.explain.error',
                  'The last check or pull failed. Check the key, then check again.'
                )}
            </p>
            <Actions>
              {changeButton(true)}
              {testButton}
            </Actions>
          </>
        )
    }
  })()

  return (
    <div data-testid="source-card" data-connector-id={row.id} data-state={view}>
      <IntegrationCardShell
        icon={<CreditCard className="size-5" />}
        name={row.label}
        description={translate('leadStudio.sources.polar.gives', 'Orders and revenue.')}
        statusLabel={pill.label}
        statusTone={pill.tone}
        statusBusy={pill.busy}
      >
        <IntegrationCardDetails>{body}</IntegrationCardDetails>
      </IntegrationCardShell>
    </div>
  )
}
