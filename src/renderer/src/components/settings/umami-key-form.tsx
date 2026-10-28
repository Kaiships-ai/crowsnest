import React, { useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

const UMAMI_KEY_HELP = 'https://umami.is/docs/api'

type Website = { id: string; name: string; domain: string }
type FormTest =
  | { state: 'idle' | 'testing' }
  | { state: 'ok'; websites: Website[]; picked: string | null }
  | { state: 'err'; message: string }

const siteName = (w: Website): string => w.domain || w.name

export function UmamiKeyHelp(): React.ReactNode {
  return (
    <Button
      data-testid="umami-key-help"
      variant="link"
      size="sm"
      className="h-auto self-start p-0"
      onClick={() => window.api.shell.openUrl(UMAMI_KEY_HELP)}
    >
      {translate('leadStudio.sources.umami.help', 'Create a key: Umami › Settings › API keys')}
      <ExternalLink className="size-3.5" />
    </Button>
  )
}

/** The Umami dialog: address and API key. Nothing tests on paste; Test connection lists the key's websites,
 *  one is picked for you, several ask for a pick, and Save turns on only after a passing test. */
export function UmamiKeyForm(props: {
  address: string
  onClose: () => Promise<void>
}): React.ReactNode {
  const [address, setAddress] = useState(props.address)
  const [key, setKey] = useState('')
  const [formTest, setFormTest] = useState<FormTest>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const busy = formTest.state === 'testing' || saving
  const picked = formTest.state === 'ok' ? formTest.picked : null
  const edit = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value)
    setFormTest({ state: 'idle' })
  }

  const test = async (): Promise<void> => {
    setFormTest({ state: 'testing' })
    const res = await window.api.crowsnest.call('testUmamiKeyAction', address, key)
    if (!res.ok) {
      setFormTest({ state: 'err', message: res.error.message })
    } else if (!res.value.ok) {
      setFormTest({ state: 'err', message: res.value.message })
    } else {
      const { websites } = res.value
      setFormTest({ state: 'ok', websites, picked: websites.length === 1 ? websites[0].id : null })
    }
  }
  const save = async (): Promise<void> => {
    if (!picked) {
      return
    }
    setSaving(true)
    const res = await window.api.crowsnest.call('saveUmamiKeyAction', address, key, picked)
    setSaving(false)
    const failure = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    if (failure) {
      setFormTest({ state: 'err', message: failure })
      return
    }
    await props.onClose()
  }

  return (
    <div data-testid="umami-form" className="space-y-2">
      <Label htmlFor="umami-addr-input" className="text-xs">
        {translate('leadStudio.sources.umami.addressLabel', 'Umami address')}
      </Label>
      <Input
        id="umami-addr-input"
        data-testid="umami-addr-input"
        autoComplete="off"
        className="font-mono"
        placeholder={translate(
          'leadStudio.sources.umami.addressPlaceholder',
          'https://umami.example.com'
        )}
        value={address}
        disabled={busy}
        onChange={edit(setAddress)}
      />
      <Label htmlFor="umami-key-input" className="text-xs">
        {translate('leadStudio.sources.umami.keyLabel', 'API key')}
      </Label>
      <Input
        id="umami-key-input"
        data-testid="umami-key-input"
        type="password"
        autoComplete="off"
        className="font-mono"
        placeholder={translate('leadStudio.sources.umami.keyPlaceholder', 'umami_…')}
        value={key}
        disabled={busy}
        onChange={edit(setKey)}
      />
      <UmamiKeyHelp />
      {formTest.state === 'testing' ? (
        <p
          data-testid="umami-form-check"
          data-check="testing"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-3 animate-spin" />
          {translate('leadStudio.sources.testing', 'Testing…')}
        </p>
      ) : formTest.state === 'err' ? (
        <p data-testid="umami-form-check" data-check="err" className="text-xs text-destructive">
          {formTest.message}
        </p>
      ) : formTest.state === 'ok' && formTest.websites.length === 1 ? (
        <p data-testid="umami-form-check" data-check="ok" className="text-xs text-status-success">
          {translate('leadStudio.sources.umami.keyWorks', '✓ Key works · website {{site}}', {
            site: siteName(formTest.websites[0])
          })}
        </p>
      ) : formTest.state === 'ok' ? (
        <div data-testid="umami-form-check" data-check="pick" className="space-y-2">
          <Label className="text-xs">
            {translate('leadStudio.sources.umami.website', 'Website')}
          </Label>
          <Select
            value={picked ?? undefined}
            onValueChange={(id) => setFormTest({ ...formTest, picked: id })}
          >
            <SelectTrigger data-testid="umami-site-select" size="sm" className="font-mono text-xs">
              <SelectValue
                placeholder={translate('leadStudio.sources.umami.chooseSite', 'Choose a website…')}
              />
            </SelectTrigger>
            <SelectContent>
              {formTest.websites.map((w) => (
                <SelectItem
                  key={w.id}
                  value={w.id}
                  data-testid="umami-site-option"
                  className="font-mono text-xs"
                >
                  {siteName(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          data-testid="umami-form-cancel"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void props.onClose()}
        >
          {translate('leadStudio.sources.cancel', 'Cancel')}
        </Button>
        <Button
          data-testid="umami-form-test"
          variant="outline"
          size="sm"
          disabled={!address.trim() || !key.trim() || busy}
          onClick={() => void test()}
        >
          {translate('leadStudio.sources.testConnection', 'Test connection')}
        </Button>
        <Button
          data-testid="umami-form-save"
          size="sm"
          disabled={!picked || saving}
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
