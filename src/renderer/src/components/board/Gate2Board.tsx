import React, { useState } from 'react'
import { Check, Send, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import { coverSrc, PublishChecks } from './publish-checks'
import { useBoardLoad } from './use-board-load'

type Gate2Data = EngineCallValue<'getGate2Board'>
type Item = Gate2Data['pending'][number]

const rowsUnlessEmpty = (board: Gate2Data): Gate2Data[] =>
  board.pending.length || board.decided.length ? [board] : []

const loadGate2 = () =>
  window.api.crowsnest
    .call('getGate2Board')
    .then((result) =>
      result.ok ? { ok: true as const, value: rowsUnlessEmpty(result.value) } : result
    )

const whenLabel = (at: string): string =>
  at === 'now'
    ? translate('gate2.publishNow', 'Publish right after approval')
    : translate('gate2.publishAt', 'Publish at {{time}}', { time: at.replace('T', ' ') })

function DraftCard({ item, reload }: { item: Item; reload: () => void }): React.ReactNode {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(item.lastError)
  const publish = item.publish
  const blocked = publish
    ? publish.stale || publish.checks.some((c) => c.status === 'missing')
    : true

  const decide = async (kind: 'approve' | 'reject'): Promise<void> => {
    setBusy(kind)
    setError(null)
    const res = await window.api.crowsnest.call(
      kind === 'approve' ? 'approveGateDraft' : 'rejectGateDraft',
      item.id
    )
    setBusy(null)
    const message = !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
    if (message) {
      setError(message)
    }
    reload()
  }

  return (
    <article
      data-testid="gate2-draft"
      data-draft-id={item.id}
      data-tool={item.tool}
      className="flex flex-col gap-3 rounded-2xl border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-base font-medium">
          {publish
            ? translate('gate2.publishTitle', 'Publish "{{title}}"', { title: publish.title })
            : item.tool}
        </h3>
        <span className="font-mono text-2xs text-muted-foreground">
          {translate('gate2.proposed', 'proposed by {{who}} · {{time}}', {
            who: item.caller,
            time: formatBoardTime(item.createdAt)
          })}
        </span>
      </header>
      {publish ? (
        <div className="grid grid-cols-[7rem_1fr] gap-4">
          <img
            data-testid="gate2-cover"
            src={publish.coverAssetId ? coverSrc(publish.coverAssetId) : undefined}
            alt={translate('gate2.coverAlt', 'Cover')}
            className="aspect-[9/16] w-28 rounded-lg border border-border bg-muted object-cover"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-sm">
              <dt className="font-mono text-2xs text-muted-foreground">
                {translate('gate2.what', 'Does')}
              </dt>
              <dd data-testid="gate2-what">{whenLabel(publish.at)}</dd>
              <dt className="font-mono text-2xs text-muted-foreground">
                {translate('gate2.to', 'To')}
              </dt>
              <dd data-testid="gate2-to">{publish.to}</dd>
            </dl>
            <PublishChecks checks={publish.checks} />
            {publish.stale ? (
              <p data-testid="gate2-stale" className="text-xs text-destructive">
                {translate(
                  'gate2.stale',
                  "The reel's video, caption or cover changed after this draft. Reject it and send the reel again."
                )}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <pre className="scrollbar-sleek overflow-auto rounded-lg bg-muted p-2 font-mono text-2xs">
          {JSON.stringify(item.rawInput, null, 2)}
        </pre>
      )}
      {error ? (
        <p data-testid="gate2-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <footer className="flex justify-end gap-2">
        <Button
          data-testid="gate2-reject"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void decide('reject')}
        >
          <X />
          {translate('gate2.reject', 'Reject')}
        </Button>
        <Button
          data-testid="gate2-approve"
          size="sm"
          disabled={busy !== null || blocked}
          onClick={() => void decide('approve')}
        >
          <Send />
          {busy === 'approve'
            ? translate('gate2.sending', 'Sending…')
            : translate('gate2.approve', 'Approve')}
        </Button>
      </footer>
    </article>
  )
}

function DecidedRow({ item }: { item: Item }): React.ReactNode {
  const approved = item.status === 'approved'
  return (
    <li
      data-testid="gate2-decided"
      data-draft-id={item.id}
      data-status={item.status}
      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
    >
      <span className="min-w-0 truncate">
        {item.publish ? item.publish.title : item.tool}
        <span className="ml-2 font-mono text-2xs text-muted-foreground">
          {translate('gate2.trail', 'proposed by {{proposer}} · {{verdict}} by {{who}} {{time}}', {
            proposer: item.caller,
            verdict: approved
              ? translate('gate2.approved', 'approved')
              : translate('gate2.rejected', 'rejected'),
            who: item.decidedBy ?? '-',
            time: item.decidedAt ? formatBoardTime(item.decidedAt) : ''
          })}
        </span>
      </span>
      <Badge variant="outline" className={approved ? 'text-status-success' : undefined}>
        {approved ? <Check /> : <X />}
        {approved
          ? translate('gate2.approved', 'approved')
          : translate('gate2.rejected', 'rejected')}
      </Badge>
    </li>
  )
}

function Gate2View({ board, reload }: { board: Gate2Data; reload: () => void }): React.ReactNode {
  return (
    <div
      data-testid="gate2-board"
      className="scrollbar-sleek mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-auto px-6 py-5"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium">
          {translate('gate2.title', 'Gate 2 · {{count}} waiting to send', {
            count: board.pending.length
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {translate(
            'gate2.subtitle',
            'Actions that reach people outside. Nothing is sent until you approve it.'
          )}
        </p>
      </div>
      {board.pending.map((item) => (
        <DraftCard key={item.id} item={item} reload={reload} />
      ))}
      {board.decided.length ? (
        <section data-testid="gate2-history" className="flex flex-col gap-2">
          <BlockHeader title={translate('gate2.history', 'Decided')}>
            <SourceTag sources={[translate('gate2.journal', 'Agent journal')]} live />
          </BlockHeader>
          <ul className="flex flex-col">
            {board.decided.map((item) => (
              <DecidedRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export function Gate2Board(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadGate2)
  return (
    <BoardStates
      state={state}
      retry={retry}
      emptyMessage={translate(
        'gate2.empty',
        'Nothing waits to send. Publish a reel from its card in Plan to send it here.'
      )}
    >
      {([board]) => <Gate2View board={board} reload={retry} />}
    </BoardStates>
  )
}
