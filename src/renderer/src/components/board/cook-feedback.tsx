import React, { useEffect, useRef, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { CookView } from './cook-pane-state'
import { lastVersion, openRound } from './cook-version-cards'

const QUEUE_KEY = (planId: string): string => `cook-queued:${planId}`

/** Proto v2 "Feedback to Claude" (19 to 24): each note is a round that makes the next version. A note
 *  waits in a queue while Claude is busy or the reel is not saved as a version yet (20), and the pane
 *  sends it by itself once both are true. */
export function FeedbackBox({
  planId,
  view,
  claudeIdle,
  type
}: {
  planId: string
  view: CookView
  /** Claude runs and is not working (Orca's hook state). */
  claudeIdle: boolean
  /** Types one line into Claude's terminal and submits it; null when there is no terminal. */
  type: ((text: string) => void) | null
}): React.ReactNode {
  const [note, setNote] = useState('')
  const [queued, setQueued] = useState<string | null>(() => localStorage.getItem(QUEUE_KEY(planId)))
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  // Sent, and the view does not show its round yet: Claude's hook still reads done until then.
  const [sent, setSent] = useState(false)
  const round = openRound(view)
  const roundN = round?.n
  useEffect(() => {
    if (roundN != null) {
      setSent(false)
    }
  }, [roundN])
  const delivered = view.steps?.find((s) => s.name === 'deliver')?.status === 'done'
  // Why: a round starts from a saved version, so a note waits for deliver and for the copy to versions/.
  const ready = claudeIdle && type != null && delivered && !round && !sent && lastVersion(view) > 0
  const keep = (text: string | null): void => {
    setQueued(text)
    if (text) {
      localStorage.setItem(QUEUE_KEY(planId), text)
    } else {
      localStorage.removeItem(QUEUE_KEY(planId))
    }
  }
  const send = async (text: string): Promise<void> => {
    if (sending.current || !type) {
      return
    }
    sending.current = true
    // Why: a remount while this awaits reads the queue again, and would send the note twice.
    keep(null)
    const result = await window.api.crowsnest
      .call('recordCookRoundAction', planId, text)
      .catch(() => null)
    const value = result?.ok ? result.value : null
    if (value?.ok) {
      setSent(true)
      type(value.message)
      setError(null)
    } else {
      setNote(text)
      setError(value ? value.error : 'Could not send the note.')
    }
    sending.current = false
  }
  useEffect(() => {
    if (queued && ready) {
      void send(queued)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- send reads this render's props; only these two change when a note may go.
  }, [queued, ready])
  const submit = (): void => {
    const text = note.trim()
    if (!text) {
      return
    }
    setNote('')
    if (ready) {
      void send(text)
    } else {
      keep(text)
    }
  }
  const renderRunning = view.steps?.find((s) => s.name === 'render')?.status === 'running'
  return (
    <div
      data-testid="cook-feedback"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3"
    >
      <h4 className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        {translate('boards.cook.feedback', 'Feedback to Claude')}
        <span className="font-mono text-2xs font-normal text-muted-foreground">
          {translate('boards.cook.sameSession', 'same session')}
        </span>
      </h4>
      {view.rounds.map((r) => {
        const made = view.versions.find((v) => v.n === r.from + 1)
        return (
          <div
            key={r.n}
            data-testid="cook-round"
            className="grid grid-cols-[62px_minmax(0,1fr)] items-baseline gap-2 text-[12.5px]"
          >
            <span className="font-mono text-2xs text-muted-foreground">
              {translate('boards.cook.round', 'Round {{n}}', { n: r.n })}
            </span>
            <span className="break-words">
              {`"${r.note}"`}
              {made ? (
                made.change ? (
                  <>
                    {' → '}
                    <b>{made.change}</b>
                  </>
                ) : null
              ) : round?.n === r.n ? (
                <span className="text-muted-foreground">
                  {' '}
                  <Loader2 className="inline size-3 animate-spin" />{' '}
                  {translate('boards.cook.making', 'making v{{n}}', { n: r.from + 1 })}
                </span>
              ) : null}
            </span>
          </div>
        )
      })}
      {queued ? (
        <div
          data-testid="cook-queued"
          className="flex items-center gap-2 rounded-lg border border-dashed border-border py-1.5 pr-1.5 pl-2.5 text-[12.5px]"
        >
          <Clock className="size-3.5 flex-none text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {renderRunning
              ? translate(
                  'boards.cook.queuedRender',
                  'Queued: "{{note}}". Claude gets it when the final render is done.',
                  { note: queued }
                )
              : translate(
                  'boards.cook.queuedIdle',
                  'Queued: "{{note}}". Claude gets it when it finishes.',
                  {
                    note: queued
                  }
                )}
          </span>
          <Button data-testid="cook-unqueue" size="sm" variant="ghost" onClick={() => keep(null)}>
            {translate('boards.cook.cancel', 'Cancel')}
          </Button>
        </div>
      ) : null}
      <textarea
        data-testid="cook-feedback-input"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={translate('boards.cook.feedbackPlaceholder', 'e.g. make the hook faster')}
        aria-label={translate('boards.cook.feedback', 'Feedback to Claude')}
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="cook-feedback-send" size="sm" disabled={!note.trim()} onClick={submit}>
          {ready ? translate('boards.cook.send', 'Send') : translate('boards.cook.queue', 'Queue')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {ready
            ? translate(
                'boards.cook.sendHint',
                'Claude changes the reel in the terminal on the right. This version stays.'
              )
            : translate(
                'boards.cook.queueHint',
                'Claude is busy. Your note goes in when it finishes.'
              )}
        </span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
