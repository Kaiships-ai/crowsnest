// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { OwnBoard } from './OwnBoard'

const T = '2026-10-02T08:00:00.000Z'
const value = (v: number) => ({ status: 'value', value: v, capturedAt: T })
const missing = { status: 'missing' }
const total = (v: number, postsWithoutNumber = 0) => ({ ...value(v), postsWithoutNumber })
const noKeyword = { status: 'no-keyword' }
const ig = (views: number) => ({
  views: value(views),
  reach: missing,
  likes: value(5),
  comments: missing,
  shares: missing,
  saved: missing,
  reposts: missing,
  followsFromPost: missing,
  profileVisits: missing,
  bioLinkTaps: missing,
  avgWatchTimeMs: value(11200),
  skipRate: missing
})

const alpha = {
  ownPostId: 'alpha',
  permalink: 'https://www.instagram.com/reel/alpha/',
  caption: 'Alpha reel',
  format: 'Reel',
  postedAt: T,
  keyword: 'ALPHA',
  insightsError: null,
  ig: ig(1000),
  reachIndex: 1.4,
  after: { dm: value(40), gift_page_visit: value(12), purchase: value(2) }
}
const beta = {
  ...alpha,
  ownPostId: 'beta',
  caption: 'Beta reel',
  keyword: null,
  ig: ig(500),
  after: { dm: noKeyword, gift_page_visit: noKeyword, purchase: noKeyword }
}

const totals = Object.fromEntries(
  [
    'views',
    'reach',
    'likes',
    'comments',
    'shares',
    'saved',
    'followsFromPost',
    'profileVisits',
    'bioLinkTaps'
  ].map((k) => [k, { status: 'missing', postsWithoutNumber: 2 }])
)
const board = {
  username: 'kaiships.ai',
  windowDays: 30,
  followers: value(1000),
  netFollowers: value(100),
  totals: { ...totals, views: total(1500, 1) },
  viewsByFormat: [{ format: 'Reel', views: total(1500) }],
  after: { dm: total(40, 1), gift_page_visit: total(12, 1), purchase: total(2, 1) },
  posts: [alpha, beta],
  audience: {
    followerSplit: [],
    followerSplitAt: null,
    followerSplitError: null,
    audience: { age: [], country: [], gender: [] },
    audienceAt: null,
    audienceError: 'not enough users'
  }
}

type StepTotal = { status: string; value?: number; capturedAt?: string; connector?: string }
const step = (id: string, total: StepTotal) => ({
  id,
  label: id,
  source: 'polar',
  total: { ...total, keywordsWithoutNumber: 0 },
  rate: null
})
const reel = {
  post: alpha,
  history: [
    { capturedAt: T, views: 600 },
    { capturedAt: T, views: 1000 }
  ],
  after: {
    keyword: 'ALPHA',
    plan: { id: 'p', title: 'Alpha reel' },
    steps: [
      step('dm', value(40)),
      step('checkout', { status: 'not-connected', connector: 'polar' }),
      step('purchase', value(2))
    ]
  }
}

function stubCall(...results: unknown[]): ReturnType<typeof vi.fn> {
  const call = vi.fn()
  for (const result of results) {
    call.mockResolvedValueOnce(result)
  }
  Object.assign(window, { api: { crowsnest: { call } } })
  return call
}

const openTab = (id: string) => fireEvent.mouseDown(screen.getByTestId(id), { button: 0 })

afterEach(cleanup)

describe('OwnBoard', () => {
  it('opens on Tổng quan with each number next to its source, and a partial total says how many posts it misses', async () => {
    stubCall({ ok: true, value: board })
    render(<OwnBoard />)
    const views = await screen.findByTestId('own-stat-views')
    expect(views.textContent).toContain('1,500')
    expect(within(views).getByTestId('reading-post-gap').textContent).toBe('thiếu 1 bài')
    expect(within(views).getByTestId('source-label').textContent).toMatch(/^Instagram · /)
    expect(screen.getByTestId('own-stat-net').textContent).toContain('+100')
    expect(
      within(screen.getByTestId('own-total-dm')).getByTestId('source-label').textContent
    ).toMatch(/^ChatbotX · /)
  })

  it('lists posts with DM, Web and Đơn, and a post with no keyword reads chưa nối, never 0', async () => {
    stubCall({ ok: true, value: board })
    render(<OwnBoard />)
    await screen.findByTestId('own-tab-content')
    openTab('own-tab-content')
    const rows = await screen.findAllByTestId('own-post-row')
    expect(rows.map((r) => r.dataset.postId)).toEqual(['alpha', 'beta'])
    expect(within(rows[0]).getByTestId('own-after-dm').textContent).toBe('40')
    const betaDm = within(rows[1]).getByTestId('own-after-dm')
    expect(betaDm.dataset.status).toBe('no-keyword')
    expect(betaDm.textContent).toBe('chưa nối')
    fireEvent.click(screen.getByTestId('own-sort-views'))
    fireEvent.click(screen.getByTestId('own-sort-dm'))
    expect(screen.getAllByTestId('own-post-row').map((r) => r.dataset.postId)).toEqual([
      'alpha',
      'beta'
    ])
  })

  it('asks for the 7-day window when the toggle changes', async () => {
    const call = stubCall(
      { ok: true, value: board },
      { ok: true, value: { ...board, windowDays: 7 } }
    )
    render(<OwnBoard />)
    fireEvent.click(await screen.findByTestId('own-days-7'))
    await screen.findByTestId('own-stat-views')
    expect(call.mock.calls.map((c) => c[1])).toEqual([30, 7])
  })

  it('opens a reel and its Sau reel tab walks the funnel by keyword, with checkout chưa nối', async () => {
    const call = stubCall({ ok: true, value: board }, { ok: true, value: reel })
    render(<OwnBoard />)
    await screen.findByTestId('own-tab-content')
    openTab('own-tab-content')
    fireEvent.click(
      within((await screen.findAllByTestId('own-post-row'))[0]).getByTestId('own-open-reel')
    )
    expect((await screen.findByTestId('own-reel-avgWatchTimeMs')).textContent).toContain('11.2s')
    expect(call).toHaveBeenLastCalledWith('getOwnReelBoard', 'alpha')
    openTab('own-reel-tab-after')
    const steps = await screen.findAllByTestId('own-after-step')
    expect(steps.map((s) => [s.dataset.stepId, s.dataset.status])).toEqual([
      ['dm', 'value'],
      ['checkout', 'not-connected'],
      ['purchase', 'value']
    ])
    expect(within(steps[1]).getByTestId('reading-not-connected').textContent).toContain('chưa nối')
    fireEvent.click(screen.getByTestId('own-reel-back'))
    expect(await screen.findAllByTestId('own-post-row')).toHaveLength(2)
  })

  it('shows the empty state before the channel was ever measured, and the error state on a failed read', async () => {
    stubCall({ ok: true, value: { ...board, username: null, posts: [], followers: missing } })
    render(<OwnBoard />)
    await screen.findByTestId('board-state-empty')
    cleanup()
    stubCall({ ok: false, error: { code: 'failed', message: 'no such table: own_posts' } })
    render(<OwnBoard />)
    expect((await screen.findByTestId('board-state-error')).textContent).toContain(
      'no such table: own_posts'
    )
  })
})
