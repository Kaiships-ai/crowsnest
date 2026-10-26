// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PlanBoard } from './PlanBoard'

const openPost = vi.hoisted(() => vi.fn())
vi.mock('./open-post', () => ({ openPostInBrowser: openPost }))

const date = (offset: number) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).toLocaleDateString('sv-SE')
}
const ALL = ['script', 'caption', 'reference', 'time', 'key', 'gift', 'offer']
const draft = {
  id: 'a',
  title: 'Draft reel',
  state: 'draft',
  date: date(0),
  time: null,
  script: null,
  caption: null,
  reference: null,
  missing: ALL,
  lockReason: null
}
const armed = {
  id: 'b',
  title: 'Armed reel',
  state: 'scheduled',
  date: date(1),
  time: '19:30',
  script: { title: 'Hook', content: 'Line one.' },
  caption: 'Cap',
  reference: { videoId: 'v1', url: 'https://www.instagram.com/reel/v1/', handle: '@rival' },
  missing: ['key', 'gift', 'offer'],
  lockReason: 'Đã hẹn đăng lên Instagram. Huỷ hẹn trước rồi mới dời ngày.'
}
const board = {
  month: date(0).slice(0, 7),
  today: date(0),
  gridDays: Array.from({ length: 7 }, (_, i) => ({
    date: date(i),
    inMonth: true,
    cards: [draft, armed].filter((c) => c.date === date(i))
  }))
}

function stubCall(...results: unknown[]): ReturnType<typeof vi.fn> {
  const call = vi.fn()
  for (const result of results) {
    call.mockResolvedValueOnce(result)
  }
  call.mockResolvedValue({ ok: true, value: board })
  Object.assign(window, { api: { crowsnest: { call } } })
  return call
}

const dataTransfer = (id = '') => ({ setData: vi.fn(), getData: () => id, effectAllowed: '' })

afterEach(() => {
  cleanup()
  openPost.mockReset()
})

describe('PlanBoard', () => {
  it('shows each reel on its day in the month, flagged when it misses an item', async () => {
    const call = stubCall({ ok: true, value: board })
    render(<PlanBoard />)
    const chips = await screen.findAllByTestId('plan-chip')
    expect(chips.map((c) => [c.dataset.planId, c.dataset.state])).toEqual([
      ['a', 'draft'],
      ['b', 'scheduled']
    ])
    expect(within(chips[0]).getByTestId('plan-flag')).toBeTruthy()
    expect(call.mock.calls[0]).toEqual(['getPlanBoard', date(0).slice(0, 7)])
  })

  it('moves a draft by drag in the week and refuses a reel scheduled with Instagram', async () => {
    const call = stubCall(
      { ok: true, value: board },
      { ok: true, value: { ok: true, prior: { plannedDate: date(0) } } }
    )
    render(<PlanBoard />)
    fireEvent.click(await screen.findByTestId('plan-view-week'))
    const columns = screen.getAllByTestId('plan-week-day')
    const [draftCard, armedCard] = screen.getAllByTestId('plan-card')

    fireEvent.dragStart(armedCard, { dataTransfer: dataTransfer() })
    const refused = screen.getByTestId('plan-message')
    expect([refused.dataset.status, refused.textContent]).toEqual(['error', armed.lockReason])

    fireEvent.dragStart(draftCard, { dataTransfer: dataTransfer() })
    fireEvent.drop(columns[3], { dataTransfer: dataTransfer('a') })
    expect(await screen.findByText(/Đã dời "Draft reel"/)).toBeTruthy()
    expect(call.mock.calls[1]).toEqual(['movePlanCardAction', 'a', date(3)])
    expect(call.mock.calls.filter(([name]) => name === 'movePlanCardAction')).toHaveLength(1)
  })

  it('opens a day with each reel in full, chưa có for a missing item, and the reference reel', async () => {
    stubCall({ ok: true, value: board })
    render(<PlanBoard />)
    fireEvent.click((await screen.findAllByTestId('plan-chip'))[1])
    const detail = screen.getByTestId('plan-detail')
    const fields = within(detail)
      .getAllByTestId('plan-field')
      .map((f) => [f.dataset.item, f.dataset.missing])
    expect(fields).toEqual([
      ['script', 'false'],
      ['caption', 'false'],
      ['reference', 'false'],
      ['time', 'false'],
      ['key', 'true'],
      ['gift', 'true'],
      ['offer', 'true']
    ])
    expect(within(detail).getByTestId('plan-missing').textContent).toBe(
      'Còn thiếu: Key, Quà, Offer'
    )
    fireEvent.click(within(detail).getByTestId('plan-reference-open'))
    expect(openPost).toHaveBeenCalledWith('https://www.instagram.com/reel/v1/')
  })

  it('adds a reel by hand in an empty day', async () => {
    const call = stubCall({ ok: true, value: board }, { ok: true, value: { ok: true, id: 'new' } })
    render(<PlanBoard />)
    const empty = (await screen.findAllByTestId('plan-add'))[0]
    expect(empty.dataset.date).toBe(date(2))
    fireEvent.click(empty)
    fireEvent.change(screen.getByTestId('plan-add-title'), { target: { value: 'New reel' } })
    fireEvent.change(screen.getByTestId('plan-add-time'), { target: { value: '08:00' } })
    fireEvent.click(screen.getByTestId('plan-add-submit'))
    expect(await screen.findByText(/Đã thêm "New reel"/)).toBeTruthy()
    expect(call.mock.calls[1]).toEqual([
      'createPlannedPostAction',
      { title: 'New reel', plannedDate: date(2), plannedTime: '08:00' }
    ])
  })
})
