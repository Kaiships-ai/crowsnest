// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FunnelBoard } from './FunnelBoard'

const T = '2026-10-02T08:00:00.000Z'
const value = (v: number) => ({ status: 'value', value: v, capturedAt: T })
const notConnected = (connector: string) => ({ status: 'not-connected', connector })

const board = {
  steps: [
    {
      id: 'view',
      label: 'Views',
      source: 'instagram',
      total: { ...value(1000), missingKeywords: 2 },
      rate: null
    },
    {
      id: 'checkout',
      label: 'Checkouts',
      source: 'polar',
      total: { ...notConnected('polar'), missingKeywords: 0 },
      rate: {
        id: 'checkout_rate',
        label: 'Checkout rate',
        target: null,
        reading: notConnected('polar')
      }
    },
    {
      id: 'purchase',
      label: 'Purchases',
      source: 'polar',
      total: { ...value(3), missingKeywords: 0 },
      rate: {
        id: 'purchase_rate',
        label: 'Purchase rate',
        target: null,
        reading: { status: 'missing' }
      }
    }
  ],
  keywords: [
    {
      keyword: 'ALPHA',
      plan: { id: 'p1', title: 'Alpha reel' },
      steps: [value(1000), notConnected('polar'), value(3)]
    }
  ],
  coverage: { visits: { status: 'value', tied: 30, total: 35 }, orders: { status: 'missing' } }
}

function stubCall(...results: unknown[]): void {
  const call = vi.fn()
  for (const result of results) {
    call.mockResolvedValueOnce(result)
  }
  Object.assign(window, { api: { crowsnest: { call } } })
}

afterEach(cleanup)

describe('FunnelBoard', () => {
  it('shows each step with its source and time, and a not-connected step as chưa nối with a Vault link, never 0', async () => {
    stubCall({ ok: true, value: board })
    render(<FunnelBoard />)
    const steps = await screen.findAllByTestId('funnel-step')
    expect(steps.map((s) => s.dataset.stepId)).toEqual(['view', 'checkout', 'purchase'])
    expect(steps[0].textContent).toContain('1,000')
    expect(steps[0].textContent).toContain('Instagram ·')
    expect(steps[0].textContent).toContain('thiếu 2 keyword')
    const checkout = steps[1]
    expect(checkout.querySelector('[data-testid="reading-not-connected"]')?.textContent).toContain(
      'chưa nối'
    )
    expect(checkout.querySelector('[data-testid="open-vault"]')).toBeTruthy()
    expect(checkout.querySelector('[data-testid="reading-value"]')).toBeNull()
    expect(checkout.textContent).toContain('chưa đặt chuẩn')
  })

  it('shows the keyword rows and the coverage line', async () => {
    stubCall({ ok: true, value: board })
    render(<FunnelBoard />)
    const row = await screen.findByTestId('funnel-keyword-row')
    expect(row.textContent).toContain('Alpha reel')
    expect(screen.getByTestId('funnel-coverage-visits').textContent).toContain('30 / 35')
    expect(screen.getByTestId('funnel-coverage-orders').textContent).toContain('chưa có số')
  })

  it('shows the empty state when no keyword has a number', async () => {
    stubCall({ ok: true, value: { ...board, keywords: [] } })
    render(<FunnelBoard />)
    expect(await screen.findByTestId('board-state-empty')).toBeTruthy()
  })
})
