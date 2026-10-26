import { describe, expect, it } from 'vitest'
import { buildSettingsNavigationMetadata } from '@/hooks/useSettingsNavigationMetadata'
import { leadStudioSettingsSections } from './lead-studio-settings-allowlist'

const all = buildSettingsNavigationMetadata({
  isMac: true,
  isWindows: false,
  isWebClient: false,
  repos: []
})

describe('leadStudioSettingsSections', () => {
  it('keeps only the creator panes, Sources included, in Orca order', () => {
    expect(leadStudioSettingsSections(all, false).map((s) => s.id)).toEqual([
      'agents',
      'accounts',
      'general',
      'lead-sources',
      'terminal',
      'browser',
      'appearance',
      'input',
      'notifications',
      'shortcuts',
      'developer-permissions',
      'privacy',
      'advanced'
    ])
  })

  it('shows every Orca pane behind the dev flag', () => {
    expect(leadStudioSettingsSections(all, true)).toEqual(all)
  })
})
