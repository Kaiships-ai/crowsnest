import { describe, expect, it } from 'vitest'
import { buildSettingsNavigationMetadata } from '@/hooks/useSettingsNavigationMetadata'
import { leadStudioPaneVisible, leadStudioSettingsSections } from './lead-studio-settings-allowlist'
import type { Repo } from '../../../shared/repo-types'

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

  it("keeps a workspace's own settings, so the Workspaces list still opens them", () => {
    const repo: Repo = {
      id: 'repo-1',
      path: '/tmp/repo-1',
      displayName: 'repo-1',
      badgeColor: 'gray',
      addedAt: 1,
      kind: 'folder'
    }
    const withRepo = buildSettingsNavigationMetadata({
      isMac: true,
      isWindows: false,
      isWebClient: false,
      repos: [repo]
    })
    const repoSections = withRepo.filter((s) => s.id.startsWith('repo-')).map((s) => s.id)
    expect(repoSections.length).toBeGreaterThan(0)
    expect(
      leadStudioSettingsSections(withRepo, false)
        .filter((s) => s.id.startsWith('repo-'))
        .map((s) => s.id)
    ).toEqual(repoSections)
    expect(leadStudioPaneVisible('repo', false)).toBe(true)
  })

  it('hides the panes whose entry points Lead Studio hides', () => {
    for (const pane of ['git', 'servers', 'ssh', 'integrations']) {
      expect(leadStudioPaneVisible(pane, false), pane).toBe(false)
    }
  })
})
