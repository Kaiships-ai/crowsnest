// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentsBoard } from './AgentsBoard'

const RAW = 'cn_sentinel_raw_token'

const action = (id: number, caller: string, tool: string) => ({
  id,
  callId: `c${id}`,
  at: '2026-10-26T10:00:00.000Z',
  caller,
  tool,
  input: '{}',
  result: 'ok',
  gate: 'free',
  draftId: null
})

function stubBridge(handlers: Record<string, (...args: unknown[]) => unknown>) {
  const call = vi.fn(async (name: string, ...args: unknown[]) => handlers[name](...args))
  const writeClipboardText = vi.fn(async () => {})
  Object.assign(window, { api: { crowsnest: { call }, ui: { writeClipboardText } } })
  return { call, writeClipboardText }
}

afterEach(cleanup)

describe('AgentsBoard', () => {
  it('lists the journal newest first and filters it by caller', async () => {
    stubBridge({
      listMcpTokens: () => ({ ok: true, value: [] }),
      listAgentActions: () => ({
        ok: true,
        value: [action(3, 'local', 'crowsnest_plans'), action(2, 'bot', 'crowsnest_save_funnel')]
      })
    })
    render(<AgentsBoard />)
    await screen.findAllByTestId('agents-journal-row')
    expect(
      screen.getAllByTestId('agents-journal-row').map((r) => r.getAttribute('data-caller'))
    ).toEqual(['local', 'bot'])
    fireEvent.click(screen.getByRole('radio', { name: 'bot' }))
    expect(
      screen.getAllByTestId('agents-journal-row').map((r) => r.getAttribute('data-tool'))
    ).toEqual(['crowsnest_save_funnel'])
  })

  it('shows a new token once, copies it, and never again after Xong', async () => {
    const tokens: unknown[] = []
    const { call, writeClipboardText } = stubBridge({
      listMcpTokens: () => ({ ok: true, value: [...tokens] }),
      listAgentActions: () => ({ ok: true, value: [] }),
      createMcpToken: (name) => {
        tokens.push({
          id: 't1',
          name,
          createdAt: '2026-10-26T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null
        })
        return { ok: true, value: { id: 't1', name, token: RAW } }
      }
    })
    render(<AgentsBoard />)
    fireEvent.change(await screen.findByTestId('agents-token-name'), { target: { value: 'bot' } })
    fireEvent.click(screen.getByTestId('agents-token-create'))
    expect((await screen.findByTestId('agents-new-token-value')).textContent).toBe(RAW)
    expect(call).toHaveBeenCalledWith('createMcpToken', 'bot')
    fireEvent.click(screen.getByTestId('agents-new-token-copy'))
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(RAW))
    await screen.findByTestId('agents-token-row')
    fireEvent.click(screen.getByTestId('agents-new-token-done'))
    expect(screen.queryByTestId('agents-new-token')).toBeNull()
    expect(document.body.innerHTML).not.toContain(RAW)
  })

  it('Thu hồi asks to confirm before it revokes', async () => {
    let revokedAt: string | null = null
    const { call } = stubBridge({
      listMcpTokens: () => ({
        ok: true,
        value: [
          {
            id: 't1',
            name: 'bot',
            createdAt: '2026-10-26T10:00:00.000Z',
            lastUsedAt: null,
            revokedAt
          }
        ]
      }),
      listAgentActions: () => ({ ok: true, value: [] }),
      revokeMcpToken: () => {
        revokedAt = '2026-10-26T11:00:00.000Z'
        return { ok: true, value: { revoked: true } }
      }
    })
    render(<AgentsBoard />)
    fireEvent.click(await screen.findByTestId('agents-revoke'))
    expect(call).not.toHaveBeenCalledWith('revokeMcpToken', 't1')
    fireEvent.click(screen.getByTestId('agents-revoke-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('agents-token-row').getAttribute('data-revoked')).toBe('true')
    )
    expect(call).toHaveBeenCalledWith('revokeMcpToken', 't1')
  })
})
