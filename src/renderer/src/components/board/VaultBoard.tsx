import React, { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { useBoardLoad } from './use-board-load'

type VaultRow = EngineCallValue<'getVaultBoard'>[number]
type Note = { ok: boolean; text: string }

const loadVault = () => window.api.crowsnest.call('getVaultBoard')

export const STATE_LABELS: Record<VaultRow['state'], () => string> = {
  running: () => translate('boards.vault.state.running', 'running'),
  error: () => translate('boards.vault.state.error', 'error'),
  stale: () => translate('boards.vault.state.stale', 'stale'),
  'not-connected': () => translate('boards.vault.state.notConnected', 'not connected'),
  partial: () => translate('boards.vault.state.partial', 'partial')
}

export function vaultProblem(row: VaultRow): { what: string; fix: string } | null {
  const missing = row.missingSecretLabels.join(', ')
  const detail = row.lastPull?.detail ?? ''
  switch (row.state) {
    case 'running':
      return null
    case 'not-connected':
      return row.missingSecretLabels.length > 0
        ? {
            what: translate('boards.vault.problem.missing', 'Missing {{missing}}.', { missing }),
            fix: translate('boards.vault.fix.missing', 'Click Edit and enter {{missing}}.', {
              missing
            })
          }
        : {
            what: translate(
              'boards.vault.problem.noAdapter',
              'The app has no connector for this source yet.'
            ),
            fix: translate(
              'boards.vault.fix.noAdapter',
              'You can save the key now with Edit; the app pulls once a connector exists.'
            )
          }
    case 'error':
      return {
        what: detail || translate('boards.vault.problem.error', 'The last pull failed.'),
        fix: translate(
          'boards.vault.fix.error',
          'Click Test to check the connection, fix the key with Edit, then Pull again.'
        )
      }
    case 'partial':
      return {
        what: translate(
          'boards.vault.problem.partial',
          'The last pull was partial ({{detail}}), so the old numbers are kept.',
          { detail }
        ),
        fix: translate(
          'boards.vault.fix.partial',
          'Pull again later, once the source limit resets.'
        )
      }
    case 'stale':
      return {
        what: row.lastPull
          ? translate('boards.vault.problem.stale', 'No complete pull since 05:00 today.')
          : translate('boards.vault.problem.never', 'Never pulled.'),
        fix: translate('boards.vault.fix.stale', 'Click Pull again, or wait for the 05:00 pull.')
      }
  }
}

function SecretField({
  row,
  secret,
  onSaved
}: {
  row: VaultRow
  secret: VaultRow['secrets'][number]
  onSaved: () => void
}): React.ReactNode {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.api.crowsnest.call('setConnectorSecret', row.id, secret.name, value)
    setBusy(false)
    setValue('')
    if (!res.ok) {
      setError(res.error.message)
    } else if (!res.value.ok) {
      setError(res.value.error)
    } else {
      onSaved()
    }
  }
  return (
    <form
      data-testid="vault-secret-field"
      data-secret-name={secret.name}
      className="grid grid-cols-[10rem_1fr_auto] items-center gap-x-3 gap-y-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <span className="text-sm">{secret.label}</span>
      <Input
        data-testid="vault-secret-input"
        type="password"
        autoComplete="off"
        density="compact"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={secret.label}
      />
      <Button
        data-testid="vault-secret-save"
        type="submit"
        size="xs"
        disabled={busy || value.trim() === ''}
      >
        {translate('boards.vault.save', 'Save')}
      </Button>
      <span
        data-testid="vault-secret-status"
        className="col-start-2 font-mono text-2xs text-muted-foreground"
      >
        {secret.source === 'none'
          ? translate('boards.vault.secretMissing', 'not set')
          : translate('boards.vault.secretSaved', 'saved · source {{source}}', {
              source: secret.source
            })}
      </span>
      {error ? <span className="col-start-2 text-xs text-destructive">{error}</span> : null}
    </form>
  )
}

