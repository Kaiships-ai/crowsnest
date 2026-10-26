import { toast } from 'sonner'
import { openWorkspaceBrowserTab } from '@/lib/workspace-browser-tab-open'
import { useAppStore } from '@/store'

export function openPostInBrowser(url: string): void {
  const { activeWorktreeId } = useAppStore.getState()
  if (!activeWorktreeId) {
    return
  }
  void openWorkspaceBrowserTab({
    workspaceId: activeWorktreeId,
    url,
    intent: { kind: 'url' }
  }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
}
