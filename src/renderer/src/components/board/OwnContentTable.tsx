import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from './board-time'
import { formatCount, ReadingValue, SourceLabel, type Reading } from './funnel-reading'
import {
  AFTER_COLUMNS,
  AfterValue,
  capturedAt,
  columnLabel,
  INSTAGRAM,
  valueOf,
  type OwnPostCard
} from './own-reading'

type OwnBoardData = EngineCallValue<'getOwnBoard'>

const IG_COLUMNS = ['views', 'likes', 'comments', 'shares', 'saved'] as const

const SORTS: { key: string; value: (post: OwnPostCard) => number }[] = [
  { key: 'latest', value: (post) => Date.parse(post.postedAt) },
  ...IG_COLUMNS.map((key) => ({ key, value: (post: OwnPostCard) => valueOf(post.ig[key]) ?? -1 })),
  ...AFTER_COLUMNS.map(({ key }) => ({
    key,
    value: (post: OwnPostCard) => valueOf(post.after[key]) ?? -1
  }))
]

function sourceTitle(
  reading: Reading | OwnPostCard['after']['dm'],
  source: string
): string | undefined {
  const at = capturedAt(reading)
  return at ? `${source} · ${formatBoardTime(at)}` : undefined
}

export function OwnContentTable({
  board,
  onOpen
}: {
  board: OwnBoardData
  onOpen: (id: string) => void
}) {
  const [sort, setSort] = useState(SORTS[0])
  const posts = [...board.posts].sort((a, b) => sort.value(b) - sort.value(a))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {SORTS.map((s) => (
          <Button
            key={s.key}
            data-testid={`own-sort-${s.key}`}
            variant={sort.key === s.key ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setSort(s)}
          >
            {columnLabel(s.key)}
          </Button>
        ))}
      </div>
      <SourceLabel source={INSTAGRAM} at={capturedAt(board.totals.views)} />
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('boards.own.noPosts', 'No posts in this range.')}
        </p>
      ) : (
        <div className="grid grid-cols-[1fr_repeat(8,auto)] content-start gap-x-5">
          <div
            data-testid="own-content-header"
            className="col-span-full grid grid-cols-subgrid border-b border-border py-1 font-mono text-2xs text-muted-foreground"
          >
            <span>{translate('boards.own.post', 'Post')}</span>
            {IG_COLUMNS.map((key) => (
              <span key={key} className="text-right">
                {columnLabel(key)}
                <br />
                {INSTAGRAM}
              </span>
            ))}
            {AFTER_COLUMNS.map((c) => (
              <span key={c.key} className="text-right">
                {columnLabel(c.key)}
                <br />
                {c.source}
              </span>
            ))}
          </div>
          {posts.map((post) => (
            <div
              key={post.ownPostId}
              data-testid="own-post-row"
              data-post-id={post.ownPostId}
              data-pull-error={post.pullError ? 'true' : undefined}
              className="col-span-full grid grid-cols-subgrid items-center border-b border-border py-1.5 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <button
                  type="button"
                  data-testid="own-open-reel"
                  className="truncate text-left hover:underline"
                  onClick={() => onOpen(post.ownPostId)}
                >
                  {post.caption?.split('\n')[0] || post.format}
                </button>
                <span className="font-mono text-2xs text-muted-foreground">
                  {formatBoardTime(post.postedAt)}
                  {post.keyword ? ` · ${post.keyword}` : ''}
                </span>
                {post.pullError ? (
                  <span
                    data-testid="own-post-pull-error"
                    title={post.pullError.error}
                    className="font-mono text-2xs text-destructive"
                  >
                    {translate(
                      'boards.own.pullFailedShort',
                      '{{at}} measurement failed, old numbers',
                      {
                        at: formatBoardTime(post.pullError.at)
                      }
                    )}
                  </span>
                ) : null}
              </span>
              {IG_COLUMNS.map((key) => (
                <span
                  key={key}
                  className="text-right text-xs"
                  title={sourceTitle(post.ig[key], INSTAGRAM)}
                >
                  <ReadingValue reading={post.ig[key]} format={formatCount} />
                </span>
              ))}
              {AFTER_COLUMNS.map((c) => (
                <span
                  key={c.key}
                  data-testid={`own-after-${c.key}`}
                  data-status={post.after[c.key].status}
                  className="text-right text-xs"
                  title={sourceTitle(post.after[c.key], c.source)}
                >
                  <AfterValue reading={post.after[c.key]} />
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
