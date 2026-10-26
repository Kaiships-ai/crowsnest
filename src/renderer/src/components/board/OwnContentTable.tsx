import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from './board-time'
import { formatCount, ReadingValue } from './funnel-reading'
import { DataTable, type DataColumn } from './kit/DataTable'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import {
  AFTER_COLUMNS,
  AfterValue,
  capturedAt,
  columnLabel,
  INSTAGRAM,
  oldestAt,
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

function PostCell({
  post,
  onOpen
}: {
  post: OwnPostCard
  onOpen: (id: string) => void
}): React.ReactNode {
  return (
    <span className="flex min-w-0 flex-col">
      <button
        type="button"
        data-testid="own-open-reel"
        className="max-w-80 truncate text-left hover:underline"
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
          {translate('boards.own.pullFailedShort', '{{at}} measurement failed, old numbers', {
            at: formatBoardTime(post.pullError.at)
          })}
        </span>
      ) : null}
    </span>
  )
}

function columns(onOpen: (id: string) => void): DataColumn<OwnPostCard>[] {
  return [
    {
      id: 'post',
      header: translate('boards.own.post', 'Post'),
      cell: (post) => <PostCell post={post} onOpen={onOpen} />
    },
    ...IG_COLUMNS.map((key): DataColumn<OwnPostCard> => ({
      id: key,
      align: 'end',
      header: columnLabel(key),
      cell: (post) => (
        <span className="text-xs">
          <ReadingValue reading={post.ig[key]} format={formatCount} vaultLink={false} />
        </span>
      )
    })),
    ...AFTER_COLUMNS.map((c): DataColumn<OwnPostCard> => ({
      id: c.key,
      align: 'end',
      header: columnLabel(c.key),
      cell: (post) => (
        <span
          data-testid={`own-after-${c.key}`}
          data-status={post.after[c.key].status}
          className="text-xs"
        >
          <AfterValue reading={post.after[c.key]} />
        </span>
      )
    }))
  ]
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
    <section className="flex flex-col gap-3">
      <BlockHeader title={translate('boards.own.contentTitle', 'Posts in range')}>
        <SourceTag
          sources={[INSTAGRAM, ...AFTER_COLUMNS.map((c) => c.source)]}
          at={oldestAt([
            ...board.posts.flatMap((p) => (capturedAt(p.ig.views) ? [p.ig.views] : [])),
            ...AFTER_COLUMNS.map((c) => board.after[c.key])
          ])}
        />
      </BlockHeader>
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
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('boards.own.noPosts', 'No posts in this range.')}
        </p>
      ) : (
        <DataTable
          testId="own-content-table"
          rowTestId="own-post-row"
          columns={columns(onOpen)}
          rows={posts}
          rowKey={(post) => post.ownPostId}
          rowData={(post) => ({
            'data-post-id': post.ownPostId,
            'data-pull-error': post.pullError ? 'true' : undefined
          })}
        />
      )}
    </section>
  )
}
