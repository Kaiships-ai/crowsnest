import type { EngineCallValue } from '../../../../preload/api/crowsnest-api'
import {
  claudeFirstCard,
  claudeGoneCard,
  mmss,
  NO_CLAUDE_FACTS,
  RESUME_LINES,
  type CookClaude,
  type CookPrompt
} from './cook-claude-cards'
import { deliveredCard, openRound, queuedRenderCard, roundCard } from './cook-version-cards'

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

export type CookTone = 'run' | 'need' | 'err' | 'ok' | 'idle'
export type SegmentState = 'done' | 'current' | 'waiting' | 'failed' | 'paused' | 'pending'
export type CookAction = 'retry' | 'resume' | 'terminal' | 'compare' | 'donecompare'

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
  prompt?: CookPrompt
  /** The plain-text question fallback: a reply box that types into the terminal. */
  reply?: boolean
  /** The two versions Compare shows (proto 22). */
  compare?: [number, number]
}

export type CookSegment = { group: CookGroup; state: SegmentState; time?: string; pct?: number }

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

/** `asked`: Claude waits on a question that long. `stall`: Claude is gone, so the step is failed
 *  (crashed) or paused (closed, restarted, stopped). */
export function cookSegments(
  view: CookView,
  { asked, stall }: { asked?: string; stall?: 'failed' | 'paused' } = {}
): CookSegment[] {
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
    if (stall) {
      return { group: g.group, state: stall }
    }
    const state: SegmentState =
      current.status === 'failed' || view.pidGone
        ? 'failed'
        : current.status === 'waiting' || asked
          ? 'waiting'
          : 'current'
    return {
      group: g.group,
      state,
      ...(asked
        ? { time: `asked ${asked}` }
        : current.name === 'render' && view.renderQueue
          ? { time: 'in line' }
          : view.elapsedSec != null
            ? { time: mmss(view.elapsedSec) }
            : {}),
      ...(current.pct != null ? { pct: current.pct } : {})
    }
  })
}

/** The one status card on top of the pane: proto v2 states 02 to 15, 32 to 36 and 42, plus the
 *  failures job.json can express. */
export function cookCard(
  view: CookView,
  claude: CookClaude = NO_CLAUDE_FACTS,
  now: number = Date.now()
): CookCard {
  const steps = view.steps ?? []
  const done = steps.filter((s) => s.status === 'done').length
  const early = claudeFirstCard(view, claude, now)
  if (early) {
    return early
  }
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
  const current = currentStep(steps)
  if (!current) {
    // Why: right after feedback is sent, every step still reads done until Claude starts the round.
    return (openRound(view) && roundCard(view, null, '')) || deliveredCard(view)
  }
  // Why Review: job.json names only the 10 known steps; an unknown one sits at the end.
  const group = COOK_GROUPS[groupOf(current.name)]?.group ?? 'Review'
  const kept = `During ${group} (${current.name}). ${done} of ${steps.length} steps are done and kept.`
  const resume = { acts: ['resume', 'terminal'] satisfies CookAction[], ...RESUME_LINES }
  const gone = claudeGoneCard(view, claude, current.name, group)
  if (gone) {
    return gone
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
      sub: `${kept} Its process (pid ${current.pid}) is gone.${
        current.name === 'render'
          ? ` The final starts again from frame 0 (about ${Math.max(1, Math.round(view.usualRenderSec / 60))} min).`
          : ''
      }`,
      ...resume
    }
  }
  if (current.status === 'waiting') {
    return {
      state: 'waiting',
      tone: 'need',
      head: 'Claude is waiting for you in the terminal',
      acts: ['terminal'],
      wait: 'Claude waits here. Nothing else runs until you answer.',
      reply: true
    }
  }
  const so = view.elapsedSec != null ? ` · ${mmss(view.elapsedSec)} so far` : ''
  const queued = current.name === 'render' ? queuedRenderCard(view) : null
  const round = queued ?? roundCard(view, group, so)
  if (round) {
    return round
  }
  const draftPlays = view.video?.kind === 'draft'
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
        // draft.mjs in studio-reel renders at 270x480 and 8 fps unless called with --w/--fps, which nothing does.
        sub: `Step 4 of 6 · 270×480 at 8 fps${current.pct != null ? ` · ${current.pct}%` : ''}${so}`,
        acts: [],
        can: 'Nothing to do.',
        wait: 'The draft plays here, then the final render starts by itself.'
      }
    case 'Final': {
      // Why no %: the full render reports none yet, so the pane shows elapsed against the usual time.
      const el = view.elapsedSec
      const usual = mmss(view.usualRenderSec)
      // ponytail: "just started" is the render's first minute; the proto draws 08 at 4%.
      if (current.name === 'render' && draftPlays && (el == null || el < 60)) {
        return {
          state: 'draft-ready',
          tone: 'run',
          head: 'Draft ready to watch. Final render running',
          sub: `Step 5 of 6 · 1080×1920${el != null ? ` · ${mmss(el)} so far, usually about ${usual}` : ''}`,
          acts: [],
          can: 'Watch the draft. Feedback can go in now; Claude reads it after the final.',
          wait: 'The final replaces the draft in this player.'
        }
      }
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
        ...(draftPlays ? { can: 'Watch the draft meanwhile.' } : {}),
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
        ...(view.video?.kind === 'final'
          ? { can: 'Watch the final. Claude may fix small things and render again.' }
          : {}),
        wait: 'Claude writes the caption and hands the reel to you.'
      }
  }
}
