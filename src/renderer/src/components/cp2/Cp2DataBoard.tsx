import React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { useCp2 } from './cp2-variant'

// CP2 prototype: how a number looks in each data state. Fixed values. Throwaway.
type State = 'value' | 'partial' | 'not-connected' | 'error' | 'empty'
type Cell = {
  label: string
  source: string
  state: State
  value?: number
  gap?: number
  detail?: string
}

const KPIS: Cell[] = [
  { label: 'Reel views', source: 'Instagram', state: 'value', value: 591936 },
  { label: 'Keyword comments', source: 'ChatbotX', state: 'partial', value: 3410, gap: 2 },
  { label: 'Gift page visits', source: 'Umami', state: 'not-connected' },
  {
    label: 'Checkout',
    source: 'Polar',
    state: 'error',
    detail: 'the 05:00 pull was refused (401)'
  },
  { label: 'Purchases', source: 'Skool', state: 'empty' }
]
const STEPS: Cell[] = [
  { label: 'Reel views', source: 'Instagram', state: 'value', value: 591936 },
  { label: 'Comments', source: 'ChatbotX', state: 'partial', value: 3410, gap: 2 },
  { label: 'Gift DMs', source: 'ChatbotX', state: 'value', value: 1586 },
  { label: 'Gift page', source: 'Umami', state: 'not-connected' },
  {
    label: 'Checkout',
    source: 'Polar',
    state: 'error',
    detail: 'the 05:00 pull was refused (401)'
  },
  { label: 'Purchases', source: 'Skool', state: 'empty' }
]
const fmt = new Intl.NumberFormat('en-US')
const BAR_MAX = Math.log10(591936)

const openVault = (): void => {
  const s = useAppStore.getState()
  s.openSettingsTarget({ pane: 'lead-sources', repoId: null })
  s.openSettingsPage()
}

function VaultLink({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <button
      type="button"
      onClick={openVault}
      className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </button>
  )
}

function stateText(c: Cell): string {
  switch (c.state) {
    case 'partial':
      return t('boards.state.missingKeywords', 'missing {{count}} keywords', { count: c.gap })
    case 'not-connected':
      return t('boards.state.notConnectedSource', '{{source}} not connected', { source: c.source })
    case 'error':
      return t('boards.state.pullFailedSource', '{{source}} pull failed', { source: c.source })
    case 'empty':
      return t('boards.state.noData', 'no data yet')
    default:
      return ''
  }
}

/** A: number slot keeps its size; the state is a small badge under it. */
function NumberA({ c, size }: { c: Cell; size: string }): React.ReactNode {
  return (
    <div className={cn('flex flex-col gap-1', size === 'text-base' ? 'items-end' : 'items-start')}>
      <span
        className={cn(
          'font-mono tabular-nums leading-none',
          size,
          c.value === undefined && 'font-sans text-muted-foreground/50',
          c.state === 'partial' && 'text-muted-foreground'
        )}
      >
        {c.value === undefined ? '—' : fmt.format(c.value)}
      </span>
      <span className="flex h-5 items-center">
        {c.state === 'value' ? null : (
          <Badge
            variant="outline"
            className={cn(
              'font-normal',
              c.state === 'error' && 'border-destructive/40 text-destructive',
              c.state === 'partial' && 'border-status-warning-border text-status-warning'
            )}
          >
            {c.state === 'not-connected' ? <VaultLink>{stateText(c)}</VaultLink> : stateText(c)}
          </Badge>
        )}
      </span>
    </div>
  )
}

/** B: the state replaces the number, muted, at number size. */
function NumberB({ c, size }: { c: Cell; size: string }): React.ReactNode {
  const base = cn('leading-none', size)
  if (c.state === 'value') {
    return <span className={cn(base, 'font-mono tabular-nums')}>{fmt.format(c.value!)}</span>
  }
  if (c.state === 'partial') {
    return (
      <span
        className={cn(base, 'font-mono tabular-nums text-muted-foreground')}
        title={stateText(c)}
      >
        ≥ {fmt.format(c.value!)}
      </span>
    )
  }
  return (
    <span
      className={cn(base, 'text-muted-foreground/70', c.state === 'error' && 'text-destructive/80')}
    >
      {c.state === 'not-connected' ? (
        <VaultLink>{t('boards.state.notConnected', 'not connected')}</VaultLink>
      ) : c.state === 'error' ? (
        t('boards.state.pullFailed', 'pull failed')
      ) : (
        t('boards.state.none', 'no data')
      )}
    </span>
  )
}

