import React, { Suspense, useCallback, useMemo, useState } from 'react'
import type { DiffOnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Check, Minus, Plus, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { DiffViewer } from '../editor/editor-lazy-views'
import { translate as t } from '@/i18n/i18n'
import { useCp2 } from './cp2-variant'

// CP2 prototype: Gate 1 (B4-01), three shapes on fixed plan text. Throwaway.
type Kind = 'del' | 'mod' | 'add'
type Change = { id: string; kind: Kind; day: string; from?: string; to?: string; why: string }

const DAYS = [
  'Mon 10/27',
  'Tue 10/28',
  'Wed 10/29',
  'Thu 10/30',
  'Fri 10/31',
  'Sat 11/1',
  'Sun 11/2'
]
const LIVE: Record<string, string> = {
  'Mon 10/27': 'Cursor deleted my repo · key git-r12',
  'Tue 10/28': '5 MCP servers worth installing · key mcp',
  'Wed 10/29': 'Hooks in one picture · key hooks',
  'Sun 11/2': 'Week 45 in numbers · key wk45'
}
const CHANGES: Change[] = [
  {
    id: 'c1',
    kind: 'del',
    day: 'Tue 10/28',
    from: LIVE['Tue 10/28'],
    why: 'the last 3 MCP reels stayed under 2k views'
  },
  {
    id: 'c2',
    kind: 'mod',
    day: 'Wed 10/29',
    from: LIVE['Wed 10/29'],
    to: 'Hooks in one picture · key hooks-r14',
    why: 'a new key counts the repost on its own'
  },
  {
    id: 'c3',
    kind: 'add',
    day: 'Thu 10/30',
    to: 'Sales reel: 0 → 2 orders · key sale2',
    why: '22 days without a sales reel'
  },
  {
    id: 'c4',
    kind: 'add',
    day: 'Fri 10/31',
    to: '3 MCP mistakes · key mcp3',
    why: 'replaces the dropped MCP reel; mistakes get the most comments'
  }
]

function planText(kept: Set<string>): string {
  const plan = { ...LIVE }
  for (const c of CHANGES) {
    if (!kept.has(c.id)) {
      continue
    }
    if (c.kind === 'del') {
      delete plan[c.day]
    } else {
      plan[c.day] = c.to!
    }
  }
  return DAYS.filter((d) => plan[d])
    .map((d) => `${d} · ${plan[d]}`)
    .join('\n')
}
const LIVE_TEXT = planText(new Set())

const KIND_LABEL: Record<Kind, string> = { del: 'Remove reel', mod: 'Edit', add: 'Add reel' }
const KIND_ICON: Record<Kind, React.ReactNode> = {
  del: <Minus className="size-3" />,
  mod: <span className="text-2xs font-semibold leading-none">~</span>,
  add: <Plus className="size-3" />
}
const KIND_TONE: Record<Kind, string> = {
  del: 'text-destructive border-destructive/30 bg-destructive/10',
  mod: 'text-status-warning border-status-warning-border bg-status-warning-background',
  add: 'text-status-success border-status-success-border bg-status-success-background'
}

function KindMark({ kind }: { kind: Kind }): React.ReactNode {
  return (
    <span
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md border',
        KIND_TONE[kind]
      )}
    >
      {KIND_ICON[kind]}
    </span>
  )
}

