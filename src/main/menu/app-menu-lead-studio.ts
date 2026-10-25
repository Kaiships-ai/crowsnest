import { LEAD_STUDIO_BOARDS, type BoardId } from '../../shared/lead-studio-boards'

export function createLeadStudioMenu(
  onOpenBoard: (boardId: BoardId) => void
): Electron.MenuItemConstructorOptions {
  return {
    label: 'Lead Studio',
    submenu: LEAD_STUDIO_BOARDS.map((board) => ({
      label: board.label,
      click: () => onOpenBoard(board.id)
    }))
  }
}
