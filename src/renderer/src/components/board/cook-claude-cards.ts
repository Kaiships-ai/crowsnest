import type { AskPrompt } from '../../../../shared/native-chat-ask'
import type { CookAction, CookCard, CookView } from './cook-pane-state'

/** What Claude is asking for, read from Orca's hook state for the cook's Claude terminal. */
export type CookPrompt =
  | { kind: 'question'; ask: AskPrompt; question: string; options: CookOption[] }
  | {
      kind: 'approval'
      tool: string
      detail?: string
      allow: string
      always?: string
      deny: string
    }
  /** A question the card cannot answer in one click (several questions, or multi-select). */
  | { kind: 'terminal' }

type CookOption = { label: string; description?: string; recommended: boolean }

/** Claude in the reel workspace, from Orca's tabs and hook state. */
export type CookClaude = {
  /** alive: Claude runs in the newest Claude tab; exited: the tab is there but Claude left it;
   *  closed: no Claude tab. */
  liveness: 'alive' | 'exited' | 'closed'
  prompt: CookPrompt | null
  /** When Orca saw Claude start waiting on the prompt (ms). */
  askedAt: number | null
  /** Kai stopped the cook with Stop cook (ms). */
  stoppedAt: number | null
  /** The Mac restarted since the pane last saw this cook (app reopened, proto 36). */
  restarted: boolean
}

export const NO_CLAUDE_FACTS: CookClaude = {
  liveness: 'alive',
  prompt: null,
  askedAt: null,
  stoppedAt: null,
  restarted: false
}