function useYellowModified(on: boolean): DiffOnMount | undefined {
  return useCallback<DiffOnMount>(
    (diffEditor) => {
      if (!on) {
        return
      }
      const orig = diffEditor.getOriginalEditor().createDecorationsCollection()
      const mod = diffEditor.getModifiedEditor().createDecorationsCollection()
      // Monaco merges an edited line into the neighbouring add/delete hunk, so the plan's own
      // change list names the edited days and we paint exactly those lines.
      const modDays = CHANGES.filter((c) => c.kind === 'mod').map((c) => c.day)
      const lines = (ed: editor.ICodeEditor): number[] =>
        (ed.getModel()?.getLinesContent() ?? []).flatMap((text, i) =>
          modDays.some((d) => text.startsWith(d)) ? [i + 1] : []
        )
      const deco = (l: number): editor.IModelDeltaDecoration => ({
        range: { startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: 1 },
        options: { isWholeLine: true, className: 'cp2-mod-line', marginClassName: 'cp2-mod-line' }
      })
      const paint = (): void => {
        const o = lines(diffEditor.getOriginalEditor()).map(deco)
        const m = lines(diffEditor.getModifiedEditor())
          .filter(
            (l) =>
              // only when the line differs from live, i.e. the change is kept
              (diffEditor.getModifiedEditor().getModel()?.getLineContent(l) ?? '') !==
              (diffEditor
                .getOriginalEditor()
                .getModel()
                ?.getLinesContent()
                .find((t) => modDays.some((d) => t.startsWith(d))) ?? '')
          )
          .map(deco)
        orig.set(m.length ? o : [])
        mod.set(m)
      }
      diffEditor.onDidUpdateDiff(paint)
      paint()
    },
    [on]
  )
}

function PlanDiff({ proposed }: { proposed: string }): React.ReactNode {
  const yellow = useCp2('mod') === 'yellow'
  const onDiffMount = useYellowModified(yellow)
  return (
    <div
      data-testid="cp2-diff"
      className={cn(
        'flex h-64 flex-col overflow-hidden rounded-lg border border-border',
        yellow && 'cp2-yellow'
      )}
    >
      <Suspense fallback={null}>
        <DiffViewer
          key={`${yellow}`}
          modelKey={`cp2-gate-${yellow}`}
          originalContent={LIVE_TEXT}
          modifiedContent={proposed}
          language="plaintext"
          filePath="plan-week-45.md"
          relativePath="plan-week-45.md"
          sideBySide
          onDiffMount={onDiffMount}
        />
      </Suspense>
    </div>
  )
}

function Header({ kept }: { kept: Set<string> }): React.ReactNode {
  const count = (k: Kind) => CHANGES.filter((c) => c.kind === k && kept.has(c.id)).length
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-medium">{t('gates.plan.title', 'Gate 1 · week 45 plan')}</h1>
        <span className="font-mono text-2xs text-muted-foreground">
          +{count('add')} −{count('del')} ~{count('mod')}
        </span>
      </div>
      <p data-testid="cp2-gate-reason" className="text-sm">
        <span className="text-muted-foreground">
          {t('gates.plan.reason', 'Why Claude proposes this:')}{' '}
        </span>
        22 days with 0 sales reels · gift page → checkout 7.5% (target 12%).
      </p>
    </header>
  )
}

function Approve({ n, label }: { n: number; label: string }): React.ReactNode {
  const [done, setDone] = useState(false)
  return (
    <div className="flex items-center justify-end gap-2">
      {done ? (
        <>
          <Badge variant="outline" className="text-status-success">
            <Check /> {t('gates.plan.live', 'v3 is live')}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setDone(false)}>
            <Undo2 /> {t('gates.plan.undo', 'Undo')}
          </Button>
        </>
      ) : (
        <Button
          data-testid="cp2-approve"
          size="sm"
          disabled={n === 0}
          onClick={() => setDone(true)}
        >
          {label}
        </Button>
      )}
    </div>
  )
}

function VersionPills(): React.ReactNode {
  return (
    <div className="grid grid-cols-2 gap-2 font-mono text-2xs text-muted-foreground">
      <span>v2 · live · approved 10/21 07:12</span>
      <span>v3 · proposed by Claude · 10/26 06:40</span>
    </div>
  )
}

