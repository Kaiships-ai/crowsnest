import { useAppStore } from '@/store'

export function openLeadSourcesSettings(): void {
  const store = useAppStore.getState()
  store.openSettingsTarget({ pane: 'lead-sources', repoId: null })
  store.openSettingsPage()
}
