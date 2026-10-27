import React, { useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { DataTable, type DataColumn } from './kit/DataTable'
import { useBoardLoad } from './use-board-load'

type Token = EngineCallValue<'listMcpTokens'>[number]
type NewToken = EngineCallValue<'createMcpToken'>
type JournalRow = EngineCallValue<'listAgentActions'>[number]

// Each call writes a pending row and an outcome row, so the bridge's 500-row cap holds about 250 calls.
const JOURNAL_ROW_LIMIT = 500
const ALL_CALLERS = '*'

const mono = (text: string) => (
  <span className="font-mono text-xs tabular-nums text-muted-foreground">{text}</span>
)

const loadTokens = () => window.api.crowsnest.call('listMcpTokens')
const loadJournal = () => window.api.crowsnest.call('listAgentActions', JOURNAL_ROW_LIMIT)

/** Rows arrive newest first, so the first row seen per call is its outcome, or its pending row while unfinished. */
export function latestPerCall(rows: JournalRow[]): JournalRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.callId)) {
      return false
    }
    seen.add(row.callId)
    return true
  })
}

export type CallRow = JournalRow & { startedAt: string }

/** One row per call: its newest row's result, timed from its oldest row. */
export function groupByCall(rows: JournalRow[]): CallRow[] {
  const startedAt = new Map<string, string>()
  for (const row of rows) {
    startedAt.set(row.callId, row.at)
  }
  return latestPerCall(rows).map((row) => ({
    ...row,
    startedAt: startedAt.get(row.callId) ?? row.at
  }))
}

const took = (row: CallRow): string => {
  if (row.result === 'pending') {
    return '-'
  }
  const ms = Date.parse(row.at) - Date.parse(row.startedAt)
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const journalColumns = (): DataColumn<CallRow>[] => [
  {
    id: 'time',
    header: translate('boards.agents.time', 'Time'),
    cell: (row) => mono(formatBoardTime(row.startedAt))
  },
  {
    id: 'caller',
    header: translate('boards.agents.caller', 'Agent'),
    cell: (row) => <span className="font-mono text-xs">{row.caller}</span>
  },
  {
    id: 'tool',
    header: translate('boards.agents.tool', 'Tool'),
    cell: (row) => <span className="font-mono text-xs">{row.tool}</span>
  },
  {
    id: 'gate',
    header: translate('boards.agents.gate', 'Gate'),
    cell: (row) => mono(row.gate)
  },
  {
    id: 'result',
    header: translate('boards.agents.result', 'Result'),
    cell: (row) => (
      <span
        className={cn(
          'font-mono text-xs',
          row.result === 'error' && 'text-destructive',
          row.result === 'pending' && 'text-muted-foreground'
        )}
      >
        {row.result === 'pending' ? translate('boards.agents.pending', 'pending') : row.result}
      </span>
    )
  },
  {
    id: 'took',
    align: 'end',
    header: translate('boards.agents.took', 'Took'),
    cell: (row) => mono(took(row))
  },
  {
    id: 'draft',
    header: translate('boards.agents.draft', 'Draft'),
    cell: (row) => mono(row.draftId ?? '-')
  }
]

export function sortTokens(tokens: Token[]): Token[] {
  return [...tokens].sort(
    (a, b) =>
      Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
      b.createdAt.localeCompare(a.createdAt)
  )
}

function SectionHeader({
  title,
  onRefresh,
  children
}: {
  title: string
  onRefresh: () => void
  children?: React.ReactNode
}): React.ReactNode {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="flex flex-1 items-center gap-2">{children}</div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={translate('boards.refresh', 'Refresh')}
        onClick={onRefresh}
      >
        <RefreshCw />
      </Button>
    </div>
  )
}

