import { useCallback, useEffect, useState } from 'react'
import { cookSegments, type CookView } from './cook-pane-state'

const POLL_MS = 1000

export type Reopen = { closedSec: number; newlyDone: string[]; restarted: boolean }
type Seen = { at: number; done: string[] }

const STOPPED_KEY = (planId: string): string => `cook-stopped:${planId}`

const doneGroups = (view: CookView): string[] =>
  cookSegments(view)
    .filter((seg) => seg.state === 'done')
    .map((seg) => seg.group)

/** The pane's last look at this cook, kept across app restarts to tell what happened meanwhile.
 *  ponytail: only a mounted pane stamps it, so "closed for" counts from the pane's last poll. */
function readSeen(planId: string): Seen | null {
  try {
    const seen: unknown = JSON.parse(localStorage.getItem(`cook-seen:${planId}`) ?? 'null')
    return seen && typeof seen === 'object' && 'at' in seen && typeof seen.at === 'number'
      ? { at: seen.at, done: 'done' in seen && Array.isArray(seen.done) ? seen.done : [] }
      : null
  } catch {
    return null
  }
}

/** Reads the reel's job.json through the main process once a second; never blocks the UI. On the
 *  first read after the app started, it compares with the pane's last look (proto 35 and 36). It
 *  also keeps Kai's Stop cook time (proto 42), dropped once the plan cooks again. */
export function useCookView(planId: string): {
  view: CookView | null
  /** When the view was read; the pane's clock, so it re-renders once a second. */
  now: number
  error: string | null
  reopen: Reopen | null
  /** Claude runs again (Resume), so a later exit is a crash, not the restart (proto 32, not 36). */
  forgetRestart: () => void
  stoppedAt: number | null
  markStopped: (at: number | null) => void
} {
  const [view, setView] = useState<CookView | null>(null)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [reopen, setReopen] = useState<Reopen | null>(null)
  const [stoppedAt, setStoppedAt] = useState<number | null>(
    () => Number(localStorage.getItem(STOPPED_KEY(planId))) || null
  )
  const markStopped = useCallback(
    (at: number | null): void => {
      setStoppedAt(at)
      if (at) {
        localStorage.setItem(STOPPED_KEY(planId), String(at))
      } else {
        localStorage.removeItem(STOPPED_KEY(planId))
      }
    },
    [planId]
  )
  const forgetRestart = useCallback(
    () => setReopen((current) => (current?.restarted ? null : current)),
    []
  )
  useEffect(() => {
    let stopped = false
    let first = true
    let wasCooking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const result = await window.api.crowsnest.call('getCookView', planId).catch(() => null)
      if (stopped) {
        return
      }
      const value = result?.ok ? result.value : null
      if (value?.ok) {
        const done = doneGroups(value)
        const seen = first ? readSeen(planId) : null
        first = false
        if (seen && seen.at < performance.timeOrigin) {
          setReopen({
            closedSec: (performance.timeOrigin - seen.at) / 1000,
            newlyDone: done.filter((group) => !seen.done.includes(group)),
            restarted: value.bootedAt > seen.at
          })
        }
        localStorage.setItem(`cook-seen:${planId}`, JSON.stringify({ at: Date.now(), done }))
        // Why: Stop cook clears cooking before it stamps, so cooking again means a new cook.
        if (value.cooking && !wasCooking) {
          markStopped(null)
        }
        wasCooking = value.cooking
        setView(value)
        setNow(Date.now())
        setError(null)
      } else {
        setError(value ? value.error : result && !result.ok ? result.error.message : null)
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [planId, markStopped])
  return { view, now, error, reopen, forgetRestart, stoppedAt, markStopped }
}
