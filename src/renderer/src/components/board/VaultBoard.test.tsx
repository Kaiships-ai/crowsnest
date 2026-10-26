// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { VaultBoard } from './VaultBoard'

const SECRET = 'sentinel-typed-umami-key'

function row(overrides: Record<string, unknown>) {
  return {
    id: 'umami',
    label: 'Umami',
    state: 'not-connected',
    missing: ['API key'],
    secrets: [{ name: 'UMAMI_API_KEY', label: 'API key', optional: false, source: 'none' }],
    canPull: false,
    lastPull: null,
    nextPullAt: '2026-10-27T05:00:00.000Z',
    graphCallsLeft: null,
    ...overrides
  }
}

function stubBridge(handlers: Record<string, (...args: unknown[]) => unknown>) {
  const call = vi.fn(async (name: string, ...args: unknown[]) => handlers[name](...args))
  Object.assign(window, { api: { crowsnest: { call } } })
  return call
}

afterEach(cleanup)

describe('VaultBoard', () => {
  it('shows each source with its state, budget and the fix for its problem', async () => {
    stubBridge({
      getVaultBoard: () => ({
        ok: true,
        value: [
          row({}),
          row({
            id: 'instagram-graph',
            label: 'Instagram Graph API',
            state: 'error',
            missing: [],
            canPull: true,
            lastPull: {
              slot: '2026-10-26',
              at: '2026-10-26T05:01:00.000Z',
              outcome: 'failed',
              detail: 'token expired'
            },
            graphCallsLeft: 187
          })
        ]
      })
    })
    render(<VaultBoard />)
    const rows = await screen.findAllByTestId('vault-row')
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['not-connected', 'error'])
    expect(within(rows[0]).getByTestId('vault-problem').textContent).toContain(
      'Bấm Sửa và nhập API key'
    )
    expect(within(rows[1]).getByTestId('vault-problem').textContent).toContain('token expired')
    expect(rows[1].textContent).toContain('187')
    expect((within(rows[0]).getByTestId('vault-pull') as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves a secret through Sửa, clears the input, and shows only where it is stored', async () => {
    let source = 'none'
    const call = stubBridge({
      getVaultBoard: () => ({
        ok: true,
        value: [
          row({ secrets: [{ name: 'UMAMI_API_KEY', label: 'API key', optional: false, source }] })
        ]
      }),
      setConnectorSecret: () => {
        source = 'keychain'
        return { ok: true, value: { ok: true } }
      }
    })
    render(<VaultBoard />)
    fireEvent.click(await screen.findByTestId('vault-edit'))
    const input = screen.getByTestId('vault-secret-input') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: SECRET } })
    fireEvent.click(screen.getByTestId('vault-secret-save'))
    await waitFor(() =>
      expect(screen.getByTestId('vault-secret-status').textContent).toBe('đã lưu · nguồn keychain')
    )
    expect(call).toHaveBeenCalledWith('setConnectorSecret', 'umami', 'UMAMI_API_KEY', SECRET)
    expect((screen.getByTestId('vault-secret-input') as HTMLInputElement).value).toBe('')
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  it('shows a refused save next to the field', async () => {
    stubBridge({
      getVaultBoard: () => ({ ok: true, value: [row({})] }),
      setConnectorSecret: () => ({ ok: true, value: { ok: false, error: 'umami has no field X' } })
    })
    render(<VaultBoard />)
    fireEvent.click(await screen.findByTestId('vault-edit'))
    fireEvent.change(screen.getByTestId('vault-secret-input'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('vault-secret-save'))
    expect(await screen.findByText('umami has no field X')).toBeTruthy()
  })

  it('Kiểm tra shows the connection check', async () => {
    stubBridge({
      getVaultBoard: () => ({ ok: true, value: [row({})] }),
      testConnector: () => ({ ok: true, value: { ok: false, message: 'umami is not connected' } })
    })
    render(<VaultBoard />)
    fireEvent.click(await screen.findByTestId('vault-test'))
    expect((await screen.findByTestId('vault-message')).textContent).toBe('umami is not connected')
  })
})
