import { describe, expect, it } from 'vitest'
import { cookPrompt, reopenBanner, type CookClaude } from './cook-claude-cards'
import { cookCard, cookSegments, type CookView } from './cook-pane-state'

const STEPS = [
  'script',
  'voice',
  'storyboard',
  'chapters',
  'audio',
  'draft',
  'render',
  'verify',
  'review',
  'deliver'
]
const NOW = 1_800_000_000_000

function view(at: string, status: 'running' | 'waiting', cooking = true): CookView {
  const i = STEPS.indexOf(at)
  return {
    ok: true,
    title: 'Hooks',
    slug: 'hooks-a1b2c3',
    keyword: 'HOOKS',
    plannedDate: '2026-10-30',
    plannedTime: '19:30',
    cooking,
    workspaceId: cooking ? 'w1' : null,
    bootedAt: NOW - 86_400_000,
    root: '/tmp/studio-reel',
    planScript: null,
    steps: STEPS.map((name, n): NonNullable<CookView['steps']>[number] => ({
      name,
      status: n < i ? 'done' : n === i ? status : 'pending'
    })),
    qa: null,
    style: null,
    scriptLines: null,
    elapsedSec: null,
    pidGone: null,
    usualRenderSec: 180,
    video: null,
    versions: [],
    rounds: [],
    use: null,
    renderQueue: null
  }
}

const claude = (facts: Partial<CookClaude>): CookClaude => ({
  liveness: 'alive',
  prompt: null,
  askedAt: null,
  stoppedAt: null,
  restarted: false,
  ...facts
})

const HOOK = cookPrompt({
  questions: [
    {
      question: 'Which hook?',
      header: 'Hook',
      multiSelect: false,
      options: [{ label: 'Shorter hook (Recommended)' }, { label: 'Keep my hook' }]
    }
  ]
})

describe('Cook pane cards driven by Claude', () => {
  it('keeps Claude option order and marks the recommended one', () => {
    expect(HOOK).toMatchObject({
      kind: 'question',
      options: [
        { label: 'Shorter hook', recommended: true },
        { label: 'Keep my hook', recommended: false }
      ]
    })
  })

  it('asks with the waited time, and says still waiting after 30 min', () => {
    const asked = cookCard(
      view('script', 'waiting'),
      claude({ prompt: HOOK, askedAt: NOW - 40_000 }),
      NOW
    )
    expect([asked.state, asked.head, asked.sub]).toEqual([
      'ask',
      'Claude needs you: which hook?',
      'Asked 0:40 ago.'
    ])
    const long = cookCard(
      view('script', 'waiting'),
      claude({ prompt: HOOK, askedAt: NOW - 130 * 60_000 }),
      NOW
    )
    expect([long.state, long.head]).toEqual(['waiting-long', 'Still waiting for you: which hook?'])
    expect(long.sub).toMatch(/^Asked 2 h 10 min ago, at \d\d:\d\d\.$/)
  })

  it('tells a crash, a closed tab and a Mac restart apart, and marks the strip', () => {
    const v = view('chapters', 'running')
    expect(cookCard(v, claude({ liveness: 'exited' }), NOW)).toMatchObject({
      state: 'crashed',
      tone: 'err'
    })
    expect(cookCard(v, claude({ liveness: 'closed' }), NOW)).toMatchObject({
      state: 'stopped',
      tone: 'idle'
    })
    expect(cookCard(v, claude({ liveness: 'closed', restarted: true }), NOW).state).toBe(
      'reopen-dead'
    )
    // Tabs not restored yet: keep the running card, no grey flash.
    expect(cookCard(v, claude({ liveness: 'unknown' }), NOW)).toMatchObject({ tone: 'run' })
    expect(cookSegments(v, { stall: 'paused' })[2]).toMatchObject({
      group: 'Build',
      state: 'paused'
    })
  })

  it('a stopped cook reads stopped by you, and a cook that is cooking again ignores the stamp', () => {
    expect(
      cookCard(view('chapters', 'running', false), claude({ stoppedAt: NOW }), NOW)
    ).toMatchObject({
      state: 'stopped-by-kai',
      sub: '3 of 10 steps are done and kept. The slot is back to Plan.'
    })
    expect(cookCard(view('chapters', 'running'), claude({ stoppedAt: NOW }), NOW).state).toBe(
      'building'
    )
  })

  it('welcomes back with what finished while the app was closed', () => {
    expect(reopenBanner(22 * 60, ['Draft', 'Final'])).toBe(
      'Welcome back. While Lead Studio was closed (22 min), Claude kept cooking: Draft and Final are done.'
    )
  })
})
