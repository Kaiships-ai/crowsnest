import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'

export type CookView = Extract<EngineCallValue<'getCookView'>, { ok: true }>
type CookJobStep = NonNullable<CookView['steps']>[number]

/** The 6 segments the pane draws over job.json's 10 steps (proto v2). */
export const COOK_GROUPS = [
  { group: 'Script', steps: ['script'] },
  { group: 'Voice', steps: ['voice'] },
  { group: 'Build', steps: ['storyboard', 'chapters', 'audio'] },
  { group: 'Draft', steps: ['draft'] },
  { group: 'Final', steps: ['render', 'verify'] },
  { group: 'Review', steps: ['review', 'deliver'] }
] as const

export type CookGroup = (typeof COOK_GROUPS)[number]['group']

export type CookTone = 'run' | 'need' | 'err' | 'ok'
export type SegmentState = 'done' | 'current' | 'waiting' | 'failed' | 'pending'
export type CookAction = 'retry' | 'resume' | 'terminal'

export type CookCard = {
  /** The proto v2 state this card is, for journeys and docs. */
  state: string
  tone: CookTone
  head: string
  sub?: string
  note?: string
  acts: CookAction[]
  can?: string
  wait?: string
}

export type CookSegment = { group: CookGroup; state: SegmentState; time?: string; pct?: number }

