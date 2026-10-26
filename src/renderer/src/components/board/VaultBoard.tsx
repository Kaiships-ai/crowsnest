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

const STATE_LABELS: Record<VaultRow['state'], () => string> = {
  running: () => translate('boards.vault.state.running', 'chạy'),
  error: () => translate('boards.vault.state.error', 'lỗi'),
  stale: () => translate('boards.vault.state.stale', 'cũ'),
  'not-connected': () => translate('boards.vault.state.notConnected', 'chưa nối'),
  partial: () => translate('boards.vault.state.partial', 'partial')
}

/** The last problem in plain words and how to fix it, or null when the source is fine. */
export function vaultProblem(row: VaultRow): { what: string; fix: string } | null {
  const missing = row.missing.join(', ')
  const detail = row.lastPull?.detail ?? ''
  switch (row.state) {
    case 'running':
      return null
    case 'not-connected':
      return row.missing.length > 0
        ? {
            what: translate('boards.vault.problem.missing', 'Thiếu {{missing}}.', { missing }),
            fix: translate('boards.vault.fix.missing', 'Bấm Sửa và nhập {{missing}}.', { missing })
          }
        : {
            what: translate('boards.vault.problem.noAdapter', 'App chưa có bộ nối cho nguồn này.'),
            fix: translate(
              'boards.vault.fix.noAdapter',
              'Có thể lưu khoá trước bằng Sửa; app sẽ kéo khi có bộ nối.'
            )
          }
    case 'error':
      return {
        what: detail || translate('boards.vault.problem.error', 'Lần kéo cuối bị lỗi.'),
        fix: translate(
          'boards.vault.fix.error',
          'Bấm Kiểm tra để xem kết nối, sửa khoá bằng Sửa, rồi Kéo lại.'
        )
      }
    case 'partial':
      return {
        what: translate(
          'boards.vault.problem.partial',
          'Lần kéo thiếu ({{detail}}), nên số cũ được giữ.',
          { detail }
        ),
        fix: translate('boards.vault.fix.partial', 'Kéo lại sau, khi nguồn hết giới hạn.')
      }
    case 'stale':
      return {
        what: row.lastPull
          ? translate('boards.vault.problem.stale', 'Chưa có lần kéo đủ từ 05:00 hôm nay.')
          : translate('boards.vault.problem.never', 'Chưa kéo lần nào.'),
        fix: translate('boards.vault.fix.stale', 'Bấm Kéo lại, hoặc đợi lần kéo 05:00.')
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
        {translate('boards.vault.save', 'Lưu')}
      </Button>
      <span
        data-testid="vault-secret-status"
        className="col-start-2 font-mono text-2xs text-muted-foreground"
      >
        {secret.source === 'none'
          ? translate('boards.vault.secretMissing', 'chưa có')
          : translate('boards.vault.secretSaved', 'đã lưu · nguồn {{source}}', {
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
            text: res.value.message ?? translate('boards.vault.testOk', 'Kết nối được.')
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
          {translate('boards.vault.test', 'Kiểm tra')}
        </Button>
        <Button
          data-testid="vault-pull"
          variant="outline"
          size="xs"
          disabled={busy !== null || !row.canPull}
          onClick={() => void pull()}
        >
          {translate('boards.vault.pull', 'Kéo lại')}
        </Button>
        <Button
          data-testid="vault-edit"
          variant={editing ? 'secondary' : 'ghost'}
          size="xs"
          aria-expanded={editing}
          onClick={onEdit}
        >
          {translate('boards.vault.edit', 'Sửa')}
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
              {translate('boards.vault.noSecrets', 'Nguồn này không cần khoá.')}
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
      emptyMessage={translate('boards.vault.empty', 'Chưa có nguồn nào.')}
    >
      {(rows) => (
        <div className="scrollbar-sleek grid h-full grid-cols-[1fr_auto_auto_auto_auto_auto] content-start gap-x-6 overflow-auto">
          <div
            data-testid="board-vault-header"
            className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground"
          >
            <span>{translate('boards.vault.source', 'Nguồn')}</span>
            <span>{translate('boards.vault.state.column', 'Trạng thái')}</span>
            <span>{translate('boards.vault.lastPull', 'Lần kéo cuối')}</span>
            <span>{translate('boards.vault.nextPull', 'Lần kéo tới')}</span>
            <span className="text-right">
              {translate('boards.vault.graphLeft', 'Graph còn/giờ')}
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
