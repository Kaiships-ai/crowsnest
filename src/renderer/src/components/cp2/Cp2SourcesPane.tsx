import React, { useEffect, useState } from 'react'
import { BarChart3, Bot, Camera, CreditCard, Database, Lock, LoaderCircle } from 'lucide-react'
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
import {
  IntegrationCardDetails,
  IntegrationCardShell,
  type IntegrationCardStatusTone
} from '../settings/integration-card-shell'
import { IntegrationStatusPill } from '../integration-status-pill'
import { formatBoardTime } from '../board/board-time'
import { STATE_LABELS, vaultProblem } from '../board/VaultBoard'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { translate as t } from '@/i18n/i18n'
import { useCp2 } from './cp2-variant'

// CP2 prototype: Vault as a Settings pane "Sources". Throwaway.
type Row = EngineCallValue<'getVaultBoard'>[number]

const TONE: Record<Row['state'], IntegrationCardStatusTone> = {
  running: 'connected',
  error: 'attention',
  partial: 'attention',
  stale: 'neutral',
  'not-connected': 'neutral'
}
const ICON: Record<string, React.ReactNode> = {
  'instagram-graph': <Camera className="size-5" />,
  umami: <BarChart3 className="size-5" />,
  polar: <CreditCard className="size-5" />,
  chatbotx: <Bot className="size-5" />
}
const icon = (id: string): React.ReactNode =>
  ICON[id] ?? (id.includes('ig') ? <Camera className="size-5" /> : <Database className="size-5" />)

function pullLine(row: Row): string {
  const last = row.lastPull
    ? `${t('sources.lastPull', 'last pull')} ${formatBoardTime(row.lastPull.at)}`
    : t('sources.neverPulled', 'never pulled')
  const next = row.canPull
    ? ` · ${t('sources.nextPull', 'next')} ${formatBoardTime(row.nextPullAt)}`
    : ''
  const budget =
    row.graphCallsLeft !== null && row.graphCallsLeft !== undefined
      ? ` · ${t('sources.callsLeft', '{{count}} calls left this hour', { count: row.graphCallsLeft })}`
      : ''
  return last + next + budget
}

function EditKeyDialog({
  row,
  onOpenChange,
  onSaved
}: {
  row: Row | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}): React.ReactNode {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDrafts({})
    setError(null)
  }, [row?.id])
  const save = async (): Promise<void> => {
    if (!row) {
      return
    }
    setBusy(true)
    for (const [name, value] of Object.entries(drafts)) {
      if (!value.trim()) {
        continue
      }
      const res = await window.api.crowsnest.call('setConnectorSecret', row.id, name, value)
      const msg = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
      if (msg) {
        setError(msg)
        setBusy(false)
        return
      }
    }
    setBusy(false)
    onSaved()
    onOpenChange(false)
  }
  const dirty = Object.values(drafts).some((v) => v.trim())
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent data-testid="cp2-key-dialog" className="sm:max-w-lg">
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">
            {t('sources.editKeyTitle', 'Edit key · {{name}}', { name: row?.label })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'sources.editKeyBody',
              'Paste a new key. It replaces the old one; the next pull uses it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {row?.secrets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('boards.vault.noSecrets', 'This source needs no key.')}
            </p>
          ) : null}
          {row?.secrets.map((s) => (
            <div key={s.name} className="space-y-2">
              <Label htmlFor={`cp2-${s.name}`} className="text-xs">
                {s.label}
              </Label>
              <Input
                id={`cp2-${s.name}`}
                type="password"
                autoComplete="off"
                placeholder={
                  s.source === 'none'
                    ? t('boards.vault.secretMissing', 'not set')
                    : t('sources.saved', '•••••••• (saved)')
                }
                value={drafts[s.name] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                disabled={busy}
              />
            </div>
          ))}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground/70">
            <Lock className="size-3 shrink-0" />
            {t(
              'sources.sealed',
              "Keys are sealed with this Mac's Keychain, never stored as plain text."
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('boards.agents.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || busy}>
            {busy ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {t('sources.saving', 'Saving…')}
              </>
            ) : (
              t('sources.saveKey', 'Save key')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Actions({
  row,
  onEdit,
  reload,
  compact
}: {
  row: Row
  onEdit: () => void
  reload: () => void
  compact?: boolean
}): React.ReactNode {
  const [busy, setBusy] = useState(false)
  const variant = compact ? 'ghost' : 'outline'
  return (
    <>
      <Button
        size="xs"
        variant={variant}
        disabled={busy || !row.canPull}
        onClick={async () => {
          setBusy(true)
          await window.api.crowsnest.call('pullAgain', row.id)
          setBusy(false)
          reload()
        }}
      >
        {t('boards.vault.pull', 'Pull again')}
      </Button>
      <Button size="xs" variant={variant} data-testid="cp2-edit-key" onClick={onEdit}>
        {t('sources.editKey', 'Edit key')}
      </Button>
    </>
  )
}

export function Cp2SourcesPane(): React.ReactNode {
  const v = useCp2('vault')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const reload = (): void => {
    void window.api.crowsnest.call('getVaultBoard').then((r) => setRows(r.ok ? r.value : []))
  }
  useEffect(reload, [])
  if (!rows) {
    return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
  }
  return (
    <div data-testid="cp2-sources" data-variant={v} className="space-y-3">
      {v === 'A' ? (
        rows.map((row) => {
          const problem = vaultProblem(row)
          return (
            <IntegrationCardShell
              key={row.id}
              icon={icon(row.id)}
              name={row.label}
              description={pullLine(row)}
              statusLabel={STATE_LABELS[row.state]()}
              statusTone={TONE[row.state]}
              actions={<Actions row={row} onEdit={() => setEditing(row)} reload={reload} />}
            >
              {problem ? (
                <IntegrationCardDetails>
                  <p className="text-xs">
                    <span className={row.state === 'error' ? 'text-destructive' : ''}>
                      {problem.what}
                    </span>{' '}
                    <span className="text-muted-foreground">{problem.fix}</span>
                  </p>
                </IntegrationCardDetails>
              ) : null}
            </IntegrationCardShell>
          )
        })
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => {
            const problem = vaultProblem(row)
            return (
              <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                <span className="shrink-0 text-muted-foreground">{icon(row.id)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{row.label}</span>
                    <IntegrationStatusPill tone={TONE[row.state]}>
                      {STATE_LABELS[row.state]()}
                    </IntegrationStatusPill>
                  </div>
                  <p className="truncate font-mono text-2xs text-muted-foreground">
                    {problem ? problem.what : pullLine(row)}
                  </p>
                </div>
                <Actions row={row} onEdit={() => setEditing(row)} reload={reload} compact />
              </div>
            )
          })}
        </div>
      )}
      <EditKeyDialog row={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={reload} />
    </div>
  )
}