/** C: number or dash with a footnote mark; the reasons sit once under the block. */
function NumberC({ c, size, mark }: { c: Cell; size: string; mark?: number }): React.ReactNode {
  return (
    <span
      className={cn(
        'font-mono tabular-nums leading-none',
        size,
        c.value === undefined && 'font-sans text-muted-foreground/50'
      )}
    >
      {c.value === undefined ? '—' : fmt.format(c.value)}
      {mark ? (
        <sup
          className={cn(
            'ml-0.5 font-sans text-2xs font-semibold',
            c.state === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {mark}
        </sup>
      ) : null}
    </span>
  )
}

function footnote(c: Cell): React.ReactNode {
  switch (c.state) {
    case 'partial':
      return `${c.label}: ${c.gap} keywords have no ${c.source} number yet, so the total is incomplete.`
    case 'not-connected':
      return (
        <>
          {c.label}: {c.source} is not connected. <VaultLink>Open Sources</VaultLink>
        </>
      )
    case 'error':
      return (
        <span className="text-destructive">
          {c.label}: {c.source} {c.detail}. <VaultLink>Edit key</VaultLink>
        </span>
      )
    case 'empty':
      return `${c.label}: ${c.source} is connected, no numbers this week yet.`
    default:
      return null
  }
}

function marks(cells: Cell[]): Map<Cell, number> {
  const m = new Map<Cell, number>()
  for (const c of cells) {
    if (c.state !== 'value') {
      m.set(c, m.size + 1)
    }
  }
  return m
}

function Num({ c, v, size, mark }: { c: Cell; v: string; size: string; mark?: number }) {
  return v === 'A' ? (
    <NumberA c={c} size={size} />
  ) : v === 'B' ? (
    <NumberB c={c} size={size} />
  ) : (
    <NumberC c={c} size={size} mark={mark} />
  )
}

function BlockHead({ title }: { title: string }): React.ReactNode {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <span className="font-mono text-2xs text-muted-foreground">
        Instagram · ChatbotX · Umami · Polar · Skool · pulled 05:00 today
      </span>
    </div>
  )
}

function Footnotes({ m }: { m: Map<Cell, number> }): React.ReactNode {
  return (
    <ol className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
      {[...m].map(([c, n]) => (
        <li key={n} className="flex gap-1.5">
          <span className="w-3 shrink-0 font-semibold">{n}</span>
          <span>{footnote(c)}</span>
        </li>
      ))}
    </ol>
  )
}

export function Cp2DataBoard(): React.ReactNode {
  const v = useCp2('data')
  const km = marks(KPIS)
  const sm = marks(STEPS)
  return (
    <div
      data-testid="cp2-data"
      data-variant={v}
      className="scrollbar-sleek mx-auto flex h-full max-w-5xl flex-col gap-8 overflow-auto px-6 py-5"
    >
      <section className="flex flex-col gap-3">
        <BlockHead title={t('boards.today.thisWeek', 'This week')} />
        <div className="grid grid-cols-5 gap-3">
          {KPIS.map((c) => (
            <div
              key={c.label}
              data-testid="cp2-kpi"
              data-state={c.state}
              className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3"
            >
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <Num c={c} v={v} size="text-2xl" mark={km.get(c)} />
            </div>
          ))}
        </div>
        {v === 'C' ? <Footnotes m={km} /> : null}
      </section>

      <section className="flex flex-col gap-3">
        <BlockHead title={t('leadStudio.nav.funnel', 'Funnel')} />
        <div className="flex flex-col">
          {STEPS.map((c) => (
            <div
              key={c.label}
              data-testid="cp2-step"
              data-state={c.state}
              className="grid grid-cols-[8rem_1fr_9rem] items-center gap-4 border-b border-border py-2.5"
            >
              <span className="text-sm">{c.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                {c.value !== undefined ? (
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      c.state === 'partial' ? 'bg-primary/35' : 'bg-primary/70'
                    )}
                    style={{ width: `${(Math.log10(c.value) / BAR_MAX) * 100}%` }}
                  />
                ) : null}
              </span>
              <span className="flex justify-end text-right">
                <Num c={c} v={v} size="text-base" mark={sm.get(c)} />
              </span>
            </div>
          ))}
        </div>
        {v === 'C' ? <Footnotes m={sm} /> : null}
      </section>
    </div>
  )
}
