import { ipcMain } from 'electron'
import { isTrustedBrowserRenderer } from '../ipc/browser-renderer-trust'
import type { dispatchEngineCall, EngineResult } from '../../server/bridge/engine-calls'

type EngineDispatch = typeof dispatchEngineCall

/** Registered before the engine has migrated and started, so an early call waits for it instead of hitting "No handler registered". */
export function registerEngineIpc(engine: Promise<EngineDispatch>): void {
  engine.catch(() => {})
  ipcMain.handle(
    'crowsnest:call',
    async (event, name: unknown, args: unknown): Promise<EngineResult<unknown>> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return {
          ok: false,
          error: {
            code: 'untrusted_sender',
            message: 'only the Lead Studio window calls the engine'
          }
        }
      }
      const dispatch = await engine.catch(() => null)
      if (!dispatch) {
        return {
          ok: false,
          error: { code: 'failed', message: 'the crowsnest engine did not start' }
        }
      }
      return dispatch(name, args)
    }
  )
}
