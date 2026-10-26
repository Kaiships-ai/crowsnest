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

/** Lead Studio shows the panes a creator needs. `VITE_LEAD_STUDIO_ALL_SETTINGS=1` shows every Orca pane. */
export function leadStudioSettingsSections(
  sections: SettingsNavSection[],
  showAll: boolean = import.meta.env.VITE_LEAD_STUDIO_ALL_SETTINGS === '1'
): SettingsNavSection[] {
  return showAll ? sections : sections.filter((s) => LEAD_STUDIO_SETTINGS_PANES.has(s.id))
}