export const mmss = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`

const RECOMMENDED = /\s*\(recommended\)\s*$/i

/** One-click options for Claude's AskUserQuestion, in Claude's order (the digit sent is the index). */
export function cookPrompt(ask: AskPrompt | null): CookPrompt | null {
  if (!ask) {
    return null
  }
  const [q] = ask.questions
  if (!q || ask.questions.length > 1 || q.multiSelect || q.options.length === 0) {
    return { kind: 'terminal' }
  }
  return {
    kind: 'question',
    ask,
    question: q.question,
    options: q.options.map((o) => ({
      label: o.label.replace(RECOMMENDED, ''),
      ...(o.description ? { description: o.description } : {}),
      recommended: RECOMMENDED.test(o.label)
    }))
  }
}

/** "0:40" under an hour, else "2 h 10 min" (proto 12 and 15). */
export function waited(sec: number): string {
  if (sec < 3600) {
    return mmss(sec)
  }
  const min = Math.floor(sec / 60)
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** ponytail: a fixed 30 min; the proto names no threshold for "waiting a long time". */
const LONG_WAIT_SEC = 30 * 60

/** The card for Claude's question or permission prompt (proto 12 to 15). */
function promptCard(
  view: CookView,
  prompt: CookPrompt,
  askedSec: number,
  askedAt: number
): CookCard {
  if (prompt.kind === 'terminal') {
    return {
      state: 'waiting',
      tone: 'need',
      head: 'Claude is waiting for you in the terminal',
      acts: ['terminal'],
      wait: 'Claude waits here. Nothing else runs until you answer.'
    }
  }
  if (prompt.kind === 'approval') {
    return {
      state: 'permission',
      tone: 'need',
      head:
        prompt.tool === 'Bash'
          ? 'Claude asks to run a command'
          : `Claude asks to use ${prompt.tool}`,
      sub: `Claude Code needs your OK first. Asked ${waited(askedSec)} ago.`,
      acts: [],
      wait: 'Claude waits. Nothing runs until you answer.',
      prompt
    }
  }
  const q = prompt.question.charAt(0).toLowerCase() + prompt.question.slice(1)
  if (askedSec >= LONG_WAIT_SEC) {
    return {
      state: 'waiting-long',
      tone: 'need',
      head: `Still waiting for you: ${q}`,
      sub: `Asked ${waited(askedSec)} ago, at ${clock(askedAt)}.`,
      acts: [],
      wait: view.plannedTime
        ? `Claude keeps waiting. At ${view.plannedTime} the slot turns Missed; the cook keeps its place.`
        : 'Claude keeps waiting. The cook keeps its place.',
      prompt
    }
  }
  return {
    state: 'ask',
    tone: 'need',
    head: `Claude needs you: ${q}`,
    sub: `Asked ${waited(askedSec)} ago.`,
    acts: [],
    wait: 'Claude waits here. Nothing else runs until you answer.',
    prompt
  }
}

export const RESUME_LINES = {
  can: 'Resume. Lead Studio starts Claude again here, and it skips the done steps.',
  wait: 'Nothing runs. The Plan card shows Paused.'
}

/** Cards that win over job.json: Kai stopped the cook (42), or Claude asks (12 to 15). */
export function claudeFirstCard(view: CookView, claude: CookClaude, now: number): CookCard | null {
  if (claude.stoppedAt != null && !view.cooking) {
    const steps = view.steps ?? []
    return {
      state: 'stopped-by-kai',
      tone: 'idle',
      head: `Cook stopped by you at ${clock(claude.stoppedAt)}`,
      sub: `${steps.filter((s) => s.status === 'done').length} of ${steps.length || 10} steps are done and kept. The slot is back to Plan.`,
      acts: ['resume'],
      can: 'Resume here.',
      wait: 'Nothing runs. You can also cook it again from Plan.'
    }
  }
  if (claude.prompt && claude.liveness === 'alive') {
    const askedAt = claude.askedAt ?? now
    return promptCard(view, claude.prompt, Math.max(0, (now - askedAt) / 1000), askedAt)
  }
  return null
}

/** Claude is gone mid-cook: the Mac restarted (36), it crashed (32), or its tab closed (34). */
export function claudeGoneCard(
  view: CookView,
  claude: CookClaude,
  step: string,
  group: string
): CookCard | null {
  if (!view.cooking || claude.liveness === 'alive') {
    return null
  }
  const steps = view.steps ?? []
  const done = steps.filter((s) => s.status === 'done').length
  const resume = { acts: ['resume', 'terminal'] satisfies CookAction[], ...RESUME_LINES }
  const during = `during ${group} (${step}). ${done} of ${steps.length} steps are done and kept.`
  if (claude.restarted) {
    return {
      state: 'reopen-dead',
      tone: 'idle',
      head: 'Claude stopped when your Mac restarted',
      sub: `During ${group} (${step}). ${done} of ${steps.length} steps are done and kept.${
        step === 'render'
          ? ` The final starts again from frame 0 (about ${Math.max(1, Math.round(view.usualRenderSec / 60))} min).`
          : ''
      }`,
      acts: ['resume'],
      wait: 'Nothing runs until you resume.'
    }
  }
  return claude.liveness === 'exited'
    ? {
        state: 'crashed',
        tone: 'err',
        head: 'Claude stopped unexpectedly',
        sub: `The Claude process exited, ${during}`,
        ...resume
      }
    : {
        state: 'stopped',
        tone: 'idle',
        head: 'Claude is not running',
        sub: `The terminal tab was closed, ${during}`,
        acts: ['resume'],
        can: 'Resume. Claude starts in a new terminal here and skips the done steps.',
        wait: RESUME_LINES.wait
      }
}

const listJoin = (xs: string[]): string =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? '')

/** The one blue line after the app reopens while Claude kept cooking (proto 35). */
export function reopenBanner(closedSec: number, newlyDone: string[]): string {
  const away =
    closedSec >= 3600 ? waited(closedSec) : `${Math.max(1, Math.round(closedSec / 60))} min`
  const head = `Welcome back. While Lead Studio was closed (${away}), Claude kept cooking`
  return newlyDone.length > 0
    ? `${head}: ${listJoin(newlyDone)} ${newlyDone.length > 1 ? 'are' : 'is'} done.`
    : `${head}.`
}
