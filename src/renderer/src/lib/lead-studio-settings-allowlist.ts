import type { SettingsNavSection } from './settings-navigation-types'

const LEAD_STUDIO_SETTINGS_PANES: ReadonlySet<string> = new Set([
  'agents',
  'accounts',
  'general',
  'lead-sources',
  'appearance',
  'input',
  'terminal',
  'browser',
  'notifications',
  'shortcuts',
  'developer-permissions',
  'privacy',
  'advanced'
])

const showAllPanes = (): boolean => import.meta.env.VITE_LEAD_STUDIO_ALL_SETTINGS === '1'

/** Whether Settings lists this pane. A workspace's own settings (`repo`, `repo-<id>`) stay
 *  reachable from the Workspaces list. An entry point to a hidden pane is hidden too. */
export function leadStudioPaneVisible(pane: string, showAll: boolean = showAllPanes()): boolean {
  return (
    showAll || pane === 'repo' || pane.startsWith('repo-') || LEAD_STUDIO_SETTINGS_PANES.has(pane)
  )
}

/** Lead Studio shows the panes a creator needs. `VITE_LEAD_STUDIO_ALL_SETTINGS=1` shows every Orca pane. */
export function leadStudioSettingsSections(
  sections: SettingsNavSection[],
  showAll: boolean = showAllPanes()
): SettingsNavSection[] {
  return sections.filter((s) => leadStudioPaneVisible(s.id, showAll))
}
