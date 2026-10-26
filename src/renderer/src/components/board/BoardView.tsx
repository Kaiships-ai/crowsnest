import React from 'react'
import type { BoardId } from '../../../../shared/lead-studio-boards'
import { ChannelsBoard } from './ChannelsBoard'

const BOARD_VIEWS: Record<BoardId, () => React.ReactNode> = {
  channels: ChannelsBoard
}

export function BoardView({ boardId }: { boardId: BoardId | undefined }): React.ReactNode {
  const Board = boardId ? BOARD_VIEWS[boardId] : undefined
  return (
    <div data-testid="board-tab" data-board-id={boardId} className="h-full bg-background">
      {Board ? <Board /> : null}
    </div>
  )
}
