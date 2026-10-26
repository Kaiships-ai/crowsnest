import React, { useEffect, useId, useState } from 'react'
import { LoaderCircle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { preventOutsideDismissWhenDirty } from '@/lib/outside-dismiss-guard'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'

type SourceRow = EngineCallValue<'getVaultBoard'>[number]

/** Connect or Edit key for one source, shaped like Orca's Linear key dialog. Write-only: a saved key never comes back. */
export function SourceKeyDialog({
  row,
  onOpenChange,
  onSaved
}: {
  row: SourceRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}): React.ReactNode {
  const idPrefix = useId()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDrafts({})
    setError(null)
  }, [row?.id])
  const dirty = Object.values(drafts).some((value) => value.trim() !== '')
  const guardOutsideDismiss = preventOutsideDismissWhenDirty(() => dirty)
  const connecting = row?.state === 'not-connected'

  const save = async (): Promise<void> => {
    if (!row || !dirty || saving) {
      return
    }
    setSaving(true)
    setError(null)
    for (const [name, value] of Object.entries(drafts)) {
      if (!value.trim()) {
        continue
      }
      const res = await window.api.crowsnest.call('setConnectorSecret', row.id, name, value)
      const message = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
      if (message) {
        setError(message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent
        data-testid="source-key-dialog"
        className="sm:max-w-lg"
        onPointerDownOutside={guardOutsideDismiss}
        onInteractOutside={guardOutsideDismiss}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && dirty && !saving) {
            event.preventDefault()
            void save()
          }
        }}
      >
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">
            {connecting
              ? translate('leadStudio.sources.connectTitle', 'Connect {{name}}', {
                  name: row?.label
                })
              : translate('leadStudio.sources.editTitle', 'Edit {{name}} key', {
                  name: row?.label
                })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'leadStudio.sources.keyDescription',
              'Paste the key from your {{name}} account. A new key replaces the stored one, and the next pull uses it.',
              { name: row?.label }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {row?.secrets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate('leadStudio.sources.noKey', 'This source needs no key.')}
            </p>
          ) : null}
          {row?.secrets.map((secret) => (
            <div key={secret.name} className="space-y-2">
              <Label htmlFor={`${idPrefix}-${secret.name}`} className="text-xs">
                {secret.label}
                {secret.optional
                  ? ` ${translate('leadStudio.sources.optional', '(optional)')}`
                  : null}
              </Label>
              <Input
                id={`${idPrefix}-${secret.name}`}
                data-testid="source-key-input"
                data-secret-name={secret.name}
                type="password"
                autoComplete="off"
                placeholder={
                  secret.source === 'none'
                    ? translate('leadStudio.sources.notSet', 'Not set')
                    : translate('leadStudio.sources.saved', 'Saved · paste to replace')
                }
                value={drafts[secret.name] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [secret.name]: event.target.value }))
                }
                disabled={saving}
              />
            </div>
          ))}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <Lock className="size-3 shrink-0" />
            {translate(
              'leadStudio.sources.sealed',
              "Keys are sealed with this Mac's Keychain and never stored as plain text."
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {translate('leadStudio.sources.cancel', 'Cancel')}
          </Button>
          <Button
            data-testid="source-key-save"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate('leadStudio.sources.saving', 'Saving...')}
              </>
            ) : connecting ? (
              translate('leadStudio.sources.connect', 'Connect')
            ) : (
              translate('leadStudio.sources.saveKey', 'Save key')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