function VaultRowView({
  row,
  editing,
  note,
  onEdit,
  onNote,
  reload
}: {
  row: VaultRow
  editing: boolean
  note: Note | undefined
  onEdit: () => void
  onNote: (note: Note) => void
  reload: () => void
}): React.ReactNode {
  const [busy, setBusy] = useState<'test' | 'pull' | null>(null)
  const problem = vaultProblem(row)
  const test = async (): Promise<void> => {
    setBusy('test')
    const res = await window.api.crowsnest.call('testConnector', row.id)
    setBusy(null)
    onNote(
      res.ok
        ? {
            ok: res.value.ok,
            text: res.value.message ?? translate('boards.vault.testOk', 'Connected.')
          }
        : { ok: false, text: res.error.message }
    )
  }
  const pull = async (): Promise<void> => {
    setBusy('pull')
    const res = await window.api.crowsnest.call('pullAgain', row.id)
    setBusy(null)
    if (!res.ok) {
      onNote({ ok: false, text: res.error.message })
      return
    }
    reload()
  }
  return (
    <div
      data-testid="vault-row"
      data-connector-id={row.id}
      data-state={row.state}
      className="col-span-full grid grid-cols-subgrid items-center gap-y-2 border-b border-border px-4 py-2 text-sm"
    >
      <span className="min-w-0 truncate text-foreground">{row.label}</span>
      <span>
        <Badge
          data-testid="vault-state"
          variant={row.state === 'error' ? 'destructive' : 'outline'}
          className={cn('font-mono', row.state === 'running' && 'text-status-success')}
        >
          {STATE_LABELS[row.state]()}
        </Badge>
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.lastPull ? formatBoardTime(row.lastPull.at) : '-'}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.canPull ? formatBoardTime(row.nextPullAt) : '-'}
      </span>
      <span className="text-right font-mono text-xs tabular-nums">{row.graphCallsLeft ?? '-'}</span>
      <span className="flex justify-end gap-1">
        <Button
          data-testid="vault-test"
          variant="outline"
          size="xs"
          disabled={busy !== null}
          onClick={() => void test()}
        >
          {translate('boards.vault.test', 'Test')}
        </Button>
        <Button
          data-testid="vault-pull"
          variant="outline"
          size="xs"
          disabled={busy !== null || !row.canPull}
          onClick={() => void pull()}
        >
          {translate('boards.vault.pull', 'Pull again')}
        </Button>
        <Button
          data-testid="vault-edit"
          variant={editing ? 'secondary' : 'ghost'}
          size="xs"
          aria-expanded={editing}
          onClick={onEdit}
        >
          {translate('boards.vault.edit', 'Edit')}
        </Button>
      </span>
      {problem ? (
        <p data-testid="vault-problem" className="col-span-full text-xs text-muted-foreground">
          <span className={cn(row.state === 'error' && 'text-destructive')}>{problem.what}</span>{' '}
          {problem.fix}
        </p>
      ) : null}
      {note ? (
        <p
          data-testid="vault-message"
          className={cn(
            'col-span-full text-xs',
            note.ok ? 'text-muted-foreground' : 'text-destructive'
          )}
        >
          {note.text}
        </p>
      ) : null}
      {editing ? (
        <div data-testid="vault-editor" className="col-span-full flex flex-col gap-3 py-2">
          {row.secrets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate('boards.vault.noSecrets', 'This source needs no key.')}
            </p>
          ) : (
            row.secrets.map((secret) => (
              <SecretField key={secret.name} row={row} secret={secret} onSaved={reload} />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function VaultBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadVault)
  const [editing, setEditing] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, Note>>({})
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate('boards.vault.empty', 'No sources yet.')}
    >
      {(rows) => (
        <div className="scrollbar-sleek grid h-full grid-cols-[1fr_auto_auto_auto_auto_auto] content-start gap-x-6 overflow-auto">
          <div
            data-testid="board-vault-header"
            className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground"
          >
            <span>{translate('boards.vault.source', 'Source')}</span>
            <span>{translate('boards.vault.state.column', 'State')}</span>
            <span>{translate('boards.vault.lastPull', 'Last pull')}</span>
            <span>{translate('boards.vault.nextPull', 'Next pull')}</span>
            <span className="text-right">
              {translate('boards.vault.graphLeft', 'Graph calls left/hr')}
            </span>
            <span className="flex justify-end">
              <Button
                data-testid="board-refresh"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('boards.refresh', 'Refresh')}
                onClick={retry}
              >
                <RefreshCw />
              </Button>
            </span>
          </div>
          {rows.map((row) => (
            <VaultRowView
              key={row.id}
              row={row}
              editing={editing === row.id}
              note={notes[row.id]}
              onEdit={() => setEditing((open) => (open === row.id ? null : row.id))}
              onNote={(note) => setNotes((all) => ({ ...all, [row.id]: note }))}
              reload={retry}
            />
          ))}
        </div>
      )}
    </BoardStates>
  )
}
