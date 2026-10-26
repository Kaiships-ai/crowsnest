import React, { useState } from 'react'
import { ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { BoardStates } from './BoardStates'
import { formatCount, SourceLabel } from './funnel-reading'
import { openPostInBrowser } from './open-post'
import { useBoardLoad } from './use-board-load'

type RivalsBoardData = EngineCallValue<'getRivalsBoard'>
type Post = RivalsBoardData['evidence'][number]['post']

const RADAR = 'Radar'
const ANALYSIS = 'Analysis'

const loadRivals = () =>
  window.api.crowsnest
    .call('getRivalsBoard')
    .then((result) => (result.ok ? { ok: true as const, value: [result.value] } : result))

const count = (value: number | null): string => (value === null ? '-' : formatCount(value))
const score = (value: number | null): string =>
  value === null ? '-' : `${formatCount(Math.round(value * 10) / 10)}×`

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

function OpenPost({ post, testId }: { post: Post; testId: string }): React.ReactNode {
  return (
    <Button
      data-testid={testId}
      data-url={post.url}
      variant="ghost"
      size="xs"
      onClick={() => openPostInBrowser(post.url)}
    >
      <ExternalLink />
      {translate('boards.own.openPost', 'Open original post')}
    </Button>
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
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-6 overflow-auto p-4">
      <header className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl font-medium">{translate('boards.rivals.title', 'Rivals')}</h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.rivals.subtitle',
              "Channels you follow, each channel's outlier posts, and evidence from posts agents analyzed."
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

      <section data-testid="rivals-evidence" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">
            {translate('boards.rivals.evidence', 'Evidence from analyzed posts')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {translate(
              'boards.rivals.evidenceNote',
              "Not split into Take · Learn · Avoid yet: analyses don't record which card a post belongs to."
            )}
          </p>
        </div>
        {board.evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate(
              'boards.rivals.noEvidence',
              'No posts analyzed yet. Agents analyze posts with crowsnest_save_analysis.'
            )}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {board.evidence.map(({ post, analysis }) => (
              <article
                key={post.videoId}
                data-testid="rivals-evidence-card"
                data-video-id={post.videoId}
                className="flex flex-col gap-2 rounded-xl border border-border p-3"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{post.channel.handle}</span>
                  <span
                    data-num
                    className="font-mono text-xs whitespace-nowrap text-muted-foreground"
                  >
                    {score(post.outlierScore)} · {count(post.viewCount)}
                  </span>
                </div>
                {analysis.hookType ? <Badge variant="secondary">{analysis.hookType}</Badge> : null}
                <p className="line-clamp-4 text-sm">{analysis.whyItWorked ?? analysis.summary}</p>
                {analysis.formatTags.length + analysis.styleTags.length > 0 ? (
                  <span className="font-mono text-2xs text-muted-foreground">
                    {[...analysis.formatTags, ...analysis.styleTags].join(' · ')}
                  </span>
                ) : null}
                <div className="mt-auto flex items-center justify-between">
                  <SourceLabel source={ANALYSIS} at={analysis.createdAt} />
                  <OpenPost post={post} testId="rivals-evidence-open" />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {translate('boards.rivals.channels', 'Channels you follow')}
        </h2>
        {board.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate('boards.rivals.noChannels', 'No rivals followed yet. Add a channel above.')}
          </p>
        ) : (
          <div className="grid grid-cols-[1fr_repeat(3,auto)] content-start gap-x-6">
            <div className="col-span-full grid grid-cols-subgrid border-b border-border py-1 font-mono text-2xs text-muted-foreground">
              <span>{translate('boards.rivals.channel', 'Channel')}</span>
              <span className="text-right">
                {translate('boards.rivals.followers', 'Followers')}
              </span>
              <span className="text-right">
                {translate('boards.rivals.median', 'Median views')}
              </span>
              <span className="text-right">
                {translate('boards.rivals.outliers', 'Over 2× in 30 days')}
              </span>
            </div>
            {board.channels.map((channel) => (
              <div
                key={channel.id}
                data-testid="rivals-channel-row"
                data-handle={channel.handle}
                className="col-span-full grid grid-cols-subgrid items-start border-b border-border py-2 text-sm"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span>
                    {channel.handle}
                    {channel.displayName ? (
                      <span className="ml-2 text-muted-foreground">{channel.displayName}</span>
                    ) : null}
                  </span>
                  <SourceLabel source={RADAR} at={channel.lastSyncedAt ?? undefined} />
                  {channel.syncError ? (
                    <span className="text-xs text-destructive">{channel.syncError}</span>
                  ) : null}
                  {channel.outliers.map((post) => (
                    <span
                      key={post.videoId}
                      data-testid="rivals-outlier"
                      data-video-id={post.videoId}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span data-num className="font-mono">
                        {score(post.outlierScore)}
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {post.caption?.split('\n')[0] ?? post.url}
                      </span>
                      <OpenPost post={post} testId="rivals-outlier-open" />
                    </span>
                  ))}
                </span>
                <span data-num className="text-right font-mono">
                  {count(channel.followerCount)}
                </span>
                <span data-num className="text-right font-mono">
                  {count(channel.medianViews)}
                </span>
                <span data-num className="text-right font-mono">
                  {formatCount(channel.outliers30d)}
                </span>
              </div>
            ))}
          </div>
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