function NewTokenReveal({ created, onDone }: { created: NewToken; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      data-testid="agents-new-token"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <p className="text-xs text-muted-foreground">
        {translate(
          'boards.agents.newTokenOnce',
          'Token for {{name}}. Copy it now: the app shows it only once.',
          { name: created.name }
        )}
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="agents-new-token-value"
          className="min-w-0 flex-1 truncate font-mono text-xs select-all"
        >
          {created.token}
        </code>
        <Button
          data-testid="agents-new-token-copy"
          variant="outline"
          size="xs"
          onClick={() => {
            void window.api.ui
              .writeClipboardText(created.token)
              .then(() => setCopied(true))
              .catch(() => {})
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied
            ? translate('boards.agents.copied', 'Copied')
            : translate('boards.agents.copy', 'Copy')}
        </Button>
        <Button data-testid="agents-new-token-done" size="xs" onClick={onDone}>
          {translate('boards.agents.done', 'Done')}
        </Button>
      </div>
    </div>
  )
}

function TokenActions({ token, onRevoked }: { token: Token; onRevoked: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revoke = async (): Promise<void> => {
    const res = await window.api.crowsnest.call('revokeMcpToken', token.id)
    setConfirming(false)
    if (res.ok) {
      onRevoked()
    } else {
      setError(res.error.message)
    }
  }
  if (token.revokedAt) {
    return (
      <span className="font-mono text-2xs text-muted-foreground">
        {translate('boards.agents.revokedAt', 'revoked {{at}}', {
          at: formatBoardTime(token.revokedAt)
        })}
      </span>
    )
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex justify-end gap-1">
        {confirming ? (
          <>
            <Button
              data-testid="agents-revoke-confirm"
              variant="destructive"
              size="xs"
              onClick={() => void revoke()}
            >
              {translate('boards.agents.revokeConfirm', 'Revoke {{name}}', { name: token.name })}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
              {translate('boards.agents.cancel', 'Cancel')}
            </Button>
          </>
        ) : (
          <Button
            data-testid="agents-revoke"
            variant="outline"
            size="xs"
            onClick={() => setConfirming(true)}
          >
            {translate('boards.agents.revoke', 'Revoke')}
          </Button>
        )}
      </span>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  )
}

const tokenColumns = (onRevoked: () => void): DataColumn<Token>[] => [
  {
    id: 'name',
    header: translate('boards.agents.tokenColumn', 'Name'),
    cell: (token) => (
      <span className={token.revokedAt ? 'text-muted-foreground line-through' : ''}>
        {token.name}
      </span>
    )
  },
  {
    id: 'created',
    header: translate('boards.agents.createdAt', 'Created'),
    cell: (token) => mono(formatBoardTime(token.createdAt))
  },
  {
    id: 'lastUsed',
    header: translate('boards.agents.lastUsed', 'Last used'),
    cell: (token) => mono(token.lastUsedAt ? formatBoardTime(token.lastUsedAt) : '-')
  },
  {
    id: 'actions',
    align: 'end',
    header: '',
    cell: (token) => <TokenActions token={token} onRevoked={onRevoked} />
  }
]

function TokensSection() {
  const { state, retry } = useBoardLoad(loadTokens)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<NewToken | null>(null)
  const [error, setError] = useState<string | null>(null)
  const create = async (): Promise<void> => {
    setError(null)
    const res = await window.api.crowsnest.call('createMcpToken', name)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setName('')
    setCreated(res.value)
    retry()
  }
  return (
    <section data-testid="agents-tokens" className="flex min-h-32 flex-col gap-2">
      <SectionHeader title={translate('boards.agents.tokens', 'MCP tokens')} onRefresh={retry}>
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Input
            data-testid="agents-token-name"
            density="compact"
            className="w-48"
            placeholder={translate('boards.agents.tokenName', 'agent name')}
            aria-label={translate('boards.agents.tokenName', 'agent name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            data-testid="agents-token-create"
            type="submit"
            size="xs"
            disabled={name.trim() === ''}
          >
            {translate('boards.agents.create', 'Create')}
          </Button>
        </form>
      </SectionHeader>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {created ? <NewTokenReveal created={created} onDone={() => setCreated(null)} /> : null}
      <div className="min-h-16 flex-1">
        <BoardStates
          state={state}
          retry={retry}
          emptyMessage={translate('boards.agents.noTokens', 'No tokens yet.')}
        >
          {(tokens) => (
            <DataTable
              testId="agents-token-table"
              rowTestId="agents-token-row"
              columns={tokenColumns(retry)}
              rows={sortTokens(tokens)}
              rowKey={(token) => token.id}
              rowData={(token) => ({
                'data-token-name': token.name,
                'data-revoked': String(token.revokedAt !== null)
              })}
            />
          )}
        </BoardStates>
      </div>
    </section>
  )
}

function JournalSection() {
  const { state, retry } = useBoardLoad(loadJournal)
  const [caller, setCaller] = useState(ALL_CALLERS)
  const callers =
    state.status === 'ready' ? [...new Set(state.rows.map((row) => row.caller))].sort() : []
  return (
    <section data-testid="agents-journal" className="flex min-h-48 flex-col gap-2">
      <SectionHeader title={translate('boards.agents.journal', 'Journal')} onRefresh={retry}>
        {callers.length > 0 ? (
          <ToggleGroup
            data-testid="agents-caller-filter"
            type="single"
            variant="segmented"
            size="xs"
            spacing={1}
            value={caller}
            onValueChange={(next) => setCaller(next || ALL_CALLERS)}
            aria-label={translate('boards.agents.filterByCaller', 'Filter by agent')}
            className="ml-auto flex-wrap"
          >
            <ToggleGroupItem value={ALL_CALLERS}>
              {translate('boards.agents.allCallers', 'all')}
            </ToggleGroupItem>
            {callers.map((name) => (
              <ToggleGroupItem key={name} value={name} data-testid="agents-caller-option">
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </SectionHeader>
      <div className="min-h-16 flex-1">
        <BoardStates
          state={state}
          retry={retry}
          emptyMessage={translate('boards.agents.noActions', 'No agent has called yet.')}
        >
          {(rows) => (
            <DataTable
              testId="agents-journal-table"
              rowTestId="agents-journal-row"
              columns={journalColumns()}
              rows={groupByCall(rows).filter(
                (row) => caller === ALL_CALLERS || row.caller === caller
              )}
              rowKey={(row) => row.callId}
              rowData={(row) => ({
                'data-caller': row.caller,
                'data-tool': row.tool,
                'data-result': row.result,
                'data-call-id': row.callId
              })}
            />
          )}
        </BoardStates>
      </div>
    </section>
  )
}

export function AgentsBoard(): React.ReactNode {
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-8 overflow-auto px-6 py-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">{translate('boards.agents.title', 'Agents')}</h1>
        <p className="text-sm text-muted-foreground">
          {translate(
            'boards.agents.subtitle',
            'Every MCP call an agent made, one row per call, and the tokens agents connect with. Lead Studio never calls a model itself.'
          )}
        </p>
      </header>
      <JournalSection />
      <TokensSection />
    </div>
  )
}
