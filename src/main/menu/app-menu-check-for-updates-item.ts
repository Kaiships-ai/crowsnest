import type { UpdateCheckOptions } from '../../shared/update-status-types'
import { translateMain } from '../i18n/main-i18n'

export function createCheckForUpdatesItem(
  onCheckForUpdates: (options: UpdateCheckOptions) => void,
  isMac: boolean
): Electron.MenuItemConstructorOptions {
  // Share modifier-click release-channel routing across platform-specific update menu locations.
  const click: Electron.MenuItemConstructorOptions['click'] = (_menuItem, _window, event) => {
    const modifierClick = !event.triggeredByAccelerator
    const localBuild = isMac && modifierClick && event.altKey === true
    const includePerfPrerelease =
      !localBuild && modifierClick && (isMac ? event.metaKey === true : event.ctrlKey === true)
    const includePrerelease = !localBuild && modifierClick && event.shiftKey === true
    onCheckForUpdates({
      includePrerelease,
      includePerfPrerelease,
      ...(localBuild ? { localBuild: true } : {})
    })
  }

  return {
    label: translateMain('menu.checkForUpdates', 'Check for Updates...'),
    click
  }
}
