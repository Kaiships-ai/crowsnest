import React, { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatBoardTime } from './board-time'
import { formatCount } from './funnel-reading'
import { DataTable, type DataColumn } from './kit/DataTable'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import { count, EvidenceBlock, newestAt, OpenPost, score, type Post } from './RivalsEvidence'
import { useBoardLoad } from './use-board-load'

type RivalsBoardData = EngineCallValue<'getRivalsBoard'>
type OutlierRow = { channel: RivalsBoardData['channels'][number]; post: Post }

const RADAR = 'Radar'

const loadRivals = () =>
  window.api.crowsnest
    .call('getRivalsBoard')
    .then((result) => (result.ok ? { ok: true as const, value: [result.value] } : result))

type AddState =
  | { status: 'idle' }
  | { status: 'adding' }
  | { status: 'done' | 'error'; message: string }

function AddChannel({
  add,
  setAdd,
  onAdded
}: {
  add: AddState
  setAdd: (add: AddState) => void
  onAdded: () => void
}): React.ReactNode {
  const [handle, setHandle] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const typed = handle.trim()
    if (!typed) {
      return
    }
    setAdd({ status: 'adding' })
    const result = await window.api.crowsnest.call('addChannelAction', typed, {
      requireProfile: true
    })
    const outcome = result.ok ? result.value : { ok: false as const, error: result.error.message }
    if (!outcome.ok) {
      setAdd({ status: 'error', message: outcome.error })
      return
    }
    setHandle('')
    setAdd({
      status: 'done',
      message: translate(
        'boards.rivals.added',
        'Added {{handle}}. Its posts and outliers appear after Radar reads the channel.',
        {
          handle: typed
        }
      )
    })
    onAdded()
  }
  return (
    <form onSubmit={submit}>
      <div className="flex gap-2">
        <Input
          data-testid="rivals-add-input"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder={translate('boards.rivals.handle', '@handle or channel link')}
          className="w-56"
        />
        <Button
          data-testid="rivals-add-submit"
          type="submit"
          size="sm"
          disabled={add.status === 'adding'}
        >
          <Plus />
          {translate('boards.rivals.add', 'Add rival')}
        </Button>
      </div>
    </form>
  )
}

const CHANNEL_COLUMNS = (): DataColumn<RivalsBoardData['channels'][number]>[] => [
  {
    id: 'channel',
    header: translate('boards.rivals.channel', 'Channel'),
    cell: (channel) => (
      <span className="flex min-w-0 flex-col">
        <span>
          {channel.handle}
          {channel.displayName ? (
            <span className="ml-2 text-muted-foreground">{channel.displayName}</span>
          ) : null}
        </span>
        {channel.syncError ? (
          <span data-testid="rivals-sync-error" className="text-xs text-destructive">
            {channel.syncError}
          </span>
        ) : null}
      </span>
    )
  },
  {
    id: 'followers',
    align: 'end',
    header: translate('boards.rivals.followers', 'Followers'),
    cell: (channel) => <Num>{count(channel.followerCount)}</Num>
  },
  {
    id: 'median',
    align: 'end',
    header: translate('boards.rivals.median', 'Median views'),
    cell: (channel) => <Num>{count(channel.medianViews)}</Num>
  },
  {
    id: 'outliers',
    align: 'end',
    header: translate('boards.rivals.outliers', 'Over 2× in 30 days'),
    cell: (channel) => <Num>{formatCount(channel.outliers30d)}</Num>
  },
  {
    id: 'synced',
    align: 'end',
    header: translate('boards.rivals.synced', 'Read'),
    cell: (channel) => (
      <span className="font-mono text-2xs text-muted-foreground">
        {channel.lastSyncedAt ? formatBoardTime(channel.lastSyncedAt) : '-'}
      </span>
    )
  }
]

