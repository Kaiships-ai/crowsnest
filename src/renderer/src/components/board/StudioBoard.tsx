import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { BoardStates } from './BoardStates'
import { cookCard, cookSegments, type CookView } from './cook-pane-state'
import { Strip } from './cook-pane-parts'
import { cookReel, openCookWorkspace } from './cook-reel'
import type { BoardLoadState } from './use-board-load'

type Cook = { id: string; view: CookView }

const POLL_MS = 2000

/** Proto 39: one row per reel cooking now, read from each film's job.json, with Open. */
export function StudioBoard(): React.ReactNode {
  const [state, setState] = useState<BoardLoadState<Cook>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const result = await window.api.crowsnest.call('listCooksAction').catch(() => null)
      if (stopped) {
        return
      }
      if (result?.ok) {
        setState({ status: 'ready', rows: result.value })
        timer = setTimeout(() => void poll(), POLL_MS)
      } else {
        setState({ status: 'error', message: result?.error.message ?? 'Could not read the cooks.' })
      }
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [attempt])
  const count = state.status === 'ready' ? state.rows.length : null
  return (
    <div
      data-testid="studio-board"
      className="scrollbar-sleek @container flex h-full flex-col gap-4 overflow-y-auto p-6"
    >
      <header className="flex items-baseline gap-3">
        <h1 className="text-xl font-medium">{translate('studio.title', 'Studio')}</h1>
        {count ? (
          <span className="font-mono text-2xs text-muted-foreground">
            {translate('studio.cooking', '{{count}} cooking', { count })}
          </span>
        ) : null}
      </header>
      <BoardStates
        state={state}
        retry={() => setAttempt((n) => n + 1)}
        emptyMessage={translate('studio.empty', 'Nothing is cooking. Cook a reel from Plan.')}
      >
        {(rows) => (
          <div className="flex flex-col gap-3">
            {rows.map(({ id, view }) => (
              <StudioRow key={id} id={id} view={view} />
            ))}
            {rows.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'studio.oneRender',
                  'One render at a time, so the Mac stays fast. The second one starts by itself.'
                )}
              </p>
            ) : null}
          </div>
        )}
      </BoardStates>
    </div>
  )
}

function StudioRow({ id, view }: Cook): React.ReactNode {
  const segments = cookSegments(view)
  const card = cookCard(view)
  const folder = `films/${view.slug}/`
  const at = segments.find((seg) => seg.state !== 'done' && seg.state !== 'pending')
  return (
    <article
      data-testid="studio-row"
      data-plan-id={id}
      data-state={card.state}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 rounded-xl border border-border bg-card p-3 @min-[640px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h4 className="truncate text-sm font-semibold">{view.title}</h4>
        <div className="font-mono text-2xs break-all text-muted-foreground">{folder}</div>
        <p data-testid="studio-status" className="text-[13px]">
          {at ? `${translate(`boards.cook.step.${at.group}`, at.group)} · ` : ''}
          {card.head}
        </p>
      </div>
      <div className="order-last col-span-full @min-[640px]:order-none @min-[640px]:col-span-1">
        <Strip segments={segments} bare />
      </div>
      <Button
        data-testid="studio-open"
        size="sm"
        variant="outline"
        disabled={!view.workspaceId}
        onClick={() => {
          const workspaceId = view.workspaceId
          if (!workspaceId || openCookWorkspace(workspaceId, id)) {
            return
          }
          // Why: after an app restart in a real cook the reel workspace was gone while the row still
          // said cooking, so Open did nothing and Cook was refused. Cook again: /make-reel skips done steps.
          void window.api.crowsnest
            .call('clearPlanCookingAction', id, workspaceId)
            .then(() => cookReel({ id }, () => {}))
        }}
      >
        {translate('studio.open', 'Open')}
      </Button>
    </article>
  )
}