/** A: Orca DiffViewer side by side, one approve button. */
function VariantA(): React.ReactNode {
  const all = useMemo(() => new Set(CHANGES.map((c) => c.id)), [])
  return (
    <>
      <Header kept={all} />
      <VersionPills />
      <PlanDiff proposed={planText(all)} />
      <Approve n={CHANGES.length} label={t('gates.plan.approve', 'Approve plan v3')} />
    </>
  )
}

/** B: change cards with Drop / Keep per change (proto sheet "plan"). */
function VariantB(): React.ReactNode {
  const [kept, setKept] = useState(() => new Set(CHANGES.map((c) => c.id)))
  const toggle = (id: string, keep: boolean) =>
    setKept((s) => {
      const n = new Set(s)
      if (keep) {
        n.add(id)
      } else {
        n.delete(id)
      }
      return n
    })
  return (
    <>
      <Header kept={kept} />
      <div className="flex flex-col gap-2">
        {CHANGES.map((c) => {
          const on = kept.has(c.id)
          return (
            <div
              key={c.id}
              data-testid="cp2-change-card"
              className={cn(
                'flex items-start gap-3 rounded-xl border border-border px-4 py-3',
                !on && 'opacity-55'
              )}
            >
              <KindMark kind={c.kind} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {t(`gates.plan.kind.${c.kind}`, KIND_LABEL[c.kind])}
                  </span>
                  <span className="font-mono text-2xs text-muted-foreground">{c.day}</span>
                </div>
                {c.from ? (
                  <span
                    className={cn(
                      'text-sm text-muted-foreground',
                      c.kind === 'del' && 'line-through'
                    )}
                  >
                    {c.from}
                  </span>
                ) : null}
                {c.to ? <span className="text-sm">{c.to}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {t('gates.plan.because', 'Because')} {c.why}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="xs"
                  variant={on ? 'ghost' : 'secondary'}
                  onClick={() => toggle(c.id, false)}
                >
                  {t('gates.plan.drop', 'Drop')}
                </Button>
                <Button
                  size="xs"
                  variant={on ? 'secondary' : 'ghost'}
                  onClick={() => toggle(c.id, true)}
                >
                  {t('gates.plan.keep', 'Keep')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      <Approve
        n={kept.size}
        label={t('gates.plan.approveN', 'Approve plan ({{count}} changes)', { count: kept.size })}
      />
    </>
  )
}

/** C: compact change list with switches, the diff below follows them. */
function VariantC(): React.ReactNode {
  const [kept, setKept] = useState(() => new Set(CHANGES.map((c) => c.id)))
  return (
    <>
      <Header kept={kept} />
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {CHANGES.map((c) => (
          <label
            key={c.id}
            data-testid="cp2-change-row"
            className="flex cursor-pointer items-center gap-3 px-3 py-2"
          >
            <KindMark kind={c.kind} />
            <span className="w-20 shrink-0 font-mono text-2xs text-muted-foreground">{c.day}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {c.kind === 'del' ? <span className="line-through">{c.from}</span> : c.to}
              <span className="text-muted-foreground"> · {c.why}</span>
            </span>
            <Switch
              checked={kept.has(c.id)}
              onCheckedChange={(on) =>
                setKept((s) => {
                  const n = new Set(s)
                  if (on) {
                    n.add(c.id)
                  } else {
                    n.delete(c.id)
                  }
                  return n
                })
              }
            />
          </label>
        ))}
      </div>
      <VersionPills />
      <PlanDiff proposed={planText(kept)} />
      <Approve
        n={kept.size}
        label={t('gates.plan.approveV3N', 'Approve plan v3 ({{count}} changes)', {
          count: kept.size
        })}
      />
    </>
  )
}

export function Cp2GateBoard(): React.ReactNode {
  const v = useCp2('gate')
  return (
    <div
      data-testid="cp2-gate"
      data-variant={v}
      className="scrollbar-sleek mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-auto px-6 py-5"
    >
      {v === 'A' ? <VariantA /> : v === 'B' ? <VariantB /> : <VariantC />}
    </div>
  )
}
