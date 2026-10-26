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
      total: { ...value(1000), keywordsWithoutNumber: 2 },
      rate: null,
      pull: null
    },
    {
      id: 'checkout',
      label: 'Checkouts',
      source: 'polar',
      total: { ...notConnected('polar'), keywordsWithoutNumber: 0 },
      rate: {
        id: 'checkout_rate',
        label: 'Checkout rate',
        target: null,
        reading: notConnected('polar')
      },
      pull: null
    },
    {
      id: 'purchase',
      label: 'Purchases',
      source: 'polar',
      total: { ...value(3), keywordsWithoutNumber: 0 },
      rate: {
        id: 'purchase_rate',
        label: 'Purchase rate',
        target: null,
        reading: { status: 'missing' }
      },
      pull: 'failed'
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
  it('names the sources once per block and shows every step state under its number, never 0', async () => {
    stubCall({ ok: true, value: board })
    render(<FunnelBoard />)
    const steps = await screen.findAllByTestId('funnel-step')
    expect(steps.map((s) => s.dataset.stepId)).toEqual(['view', 'checkout', 'purchase'])
    expect(screen.getAllByTestId('source-tag')[0].textContent).toContain('Instagram · Polar · pulled')
    const state = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="kpi-value"]')
    expect(state(steps[0])?.dataset.state).toBe('partial')
    expect(steps[0].textContent).toContain('1,000')
    expect(steps[0].textContent).toContain('missing 2 keywords')
    expect(state(steps[1])?.dataset.state).toBe('not-connected')
    expect(steps[1].querySelector('[data-testid="open-sources"]')?.textContent).toContain(
      'Polar not connected'
    )
    expect(steps[1].querySelector('[data-num]')).toBeNull()
    expect(steps[1].textContent).toContain('no target set')
    expect(state(steps[2])?.dataset.state).toBe('pull-failed')
    expect(steps[2].textContent).toContain('Polar pull failed')
  })

  it('shows the keyword rows and the coverage line', async () => {
    stubCall({ ok: true, value: board })
    render(<FunnelBoard />)
    const row = await screen.findByTestId('funnel-keyword-row')
    expect(row.textContent).toContain('Alpha reel')
    expect(screen.getByTestId('funnel-coverage-visits').textContent).toContain('30 / 35')
    expect(screen.getByTestId('funnel-coverage-orders').textContent).toContain('no data yet')
  })

  it('shows the empty state when no keyword has a number', async () => {
    stubCall({ ok: true, value: { ...board, keywords: [] } })
    render(<FunnelBoard />)
    expect(await screen.findByTestId('board-state-empty')).toBeTruthy()
  })
})