const OUTLIER_COLUMNS = (): DataColumn<OutlierRow>[] => [
  {
    id: 'score',
    align: 'end',
    header: translate('boards.rivals.score', 'Score'),
    cell: ({ post }) => <Num>{score(post.outlierScore)}</Num>
  },
  {
    id: 'channel',
    header: translate('boards.rivals.channel', 'Channel'),
    cell: ({ channel }) => <span className="font-mono text-xs">{channel.handle}</span>
  },
  {
    id: 'post',
    header: translate('boards.rivals.post', 'Post'),
    cell: ({ post }) => (
      <span className="block max-w-96 truncate text-muted-foreground">
        {post.caption?.split('\n')[0] ?? post.url}
      </span>
    )
  },
  {
    id: 'views',
    align: 'end',
    header: translate('boards.rivals.views', 'Views'),
    cell: ({ post }) => <Num>{count(post.viewCount)}</Num>
  },
  {
    id: 'open',
    align: 'end',
    header: '',
    cell: ({ post }) => <OpenPost post={post} testId="rivals-outlier-open" />
  }
]

function Num({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <span data-num className="font-mono text-xs tabular-nums">
      {children}
    </span>
  )
}

function RivalsView({
  board,
  reload,
  add,
  setAdd
}: {
  board: RivalsBoardData
  reload: () => void
  add: AddState
  setAdd: (add: AddState) => void
}): React.ReactNode {
  const radarAt = newestAt(board.channels.map((c) => c.lastSyncedAt))
  const outliers = board.channels
    .flatMap((channel) => channel.outliers.map((post) => ({ channel, post })))
    .sort((a, b) => (b.post.outlierScore ?? 0) - (a.post.outlierScore ?? 0))
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-8 overflow-auto px-6 py-5">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">{translate('boards.rivals.title', 'Rivals')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.rivals.subtitle',
              'What agents filed from rival posts as Take, Learn or Avoid, with the post as evidence, and the outliers they work from.'
            )}
          </p>
        </div>
        <AddChannel add={add} setAdd={setAdd} onAdded={reload} />
        <Button
          data-testid="board-refresh"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('boards.refresh', 'Refresh')}
          onClick={reload}
        >
          <RefreshCw />
        </Button>
      </header>
      {add.status === 'done' || add.status === 'error' ? (
        <p
          data-testid="rivals-add-message"
          data-status={add.status}
          className={
            add.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {add.message}
        </p>
      ) : null}

      <EvidenceBlock evidence={board.evidence} />

      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.rivals.outlierTitle', 'Outliers, last 30 days')}>
          <SourceTag sources={[RADAR]} at={radarAt} />
        </BlockHeader>
        {outliers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.rivals.noOutliers',
              'No rival post is over 2× its channel median yet.'
            )}
          </p>
        ) : (
          <DataTable
            testId="rivals-outliers"
            rowTestId="rivals-outlier"
            columns={OUTLIER_COLUMNS()}
            rows={outliers}
            rowKey={({ post }) => post.videoId}
            rowData={({ post, channel }) => ({
              'data-video-id': post.videoId,
              'data-handle': channel.handle
            })}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <BlockHeader title={translate('boards.rivals.channels', 'Channels you follow')}>
          <SourceTag sources={[RADAR]} at={radarAt} />
        </BlockHeader>
        {board.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate('boards.rivals.noChannels', 'No rivals followed yet. Add a channel above.')}
          </p>
        ) : (
          <DataTable
            testId="rivals-channels"
            rowTestId="rivals-channel-row"
            columns={CHANNEL_COLUMNS()}
            rows={board.channels}
            rowKey={(channel) => channel.handle}
            rowData={(channel) => ({ 'data-handle': channel.handle })}
          />
        )}
      </section>
    </div>
  )
}

export function RivalsBoard(): React.ReactNode {
  const { state, retry } = useBoardLoad(loadRivals)
  const [add, setAdd] = useState<AddState>({ status: 'idle' })
  return (
    <BoardStates state={state} retry={retry} emptyMessage="">
      {([board]) => <RivalsView board={board} reload={retry} add={add} setAdd={setAdd} />}
    </BoardStates>
  )
}
