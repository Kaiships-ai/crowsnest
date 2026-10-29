import { mmss } from './cook-claude-cards'
import type { CookCard, CookView } from './cook-pane-state'

/** The newest saved version's number, 0 before the first deliver. */
export const lastVersion = (view: CookView): number => view.versions.at(-1)?.n ?? 0

/** The feedback round Claude is working on: sent from the newest version, its result not saved yet. */
export function openRound(view: CookView): CookView['rounds'][number] | null {
  const round = view.rounds.at(-1)
  return round && round.from === lastVersion(view) ? round : null
}

/** The version Gate 2 gets: Kai's pick, else the newest. */
export const gateVersion = (view: CookView): number => view.use ?? lastVersion(view)

const stepDone = (view: CookView, name: string): boolean =>
  view.steps?.find((s) => s.name === name)?.status === 'done'

/** Proto 19 and 21: a feedback round in the making. Null when no round is open, or once Claude is
 *  reviewing the new final (the plain Review card then reads true). */
export function roundCard(view: CookView, group: string | null, so: string): CookCard | null {
  const round = openRound(view)
  if (!round) {
    return null
  }
  const from = `v${round.from}`
  const next = `v${round.from + 1}`
  if (group === 'Final' && stepDone(view, 'draft')) {
    return {
      state: 'v2-draft',
      tone: 'run',
      head: `${next} draft ready. Final ${next} rendering`,
      sub: `Step 5 of 6${so}`,
      acts: [],
      can: `Watch the ${next} draft, or switch back to ${from}.`,
      wait: `The final ${next} replaces the draft when it's done.`
    }
  }
  if (group === 'Review') {
    return null
  }
  return {
    state: 'v2-making',
    tone: 'run',
    head: `Making ${next} from your note`,
    sub: `"${round.note}"`,
    acts: [],
    can: `Watch ${from} meanwhile. It stays here.`,
    wait: `${next} appears next to ${from}. Nothing is overwritten.`
  }
}

/** Proto 17 (its version line), 22 and 24: the reel is delivered and saved in versions/. */
export function deliveredCard(view: CookView): CookCard {
  const last = view.versions.at(-1)
  const n = lastVersion(view)
  const pick = gateVersion(view)
  const facts = [
    last?.durationSec != null ? mmss(last.durationSec) : null,
    view.qa ? `QA ${view.qa}` : null
  ].filter(Boolean)
  if (!last || n < 2) {
    return {
      state: 'ready',
      tone: 'ok',
      head: 'Ready for Gate 2',
      ...(facts.length || last
        ? { sub: [last ? `v${n}` : null, ...facts].filter(Boolean).join(' · ') }
        : {}),
      acts: [],
      wait: 'Nothing posts. The reel waits here, and the Plan card reads Ready.'
    }
  }
  const rounds = view.rounds.length
  return {
    state: n === 2 ? 'v2-ready' : 'rounds',
    tone: 'ok',
    head: `v${n} ready`,
    sub:
      n === 2
        ? [last.change ? `Changed: ${last.change}` : null, ...facts].filter(Boolean).join(' · ')
        : [
            `${rounds} feedback round${rounds === 1 ? '' : 's'}`,
            last.change ? `changed: ${last.change}` : null
          ]
            .filter(Boolean)
            .join(' · '),
    acts: ['compare'],
    compare: [n - 1, n],
    can: `Compare, send more feedback, or send v${pick} to Gate 2.`,
    wait:
      n === 2 && pick === 2
        ? 'Nothing posts. Gate 2 gets v2 unless you pick v1.'
        : `Nothing posts. Gate 2 gets v${pick} unless you pick another.`
  }
}

/** Proto 23: Compare replaces the video and script boxes. */
export function compareCard(view: CookView, pair: [number, number]): CookCard {
  return {
    state: 'compare',
    tone: 'ok',
    head: `Comparing v${pair[0]} and v${pair[1]}`,
    sub: `Gate 2 gets the one you pick. Now: v${gateVersion(view)}.`,
    acts: ['donecompare'],
    can: 'Play both. Pick the one Gate 2 should get.',
    wait: 'The newest version stays picked.'
  }
}

/** Proto 40: studio-reel's render slot (RENDER_SLOTS=1) is held by another reel. */
export function queuedRenderCard(view: CookView): CookCard | null {
  const q = view.renderQueue
  if (!q) {
    return null
  }
  const when =
    q.startsInSec != null ? `, in about ${Math.max(1, Math.round(q.startsInSec / 60))} min` : ''
  return {
    state: 'queued-render',
    tone: 'run',
    head: 'In line for the render',
    sub: q.behind
      ? `"${q.behind}" is rendering. Yours starts after it${when}.`
      : `Another reel is rendering. Yours starts after it${when}.`,
    acts: [],
    can: 'Nothing to do. One render at a time keeps the Mac fast.',
    wait: 'Your render starts by itself.'
  }
}
