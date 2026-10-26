// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChannelsBoard } from './ChannelsBoard'

const channel = {
  id: 'c1',
  handle: '@e2e_fixture_creator',
  displayName: 'Fixture',
  followerCount: 1200,
  medianViews: null,
  outliers30d: 3
}

function stubCall(...results: unknown[]): ReturnType<typeof vi.fn> {
  const call = vi.fn()
  for (const result of results) {
    call.mockResolvedValueOnce(result)
  }
  Object.assign(window, { api: { crowsnest: { call } } })
  return call
}

afterEach(cleanup)

describe('ChannelsBoard', () => {
  it('lists each channel with its counts', async () => {
    stubCall({ ok: true, value: [channel] })
    render(<ChannelsBoard />)
    const row = await screen.findByTestId('board-channels-row')
    expect(row.textContent).toContain('@e2e_fixture_creator')
    expect(row.textContent).toContain('1,200')
  })

  it('shows the empty state for zero channels', async () => {
    stubCall({ ok: true, value: [] })
    render(<ChannelsBoard />)
    expect(await screen.findByTestId('board-state-empty')).toBeTruthy()
  })

  it('shows the bridge error, and Retry loads again', async () => {
    const call = stubCall(
      { ok: false, error: { code: 'failed', message: 'no such table: channels' } },
      { ok: true, value: [channel] }
    )
    render(<ChannelsBoard />)
    const error = await screen.findByTestId('board-state-error')
    expect(error.textContent).toContain('no such table: channels')
    fireEvent.click(screen.getByTestId('board-retry'))
    expect(await screen.findByTestId('board-channels-row')).toBeTruthy()
    expect(call).toHaveBeenCalledTimes(2)
  })
})
