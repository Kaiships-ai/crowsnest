// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { runningWorkspaces, TodayBoard } from './TodayBoard'

const T = '2026-10-02T08:00:00.000Z'
const step = (id: string, total: unknown) => ({
  id,
  label: id,
  source: 'polar',
  total,
  rate: null,
  pull: null
})
const checkout = step('checkout', {
  status: 'not-connected',
  connector: 'polar',
  keywordsWithoutNumber: 0
})
const purchase = step('purchase', {
  status: 'value',
  value: 4,
  capturedAt: T,
  keywordsWithoutNumber: 0
})

const board = {
  at: T,
  steps: [checkout, purchase],
  offer: [checkout, purchase],
  drop: { status: 'no-target' },
  gates: { proposedPlansAhead: 1, pendingDrafts: 2 },
  pulls: [
    {
      id: 'instagram-graph',
      label: 'Instagram Graph',
      state: 'partial',
      lastPull: {
        slot: '2026-10-02',
        at: T,
        outcome: 'partial',
        detail: 'missing page 2: rate limited'
      }
    },
    { id: 'groq', label: 'Groq', state: 'not-connected', lastPull: null }
  ]
}

afterEach(cleanup)

describe('TodayBoard', () => {
  it('names the source of every block, shows the state of every number, and a partial pull as Partial', async () => {
    Object.assign(window, {
      api: { crowsnest: { call: vi.fn().mockResolvedValue({ ok: true, value: board }) } }
    })
    render(<TodayBoard />)
    for (const id of ['today-offer', 'today-funnel', 'today-gates', 'today-pulls', 'today-workspaces']) {
      const block = await screen.findByTestId(id)
      expect(block.querySelector('[data-testid="source-tag"]'), id).toBeTruthy()
    }
    const offer = screen.getAllByTestId('today-offer-step')
    expect(offer[0].querySelector('[data-testid="open-sources"]')?.textContent).toContain(
      'Polar not connected'
    )
    expect(offer[1].textContent).toContain('4')
    expect(screen.getByTestId('today-drop').dataset.status).toBe('no-target')
    expect(screen.getByTestId('today-gate-plans').textContent).toBe('1')
    expect(screen.getByTestId('today-gate-drafts').textContent).toBe('2')
    const pull = screen.getAllByTestId('today-pull-row')[0]
    expect(pull.dataset.state).toBe('partial')
    expect(pull.textContent).toContain('Partial')
    expect(pull.textContent).not.toContain('Connected')
  })
})

describe('TodayBoard partial sums', () => {
  it('marks a total summed over only some keywords as missing N keywords in the offer and the funnel', async () => {
    const partial = step('purchase', {
      status: 'value',
      value: 2,
      capturedAt: T,
      keywordsWithoutNumber: 1
    })
    const value = { ...board, steps: [checkout, partial], offer: [checkout, partial] }
    Object.assign(window, {
      api: { crowsnest: { call: vi.fn().mockResolvedValue({ ok: true, value }) } }
    })
    render(<TodayBoard />)
    for (const id of ['today-offer-step', 'today-step']) {
      const purchaseCell = (await screen.findAllByTestId(id)).find(
        (el) => el.dataset.stepId === 'purchase'
      )
      expect(purchaseCell?.querySelector('[data-testid="kpi-state"]')?.textContent).toBe(
        'missing 1 keywords'
      )
    }
  })
})

describe('runningWorkspaces', () => {
  const entry = (paneKey: string, state: AgentStatusEntry['state'], worktreeId?: string) => ({
    paneKey,
    state,
    worktreeId
  })

  it('groups live agents by workspace, finds the workspace through the tab, and skips done agents', () => {
    const tabs = { 'wt-b': [{ id: 'tab-b', worktreeId: 'wt-b' }] }
    const names: Record<string, string> = { 'wt-a': 'Alpha', 'wt-b': 'Beta' }
    const rows = runningWorkspaces(
      {
        p1: entry('tab-a:1', 'working', 'wt-a'),
        p2: entry('tab-a:2', 'waiting', 'wt-a'),
        p3: entry('tab-b:1', 'blocked'),
        p4: entry('tab-c:1', 'done', 'wt-c')
      },
      tabs,
      (id) => names[id]
    )
    expect(rows).toEqual([
      { id: 'wt-a', name: 'Alpha', working: 1, waiting: 1 },
      { id: 'wt-b', name: 'Beta', working: 0, waiting: 1 }
    ])
  })
})
