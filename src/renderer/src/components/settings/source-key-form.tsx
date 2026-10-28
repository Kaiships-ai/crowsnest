import React, { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

export type KeyTest = { ok: true; line: string } | { ok: false; message: string }

type FormTest =
  | { state: 'idle' | 'testing' }
  | { state: 'ok'; line: string }
  | { state: 'err'; message: string }

/** A Sources card's key form: nothing tests on paste, Test connection tests, Save turns on only after a pass.
 *  Test ids: `<keyTestId>-form`, `-input` and `-hint`; `<testIdPrefix>-form-check`, `-form-cancel`, `-form-test` and `-form-save`. */
export function SourceKeyForm(props: {
  testIdPrefix: string
  keyTestId: string
  label: string
  placeholder: string
  hint: React.ReactNode
  /** The ✓ line after a passing test. */
  okText: (line: string) => string
  test: (draft: string) => Promise<KeyTest>
  /** Resolves to an error to show in the form, or null when saved. */
  save: (draft: string) => Promise<string | null>
  onClose: () => Promise<void>
}): React.ReactNode {
  const id = props.testIdPrefix
  const key = props.keyTestId
  const [draft, setDraft] = useState('')
  const [formTest, setFormTest] = useState<FormTest>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const busy = formTest.state === 'testing' || saving

  const test = async (): Promise<void> => {
    setFormTest({ state: 'testing' })
    const res = await props.test(draft)
    setFormTest(res.ok ? { state: 'ok', line: res.line } : { state: 'err', message: res.message })
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    const failure = await props.save(draft)
    setSaving(false)
    if (failure) {
      setFormTest({ state: 'err', message: failure })
      return
    }
    await props.onClose()
  }

  return (
    <div data-testid={`${key}-form`} className="space-y-2">
      <Label htmlFor={`${key}-input`} className="text-xs">
        {props.label}
      </Label>
      <Input
        id={`${key}-input`}
        data-testid={`${key}-input`}
        type="password"
        autoComplete="off"
        className="font-mono"
        placeholder={props.placeholder}
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value)
          setFormTest({ state: 'idle' })
        }}
      />
      <p data-testid={`${key}-hint`} className="text-xs text-muted-foreground">
        {props.hint}
      </p>
      {formTest.state === 'testing' ? (
        <p
          data-testid={`${id}-form-check`}
          data-check="testing"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3 animate-spin" />
          {translate('leadStudio.sources.testing', 'Testing…')}
        </p>
      ) : formTest.state === 'ok' ? (
        <p data-testid={`${id}-form-check`} data-check="ok" className="text-xs text-status-success">
          {props.okText(formTest.line)}
        </p>
      ) : formTest.state === 'err' ? (
        <p data-testid={`${id}-form-check`} data-check="err" className="text-xs text-destructive">
          {formTest.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          data-testid={`${id}-form-cancel`}
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void props.onClose()}
        >
          {translate('leadStudio.sources.cancel', 'Cancel')}
        </Button>
        <Button
          data-testid={`${id}-form-test`}
          variant="outline"
          size="sm"
          disabled={!draft.trim() || busy}
          onClick={() => void test()}
        >
          {translate('leadStudio.sources.testConnection', 'Test connection')}
        </Button>
        <Button
          data-testid={`${id}-form-save`}
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
