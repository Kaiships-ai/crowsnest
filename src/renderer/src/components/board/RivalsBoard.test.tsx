// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RivalsBoard } from './RivalsBoard'

const openPost = vi.hoisted(() => vi.fn())
vi.mock('./open-post', () => ({ openPostInBrowser: openPost }))

const T = '2026-10-02T08:00:00.000Z'
const post = (videoId: string, score: number) => ({
  videoId,
  url: `https://www.instagram.com/reel/${videoId}/`,
  caption: `Post ${videoId}`,
  outlierScore: score,
  viewCount: 12000,
  channel: {
    id: 'r1',
    handle: '@rival',
    displayName: null,
    avatarAssetId: null,
    followerCount: 5000,
    platform: 'instagram'
  }
})
const board = {
  channels: [
    {
      id: 'r1',
      handle: '@rival',
      displayName: 'Rival',
      followerCount: 5000,
      medianViews: 3000,
      outliers30d: 2,
      lastSyncedAt: T,
      syncError: null,
      outliers: [post('v1', 6.4), post('v2', 3)]
    }
  ],
  evidence: [
    {
      post: post('v1', 6.4),
      analysis: {
        tag: 'take',
        hookType: 'curiosity-gap',
        formatTags: ['talking-head'],
        styleTags: [],
        whyItWorked: 'Shows the result first.',
        summary: null,
        createdAt: T
      }
    },
    {
      post: post('v2', 3),
      analysis: {
        tag: null,
        hookType: null,
        formatTags: [],
        styleTags: [],
        whyItWorked: 'Asks and never answers.',
        summary: null,
        createdAt: T
      }
    }
  ]
}

function stubCall(...results: unknown[]): ReturnType<typeof vi.fn> {
  const call = vi.fn()
  for (const result of results) {
    call.mockResolvedValueOnce(result)
  }
  Object.assign(window, { api: { crowsnest: { call } } })
  return call
}

afterEach(() => {
  cleanup()
  openPost.mockReset()
})

describe('RivalsBoard', () => {
  it('files each analysis under Take, Learn or Avoid, untagged ones under Not sorted, and a card opens the original post', async () => {
    stubCall({ ok: true, value: board })
    render(<RivalsBoard />)
    const groups = await screen.findAllByTestId('rivals-group')
    const cards = (group: HTMLElement) =>
      within(group)
        .queryAllByTestId('rivals-evidence-card')
        .map((c) => c.dataset.videoId)
    expect(groups.map((g) => [g.dataset.group, cards(g)])).toEqual([
      ['take', ['v1']],
      ['learn', []],
      ['avoid', []],
      ['unsorted', ['v2']]
    ])
    const card = within(groups[0]).getByTestId('rivals-evidence-card')
    expect(card.textContent).toContain('Shows the result first.')
    fireEvent.click(within(card).getByTestId('rivals-evidence-open'))
    expect(openPost).toHaveBeenCalledWith('https://www.instagram.com/reel/v1/')
  })

  it('lists outliers best first and each channel once, each block naming Radar as its source', async () => {
    stubCall({ ok: true, value: board })
    render(<RivalsBoard />)
    const outliers = await screen.findAllByTestId('rivals-outlier')
    expect(outliers.map((o) => o.dataset.videoId)).toEqual(['v1', 'v2'])
    expect(screen.getByTestId('rivals-channel-row').dataset.handle).toBe('@rival')
    expect(screen.getAllByTestId('source-tag').map((t) => t.textContent?.split(' · ')[0])).toEqual([
      'Analysis',
      'Radar',
      'Radar'
    ])
  })

  it('adds a channel with a profile check, then reloads and keeps the confirmation', async () => {
    const call = stubCall(
      { ok: true, value: board },
      { ok: true, value: { ok: true, channelId: 'r2' } },
      { ok: true, value: board }
    )
    render(<RivalsBoard />)
    fireEvent.change(await screen.findByTestId('rivals-add-input'), {
      target: { value: '@newrival' }
    })
    fireEvent.click(screen.getByTestId('rivals-add-submit'))
    const message = await screen.findByTestId('rivals-add-message')
    expect(message.dataset.status).toBe('done')
    expect(call.mock.calls[1]).toEqual(['addChannelAction', '@newrival', { requireProfile: true }])
    await screen.findByTestId('rivals-channel-row')
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('shows why an add failed and writes nothing more', async () => {
    const call = stubCall(
      { ok: true, value: board },
      { ok: true, value: { ok: false, error: 'Channel @typo not found.' } }
    )
    render(<RivalsBoard />)
    fireEvent.change(await screen.findByTestId('rivals-add-input'), { target: { value: '@typo' } })
    fireEvent.click(screen.getByTestId('rivals-add-submit'))
    const message = await screen.findByTestId('rivals-add-message')
    expect([message.dataset.status, message.textContent]).toEqual([
      'error',
      'Channel @typo not found.'
    ])
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('keeps the add form when nothing is tracked yet', async () => {
    stubCall({ ok: true, value: { channels: [], evidence: [] } })
    render(<RivalsBoard />)
    await screen.findByTestId('rivals-add-input')
    expect(screen.queryByTestId('rivals-channel-row')).toBeNull()
  })
})
