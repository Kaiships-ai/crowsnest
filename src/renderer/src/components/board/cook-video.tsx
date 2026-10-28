import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { mmss } from './cook-claude-cards'
import type { CookView } from './cook-pane-state'
import { gateVersion, lastVersion, openRound } from './cook-version-cards'

type Version = CookView['versions'][number]

/** A playable URL for a file in the reel's folder, through Orca's media preview protocol. */
function useMediaUrl(file: string | null, revision: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (file) {
      void window.api.fs
        .readFile({ filePath: file })
        .then((read) => live && setUrl(read.mediaUrl ?? null))
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [file, revision])
  return url
}

function Player({
  file,
  revision,
  draft,
  onDuration
}: {
  file: string
  revision: string
  draft?: boolean
  onDuration?: (sec: number) => void
}): React.ReactNode {
  const url = useMediaUrl(file, revision)
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[188px] overflow-hidden rounded-lg bg-muted">
      {url ? (
        <video
          data-testid="cook-video-player"
          src={url}
          controls
          preload="metadata"
          className="size-full bg-black object-contain"
          onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
        />
      ) : null}
      {draft ? (
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wider text-white">
          {translate('boards.cook.draftBadge', 'DRAFT')}
        </span>
      ) : null}
    </div>
  )
}

/** Proto v2 Video box: the newest playable file (DRAFT, then the final), or an older version Kai picked. */
export function VideoBox({
  view,
  shown,
  onShow
}: {
  view: CookView
  shown: number | null
  onShow: (n: number | null) => void
}): React.ReactNode {
  const [duration, setDuration] = useState<number | null>(null)
  const round = openRound(view)
  const last = lastVersion(view)
  const delivered = view.steps?.find((s) => s.name === 'deliver')?.status === 'done'
  // The newest file's version: the saved one once delivered, else the one being made.
  const newest = delivered && !round ? last : last + 1
  // Why: a round reruns steps one by one, so until its draft lands the film's files are still the last version's.
  const fresh =
    view.video != null &&
    (!round || view.video.kind === 'draft' || view.video.mtime !== view.versions.at(-1)?.mp4Mtime)
  const older = view.versions.find((v) => v.n === (shown ?? (fresh ? null : last)))
  const file = older?.file ?? (fresh ? view.video?.file : null) ?? null
  const draft = !older && view.video?.kind === 'draft'
  const draftStep = view.steps?.find((s) => s.name === 'draft')
  const len = duration != null ? mmss(duration) : null
  const label = older
    ? `v${older.n}${len ? ` · ${len}` : ''} · 1080×1920`
    : draft
      ? round
        ? `v${newest} draft · low quality`
        : `Draft · low quality${len ? ` · ${len}` : ''}`
      : `v${newest}${len ? ` · ${len}` : ''} · 1080×1920`
  const change = (older ?? (delivered && !round ? view.versions.at(-1) : undefined))?.change
  const pick = gateVersion(view)
  return (
    <div
      data-testid="cook-video"
      data-kind={older ? 'version' : (view.video?.kind ?? 'none')}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card px-3 py-3"
    >
      <h4 className="text-sm font-semibold">{translate('boards.cook.video', 'Video')}</h4>
      {file ? (
        <Player
          key={file}
          file={file}
          revision={String(older ? older.mp4Mtime : view.video?.mtime)}
          draft={draft}
          onDuration={setDuration}
        />
      ) : draftStep?.status === 'running' && draftStep.pct != null ? (
        <div className="mx-auto flex aspect-[9/16] w-full max-w-[188px] flex-col items-center justify-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{draftStep.pct}%</span>
          <i className="relative block h-[5px] w-full overflow-hidden rounded-full bg-background">
            <b
              className="absolute inset-y-0 left-0 rounded-full bg-chart-2"
              style={{ width: `${draftStep.pct}%` }}
            />
          </i>
          <span>{translate('boards.cook.draftProgress', 'Draft · 270×480')}</span>
        </div>
      ) : (
        <div
          data-testid="cook-video-empty"
          className="mx-auto flex aspect-[9/16] w-full max-w-[188px] items-center justify-center rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground"
        >
          {translate('boards.cook.noVideo', 'No video yet. It comes after Build.')}
        </div>
      )}
      {file ? (
        <div
          data-testid="cook-video-label"
          className="text-center font-mono text-[11px] text-muted-foreground"
        >
          {label}
        </div>
      ) : null}
      {view.versions.length > 0 ? (
        <div
          role="group"
          aria-label={translate('boards.cook.versions', 'Versions')}
          className="flex flex-wrap justify-center gap-1"
        >
          {view.versions.map((v) => (
            <button
              key={v.n}
              type="button"
              data-testid={`cook-version-v${v.n}`}
              data-on={(older ? older.n : newest) === v.n ? 'true' : undefined}
              title={
                v.n === pick
                  ? translate('boards.cook.gateGetsVersion', 'Gate 2 gets this version')
                  : undefined
              }
              onClick={() => onShow(v.n === newest ? null : v.n)}
              className={cn(
                'rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground',
                (older ? older.n : newest) === v.n && 'border-foreground text-foreground'
              )}
            >
              {`v${v.n}${v.n === pick ? ' ✓' : ''}`}
            </button>
          ))}
          {newest > last ? (
            <button
              type="button"
              data-testid={`cook-version-v${newest}`}
              data-on={!older ? 'true' : undefined}
              disabled={!fresh}
              onClick={() => onShow(null)}
              className={cn(
                'rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground disabled:opacity-50',
                !older && 'border-foreground text-foreground'
              )}
            >
              {`v${newest}${fresh ? '' : ' …'}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {change ? (
        <span
          data-testid="cook-video-change"
          className="rounded-md border border-status-success-border bg-status-success-background px-2 py-1 font-mono text-[11px] break-words"
        >
          {translate('boards.cook.changed', 'changed: {{change}}', { change })}
        </span>
      ) : null}
    </div>
  )
}

function scriptDiff(
  a: string[] | null,
  b: string[] | null
): [string | undefined, string | undefined][] {
  if (!a || !b) {
    return []
  }
  return Array.from(
    { length: Math.max(a.length, b.length) },
    (_, i): [string | undefined, string | undefined] => [a[i], b[i]]
  ).filter(([x, y]) => x !== y)
}

function Side({
  v,
  picked,
  onUse
}: {
  v: Version
  picked: boolean
  onUse: () => void
}): React.ReactNode {
  return (
    <div
      data-testid={`cook-compare-v${v.n}`}
      data-picked={picked ? 'true' : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border border-border p-2.5',
        picked && 'border-status-success-border bg-status-success-background'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">v{v.n}</b>
        {picked ? (
          <span className="rounded-md border border-status-success-border px-1.5 font-mono text-[11px] whitespace-nowrap">
            {translate('boards.cook.gateGets', 'Gate 2 gets this')}
          </span>
        ) : null}
      </div>
      <Player file={v.file} revision={String(v.mp4Mtime)} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">{translate('boards.cook.length', 'Length')}</dt>
        <dd className="font-mono">{v.durationSec != null ? mmss(v.durationSec) : '-'}</dd>
        <dt className="text-muted-foreground">{translate('boards.cook.hook', 'Hook')}</dt>
        <dd className="font-mono">{v.hookSec != null ? `${v.hookSec} s` : '-'}</dd>
        <dt className="text-muted-foreground">{translate('boards.cook.qa', 'QA')}</dt>
        <dd className="font-mono">{v.qa ?? '-'}</dd>
      </dl>
      <Button
        data-testid={`cook-use-v${v.n}`}
        size="sm"
        variant={picked ? 'default' : 'outline'}
        onClick={onUse}
      >
        {picked
          ? translate('boards.cook.usingVersion', 'Using v{{n}}', { n: v.n })
          : translate('boards.cook.useVersion', 'Use v{{n}}', { n: v.n })}
      </Button>
    </div>
  )
}

/** Proto 23: two versions side by side, their facts, the script lines that changed. */
export function CompareBox({
  view,
  pair,
  onUse
}: {
  view: CookView
  pair: [number, number]
  onUse: (n: number) => void
}): React.ReactNode {
  const [a, b] = pair.map((n) => view.versions.find((v) => v.n === n))
  if (!a || !b) {
    return null
  }
  const pick = gateVersion(view)
  const diff = scriptDiff(a.scriptLines, b.scriptLines)
  const folders = [a, b].map((v) => `versions/v${v.n}/`).join(' · ')
  const caption =
    a.caption === b.caption
      ? translate('boards.cook.captionSame', 'caption the same')
      : translate('boards.cook.captionChanged', 'caption changed')
  return (
    <div
      data-testid="cook-compare"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <h4 className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        {translate('boards.cook.compare', 'Compare')}
        <span className="font-mono text-2xs font-normal text-muted-foreground">{folders}</span>
      </h4>
      <div className="grid grid-cols-2 gap-3">
        <Side v={a} picked={pick === a.n} onUse={() => onUse(a.n)} />
        <Side v={b} picked={pick === b.n} onUse={() => onUse(b.n)} />
      </div>
      <div data-testid="cook-compare-diff" className="flex flex-col gap-0.5 text-[12.5px]">
        <div className="font-mono text-2xs text-muted-foreground">
          {diff.length === 1
            ? translate('boards.cook.diffOne', 'Script · 1 line changed · {{caption}}', { caption })
            : translate('boards.cook.diffMany', 'Script · {{n}} lines changed · {{caption}}', {
                n: diff.length,
                caption
              })}
        </div>
        {diff.map(([x, y], i) => (
          <React.Fragment key={i}>
            {x != null ? (
              <p className="grid grid-cols-[2rem_1fr] rounded bg-destructive/15 px-1.5 py-0.5">
                <span className="font-mono text-2xs text-muted-foreground">v{a.n}</span>
                {x}
              </p>
            ) : null}
            {y != null ? (
              <p className="grid grid-cols-[2rem_1fr] rounded bg-status-success-background px-1.5 py-0.5">
                <span className="font-mono text-2xs text-muted-foreground">v{b.n}</span>
                {y}
              </p>
            ) : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
