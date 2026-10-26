import React, { useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { useBoardLoad } from './use-board-load'

type Token = EngineCallValue<'listMcpTokens'>[number]
type NewToken = EngineCallValue<'createMcpToken'>

const JOURNAL_LIMIT = 200
const ALL_CALLERS = '*'

const loadTokens = () => window.api.crowsnest.call('listMcpTokens')
const loadJournal = () => window.api.crowsnest.call('listAgentActions', JOURNAL_LIMIT)

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
    <div className="flex items-center gap-3 px-4 pt-4 pb-2">
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
      className="mx-4 mb-2 flex flex-col gap-2 rounded-md border border-border bg-muted p-3"
    >
      <p className="text-xs text-muted-foreground">
        {translate(
          'boards.agents.newTokenOnce',
          'Token cho {{name}}. Chép ngay: app chỉ hiện token này một lần.',
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
            ? translate('boards.agents.copied', 'Đã chép')
            : translate('boards.agents.copy', 'Chép')}
        </Button>
        <Button data-testid="agents-new-token-done" size="xs" onClick={onDone}>
          {translate('boards.agents.done', 'Xong')}
        </Button>
      </div>
    </div>
  )
}

function TokenRow({ token, onRevoked }: { token: Token; onRevoked: () => void }) {
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
  return (
    <div
      data-testid="agents-token-row"
      data-token-name={token.name}
      data-revoked={token.revokedAt !== null}
      className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-2 text-sm"
    >
      <span className={token.revokedAt ? 'text-muted-foreground line-through' : ''}>
        {token.name}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatBoardTime(token.createdAt)}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {token.lastUsedAt ? formatBoardTime(token.lastUsedAt) : '-'}
      </span>
      <span className="flex justify-end gap-1">
        {token.revokedAt ? (
          <span className="font-mono text-2xs text-muted-foreground">
            {translate('boards.agents.revokedAt', 'đã thu hồi {{at}}', {
              at: formatBoardTime(token.revokedAt)
            })}
          </span>
        ) : confirming ? (
          <>
            <Button
              data-testid="agents-revoke-confirm"
              variant="destructive"
              size="xs"
              onClick={() => void revoke()}
            >
              {translate('boards.agents.revokeConfirm', 'Thu hồi {{name}}', { name: token.name })}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
              {translate('boards.agents.cancel', 'Huỷ')}
            </Button>
          </>
        ) : (
          <Button
            data-testid="agents-revoke"
            variant="outline"
            size="xs"
            onClick={() => setConfirming(true)}
          >
            {translate('boards.agents.revoke', 'Thu hồi')}
          </Button>
        )}
      </span>
      {error ? <p className="col-span-full text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

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
    <section data-testid="agents-tokens" className="flex min-h-32 flex-col">
      <SectionHeader title={translate('boards.agents.tokens', 'Token MCP')} onRefresh={retry}>
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
            placeholder={translate('boards.agents.tokenName', 'tên agent')}
            aria-label={translate('boards.agents.tokenName', 'tên agent')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            data-testid="agents-token-create"
            type="submit"
            size="xs"
            disabled={name.trim() === ''}
          >
            {translate('boards.agents.create', 'Tạo')}
          </Button>
        </form>
      </SectionHeader>
      {error ? <p className="px-4 pb-2 text-xs text-destructive">{error}</p> : null}
      {created ? <NewTokenReveal created={created} onDone={() => setCreated(null)} /> : null}
      <div className="min-h-16 flex-1">
        <BoardStates
          state={state}
          retry={retry}
          emptyMessage={translate('boards.agents.noTokens', 'Chưa có token nào.')}
        >
          {(tokens) => (
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6">
              <div className="col-span-full grid grid-cols-subgrid border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground">
                <span>{translate('boards.agents.tokenColumn', 'Tên')}</span>
                <span>{translate('boards.agents.createdAt', 'Tạo lúc')}</span>
                <span>{translate('boards.agents.lastUsed', 'Dùng lần cuối')}</span>
                <span />
              </div>
              {sortTokens(tokens).map((token) => (
                <TokenRow key={token.id} token={token} onRevoked={retry} />
              ))}
            </div>
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
    <section data-testid="agents-journal" className="flex min-h-48 flex-1 flex-col">
      <SectionHeader title={translate('boards.agents.journal', 'Nhật ký')} onRefresh={retry}>
        {callers.length > 0 ? (
          <ToggleGroup
            data-testid="agents-caller-filter"
            type="single"
            variant="segmented"
            size="xs"
            spacing={1}
            value={caller}
            onValueChange={(next) => setCaller(next || ALL_CALLERS)}
            aria-label={translate('boards.agents.filterByCaller', 'Lọc theo agent')}
            className="ml-auto flex-wrap"
          >
            <ToggleGroupItem value={ALL_CALLERS}>
              {translate('boards.agents.allCallers', 'tất cả')}
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
          emptyMessage={translate('boards.agents.noActions', 'Agent chưa gọi lần nào.')}
        >
          {(rows) => (
            <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-x-6">
              <div className="col-span-full grid grid-cols-subgrid border-b border-border px-4 py-1 font-mono text-2xs text-muted-foreground">
                <span>{translate('boards.agents.time', 'Lúc')}</span>
                <span>{translate('boards.agents.caller', 'Agent')}</span>
                <span>{translate('boards.agents.tool', 'Công cụ')}</span>
                <span>{translate('boards.agents.gate', 'Cổng')}</span>
                <span>{translate('boards.agents.result', 'Kết quả')}</span>
                <span>{translate('boards.agents.draft', 'Bản nháp')}</span>
              </div>
              {rows
                .filter((row) => caller === ALL_CALLERS || row.caller === caller)
                .map((row) => (
                  <div
                    key={row.id}
                    data-testid="agents-journal-row"
                    data-caller={row.caller}
                    data-tool={row.tool}
                    className="col-span-full grid grid-cols-subgrid items-center border-b border-border px-4 py-1.5 text-sm"
                  >
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatBoardTime(row.at)}
                    </span>
                    <span className="font-mono text-xs">{row.caller}</span>
                    <span className="min-w-0 truncate font-mono text-xs">{row.tool}</span>
                    <span className="font-mono text-xs text-muted-foreground">{row.gate}</span>
                    <span
                      className={
                        row.result === 'error'
                          ? 'font-mono text-xs text-destructive'
                          : 'font-mono text-xs'
                      }
                    >
                      {row.result}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.draftId ?? '-'}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </BoardStates>
      </div>
    </section>
  )
}

export function AgentsBoard(): React.ReactNode {
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-auto">
      <TokensSection />
      <JournalSection />
    </div>
  )
}
