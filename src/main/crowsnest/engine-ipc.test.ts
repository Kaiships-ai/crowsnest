import { afterEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, fn)
  }
}))

const { registerEngineIpc } = await import('./engine-ipc')
const { setTrustedBrowserRendererWebContentsId } = await import('../ipc/browser-renderer-trust')

const sender = (id: number, type = 'window') => ({
  id,
  isDestroyed: () => false,
  getType: () => type,
  getURL: () => 'file:///app/index.html'
})
const invoke = (from: ReturnType<typeof sender>, name: string, args: unknown[] = []) =>
  handlers.get('crowsnest:call')?.({ sender: from }, name, args)

afterEach(() => {
  handlers.clear()
  setTrustedBrowserRendererWebContentsId(null)
})

describe('crowsnest:call', () => {
  it('runs a call from the app window', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: 'rows' }))
    registerEngineIpc(Promise.resolve(dispatch))
    setTrustedBrowserRendererWebContentsId(1)
    await expect(invoke(sender(1), 'getChannelsList', ['f'])).resolves.toEqual({
      ok: true,
      value: 'rows'
    })
    expect(dispatch).toHaveBeenCalledWith('getChannelsList', ['f'])
  })

  it.each([
    ['another window', sender(2)],
    ['a webview guest', sender(1, 'webview')]
  ])('refuses %s without reaching the engine', async (_label, from) => {
    const dispatch = vi.fn()
    registerEngineIpc(Promise.resolve(dispatch))
    setTrustedBrowserRendererWebContentsId(1)
    await expect(invoke(from, 'getChannelsList')).resolves.toMatchObject({
      ok: false,
      error: { code: 'untrusted_sender' }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('answers failed when the engine never started', async () => {
    registerEngineIpc(Promise.reject(new Error('migrate failed')))
    setTrustedBrowserRendererWebContentsId(1)
    await expect(invoke(sender(1), 'getChannelsList')).resolves.toMatchObject({
      ok: false,
      error: { code: 'failed' }
    })
  })
})
