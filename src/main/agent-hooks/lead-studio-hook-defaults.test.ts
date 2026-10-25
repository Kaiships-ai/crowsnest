import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ManagedAgentHookControls from './managed-agent-hook-controls'

const { installManagedAgentHooks } = vi.hoisted(() => ({
  installManagedAgentHooks: vi.fn(async () => [])
}))

vi.mock('./managed-agent-hook-controls', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedAgentHookControls>()),
  installManagedAgentHooks
}))

import { getDefaultSettings } from '../../shared/constants'
import { reconcileStartupManagedAgentHooks } from './managed-agent-hook-startup'

describe('Lead Studio managed agent hook defaults', () => {
  beforeEach(() => installManagedAgentHooks.mockClear())

  it('ships with agent status hooks off', () => {
    expect(getDefaultSettings('/home/kai').agentStatusHooksEnabled).toBe(false)
  })

  it('leaves shared agent configs untouched on startup with default settings', () => {
    reconcileStartupManagedAgentHooks({
      getSettings: () => getDefaultSettings('/home/kai'),
      isQuitting: () => false,
      shouldHydrateShellPath: false
    })

    expect(installManagedAgentHooks).not.toHaveBeenCalled()
  })
})
