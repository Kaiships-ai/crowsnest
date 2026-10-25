import { useAppStore } from '@/store'
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

export function openBoardInActiveWorkspace(boardId: BoardId): void {
  const { activeWorktreeId, activeGroupIdByWorktree } = useAppStore.getState()
  if (!activeWorktreeId) {
    return
  }
  openBoardTab(boardId, activeWorktreeId, activeGroupIdByWorktree[activeWorktreeId])
}
