import React from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import { formatBoardTime } from './board-time'
import { formatCount } from './funnel-reading'
import { BlockHeader, SourceTag } from './kit/SourceTag'
import { openPostInBrowser } from './open-post'

type RivalsBoardData = EngineCallValue<'getRivalsBoard'>
export type Post = RivalsBoardData['evidence'][number]['post']
type RivalTag = NonNullable<RivalsBoardData['evidence'][number]['analysis']['tag']>

const ANALYSIS = 'Analysis'

export const count = (value: number | null): string => (value === null ? '-' : formatCount(value))
export const score = (value: number | null): string =>
  value === null ? '-' : `${formatCount(Math.round(value * 10) / 10)}×`

export const newestAt = (times: (string | null)[]): string | null =>
  times.reduce<string | null>((newest, at) => (at && (!newest || at > newest) ? at : newest), null)

export function OpenPost({ post, testId }: { post: Post; testId: string }): React.ReactNode {
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

type Evidence = RivalsBoardData['evidence'][number]
type Group = RivalTag | 'unsorted'

const GROUPS: { id: RivalTag; title: () => string; hint: () => string }[] = [
  {
    id: 'take',
    title: () => translate('boards.rivals.group.take', 'Take'),
    hint: () => translate('boards.rivals.group.takeHint', 'Moves worth copying')
  },
  {
    id: 'learn',
    title: () => translate('boards.rivals.group.learn', 'Learn'),
    hint: () => translate('boards.rivals.group.learnHint', 'Lessons to adapt')
  },
  {
    id: 'avoid',
    title: () => translate('boards.rivals.group.avoid', 'Avoid'),
    hint: () => translate('boards.rivals.group.avoidHint', 'Mistakes to steer clear of')
  }
]

const groupOf = (evidence: Evidence): Group => evidence.analysis.tag ?? 'unsorted'

function EvidenceCard({ evidence }: { evidence: Evidence }): React.ReactNode {
  const { post, analysis } = evidence
  return (
    <article
      data-testid="rivals-evidence-card"
      data-video-id={post.videoId}
      data-tag={analysis.tag ?? 'unsorted'}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{post.channel.handle}</span>
        <span
          data-num
          className="ml-auto font-mono text-xs whitespace-nowrap text-muted-foreground"
        >
          {score(post.outlierScore)} · {count(post.viewCount)}
        </span>
      </div>
      {analysis.hookType ? (
        <Badge variant="secondary" className="self-start">
          {analysis.hookType}
        </Badge>
      ) : null}
      <p className="line-clamp-4 text-sm">{analysis.whyItWorked ?? analysis.summary}</p>
      {analysis.formatTags.length + analysis.styleTags.length > 0 ? (
        <span className="font-mono text-2xs text-muted-foreground">
          {[...analysis.formatTags, ...analysis.styleTags].join(' · ')}
        </span>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="font-mono text-2xs text-muted-foreground">
          {formatBoardTime(analysis.createdAt)}
        </span>
        <OpenPost post={post} testId="rivals-evidence-open" />
      </div>
    </article>
  )
}

function GroupHeader({
  title,
  hint,
  size
}: {
  title: string
  hint: string
  size: number
}): React.ReactNode {
  return (
    <div className="flex items-baseline gap-2 border-b border-border pb-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <span data-num className="font-mono text-2xs text-muted-foreground">
        {size}
      </span>
      <span className="ml-auto truncate text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

export function EvidenceBlock({ evidence }: { evidence: Evidence[] }): React.ReactNode {
  const unsorted = evidence.filter((e) => groupOf(e) === 'unsorted')
  return (
    <section data-testid="rivals-evidence" className="flex flex-col gap-3">
      <BlockHeader title={translate('boards.rivals.evidence', 'Evidence from analyzed posts')}>
        <SourceTag sources={[ANALYSIS]} at={newestAt(evidence.map((e) => e.analysis.createdAt))} />
      </BlockHeader>
      {evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'boards.rivals.noEvidence',
            'No posts analyzed yet. Agents analyze posts with crowsnest_save_analysis and tag each one take, learn or avoid.'
          )}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {GROUPS.map((g) => {
              const cards = evidence.filter((e) => groupOf(e) === g.id)
              return (
                <div
                  key={g.id}
                  data-testid="rivals-group"
                  data-group={g.id}
                  className="flex min-w-0 flex-col gap-2"
                >
                  <GroupHeader title={g.title()} hint={g.hint()} size={cards.length} />
                  {cards.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      {translate('boards.rivals.groupEmpty', 'Nothing filed here yet.')}
                    </p>
                  ) : (
                    cards.map((e) => <EvidenceCard key={e.post.videoId} evidence={e} />)
                  )}
                </div>
              )
            })}
          </div>
          {unsorted.length > 0 ? (
            <div data-testid="rivals-group" data-group="unsorted" className="flex flex-col gap-2">
              <GroupHeader
                title={translate('boards.rivals.group.unsorted', 'Not sorted')}
                hint={translate(
                  'boards.rivals.group.unsortedHint',
                  'Saved without a tag; the next save can file it'
                )}
                size={unsorted.length}
              />
              <div className="grid grid-cols-3 gap-4">
                {unsorted.map((e) => (
                  <EvidenceCard key={e.post.videoId} evidence={e} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
