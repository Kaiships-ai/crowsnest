import React, { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { Dim } from './sidecar-card-view'

type FormTest =
  | { state: 'idle' | 'testing' }
  | { state: 'ok'; line: string }
  | { state: 'err'; message: string }

/** The session id form: nothing tests on paste, Test connection tests, Save turns on only after a pass. */
export function SidecarSessionForm({ onClose }: { onClose: () => Promise<void> }): React.ReactNode {
  const [draft, setDraft] = useState('')
  const [formTest, setFormTest] = useState<FormTest>({ state: 'idle' })
  const busy = formTest.state === 'testing'

  const test = async (): Promise<void> => {
    setFormTest({ state: 'testing' })
    const res = await window.api.crowsnest.call('testSidecarSessionAction', draft)
    if (!res.ok) {
      setFormTest({ state: 'err', message: res.error.message })
      return
    }
    setFormTest(
      res.value.ok
        ? { state: 'ok', line: res.value.line }
        : { state: 'err', message: res.value.message }
    )
  }

  return (
    <div data-testid="sidecar-session-form" className="space-y-2">
      <Label htmlFor="sidecar-session-input" className="text-xs">
        {translate('leadStudio.sources.sidecar.sessionLabel', 'Instagram session id')}
      </Label>
      <Input
        id="sidecar-session-input"
        data-testid="sidecar-session-input"
        type="password"
        autoComplete="off"
        className="font-mono"
        placeholder="1234567890%3AAbCdEf…"
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value)
          setFormTest({ state: 'idle' })
        }}
      />
      <Dim testId="sidecar-session-hint">
        {translate(
          'leadStudio.sources.sidecar.sessionHint',
          'Open instagram.com › DevTools › Application › Cookies › sessionid.'
        )}
      </Dim>
      {formTest.state === 'testing' ? (
        <p
          data-testid="sidecar-form-check"
          data-check="testing"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3 animate-spin" />
          {translate('leadStudio.sources.testing', 'Testing…')}
        </p>
      ) : formTest.state === 'ok' ? (
        <p data-testid="sidecar-form-check" data-check="ok" className="text-xs text-status-success">
          {translate(
            'leadStudio.sources.sidecar.sessionWorks',
            '✓ Session works · sample {{line}}',
            { line: formTest.line }
          )}
        </p>
      ) : formTest.state === 'err' ? (
        <p data-testid="sidecar-form-check" data-check="err" className="text-xs text-destructive">
          {formTest.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onClose()}>
          {translate('leadStudio.sources.cancel', 'Cancel')}
        </Button>
        <Button
          data-testid="sidecar-form-test"
          variant="outline"
          size="sm"
          disabled={!draft.trim() || busy}
          onClick={() => void test()}
        >
          {translate('leadStudio.sources.testConnection', 'Test connection')}
        </Button>
        <Button
          data-testid="sidecar-form-save"
          size="sm"
          disabled={formTest.state !== 'ok'}
          onClick={() => void onClose()}
        >
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
