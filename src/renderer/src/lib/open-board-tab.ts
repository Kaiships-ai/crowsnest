import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { LEAD_STUDIO_BOARDS, type BoardId } from '../../../shared/lead-studio-boards'

export function openBoardTab(boardId: BoardId, worktreeId: string, targetGroupId?: string): void {
  const board = LEAD_STUDIO_BOARDS.find((entry) => entry.id === boardId)
  if (!board) {
    return
  }
  useAppStore.getState().openFile(
    {
      filePath: `board::${board.id}`,
      relativePath: board.label,
      worktreeId,
      language: 'plaintext',
      mode: 'board',
      boardId: board.id
    },
    { targetGroupId, preview: false }
  )
}

/** A board needs a workspace to hold its tab. With none open (a first launch), open the
 *  "Lead Studio" folder workspace next to the app's data, adding it once. */
async function ensureLeadStudioWorkspace(): Promise<string | null> {
  const dir = await window.api.crowsnest.call('ensureLeadStudioWorkspaceDir')
  if (!dir.ok) {
    return null
  }
  const state = useAppStore.getState()
  const repo =
    state.repos.find((r) => r.path === dir.value) ??
    (await state.addRepoPath(dir.value, 'folder', {
      displayName: 'Lead Studio',
      runtimeEnvironmentId: null
    }))
  if (!repo) {
    return null
  }
  await useAppStore.getState().fetchWorktrees(repo.id)
  const worktree = selectWorktreesByRepo(useAppStore.getState())[repo.id]?.[0]
  if (!worktree || !activateAndRevealWorktree(worktree.id, { providesInitialSurface: true })) {
    return null
  }
  return worktree.id
}

export async function openBoardInActiveWorkspace(boardId: BoardId): Promise<void> {
  const worktreeId = useAppStore.getState().activeWorktreeId ?? (await ensureLeadStudioWorkspace())
  if (!worktreeId) {
    return
  }
  openBoardTab(boardId, worktreeId, useAppStore.getState().activeGroupIdByWorktree[worktreeId])
}