export const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`

const NOTHING = 'Nothing to do. You can leave; the Plan card shows the progress.'

function groupOf(step: string): number {
  return COOK_GROUPS.findIndex((g) => (g.steps as readonly string[]).includes(step))
}

/** The step the cook is on: the running, waiting or failed one, else the first not yet done. */
function currentStep(steps: CookJobStep[]): CookJobStep | undefined {
  return (
    steps.find((s) => s.status === 'running' || s.status === 'waiting' || s.status === 'failed') ??
    steps.find((s) => s.status !== 'done')
  )
}

export function cookSegments(view: CookView): CookSegment[] {
  const steps = view.steps ?? []
  const current = currentStep(steps)
  const at = current ? groupOf(current.name) : -1
  return COOK_GROUPS.map((g, i) => {
    const mine = steps.filter((s) => (g.steps as readonly string[]).includes(s.name))
    if (mine.length > 0 && mine.every((s) => s.status === 'done')) {
      return { group: g.group, state: 'done' }
    }
    if (i !== at || !current) {
      return { group: g.group, state: 'pending' }
    }
    const state: SegmentState =
      current.status === 'failed' || view.pidGone
        ? 'failed'
        : current.status === 'waiting'
          ? 'waiting'
          : 'current'
    return {
      group: g.group,
      state,
      ...(view.elapsedSec != null ? { time: mmss(view.elapsedSec) } : {}),
      ...(current.pct != null ? { pct: current.pct } : {})
    }
  })
}

/** The one status card on top of the pane: proto v2 states 02 to 11 plus the failures job.json can express. */
export function cookCard(view: CookView): CookCard {
  if (!view.steps) {
    return view.cooking
      ? {
          state: 'starting',
          tone: 'run',
          head: 'Starting Claude in this workspace',
          sub: `Usually under 10 s. Your script is saved as workspace/scripts/${view.slug}.md`,
          acts: [],
          can: 'Nothing to do.',
          wait: 'Claude starts and runs /make-reel by itself. If it is not ready in 60 s, this card offers Retry cook.'
        }
      : {
          state: 'start-failed',
          tone: 'err',
          head: 'Claude did not start',
          sub: 'The terminal opened, but Claude was not ready after 60 s. Nothing ran.',
          acts: ['retry', 'terminal'],
          can: 'Retry. If it fails again, the terminal shows why (often: Claude Code is not signed in).',
          wait: 'Nothing runs. The slot is back to Plan.'
        }
  }
  const steps = view.steps
  const done = steps.filter((s) => s.status === 'done').length
  const current = currentStep(steps)
  if (!current) {
    return {
      state: 'ready',
      tone: 'ok',
      head: 'Ready for Gate 2',
      ...(view.qa ? { sub: `QA ${view.qa}` } : {}),
      acts: [],
      wait: 'Nothing posts. The reel waits here, and the Plan card reads Ready.'
    }
  }
  // Why Review: job.json names only the 10 known steps; an unknown one sits at the end.
  const group = COOK_GROUPS[groupOf(current.name)]?.group ?? 'Review'
  const kept = `During ${group} (${current.name}). ${done} of ${steps.length} steps are done and kept.`
  const resume = {
    acts: ['resume', 'terminal'] satisfies CookAction[],
    can: 'Resume. Lead Studio starts Claude again here, and it skips the done steps.',
    wait: 'Nothing runs. The Plan card shows Paused.'
  }
  if (current.status === 'failed') {
    return {
      state: 'step-failed',
      tone: 'err',
      head: `The ${current.name} step failed`,
      sub: kept,
      ...resume
    }
  }
  if (current.status === 'running' && view.pidGone) {
    return {
      state: 'pid-gone',
      tone: 'err',
      head: `The ${current.name} process stopped`,
      sub: `${kept} Its process (pid ${current.pid}) is gone.`,
      ...resume
    }
  }
  if (current.status === 'waiting') {
    return {
      state: 'waiting',
      tone: 'need',
      head: 'Claude is waiting for you in the terminal',
      acts: ['terminal'],
      wait: 'Claude waits here. Nothing else runs until you answer.'
    }
  }
  const so = view.elapsedSec != null ? ` · ${mmss(view.elapsedSec)} so far` : ''
  switch (group) {
    case 'Script':
      return {
        state: 'script',
        tone: 'run',
        head: 'Claude is copying your script into the reel',
        sub: `Step 1 of 6 · word for word${so}`,
        acts: [],
        can: NOTHING,
        wait: 'Claude checks the hook length, then records the voice.'
      }
    case 'Voice':
      return {
        state: 'script-ready',
        tone: 'run',
        head: 'Script ready. Claude is recording the voice',
        sub: `Step 2 of 6${so}`,
        acts: [],
        can: 'Read the script. It is your words.',
        wait: 'Claude builds the chapters next. Nothing needs you until the draft.'
      }
    case 'Build':
      return {
        state: 'building',
        tone: 'run',
        head: 'Claude is building the chapters',
        sub: `Step 3 of 6${so}`,
        acts: [],
        can: NOTHING,
        wait: 'Claude mixes the music, then renders a quick draft for you.'
      }
    case 'Draft':
      return {
        state: 'draft',
        tone: 'run',
        head: 'Rendering a quick draft',
        sub: `Step 4 of 6${current.pct != null ? ` · ${current.pct}%` : ''}${so}`,
        acts: [],
        can: 'Nothing to do.',
        wait: 'The draft plays here, then the final render starts by itself.'
      }
    case 'Final': {
      // Why no %: the full render reports none yet, so the pane shows elapsed against the usual time.
      const el = view.elapsedSec
      const usual = mmss(view.usualRenderSec)
      if (current.name === 'render' && el != null && el > 2 * view.usualRenderSec) {
        return {
          state: 'long-render',
          tone: 'run',
          head: 'Rendering the final video, slower than usual',
          sub: `Step 5 of 6 · ${mmss(el)} so far, usually about ${usual}`,
          note: `The render process is alive${current.pid ? ` (pid ${current.pid})` : ''}, so it is working, only slowly.`,
          acts: [],
          can: 'Leave it, or ask Claude why.',
          wait: 'It keeps rendering. If the process stops, this card turns red with Resume.'
        }
      }
      return {
        state: 'rendering',
        tone: 'run',
        head: 'Rendering the final video',
        sub:
          current.name === 'render' && el != null
            ? `Step 5 of 6 · ${mmss(el)} so far, usually about ${usual}`
            : `Step 5 of 6${so}`,
        acts: [],
        wait: 'When the render is done, Claude checks it and reviews it.'
      }
    }
    case 'Review':
      return {
        state: 'mp4-ready',
        tone: 'run',
        head: 'Final video ready. Claude is reviewing it',
        sub: `Step 6 of 6${view.qa ? ` · QA ${view.qa}` : ''}`,
        acts: [],
        wait: 'Claude writes the caption and hands the reel to you.'
      }
  }
}
