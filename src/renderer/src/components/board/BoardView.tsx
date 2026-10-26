import React from 'react'
import type { BoardId } from '../../../../shared/lead-studio-boards'
import { AgentsBoard } from './AgentsBoard'
import { ChannelsBoard } from './ChannelsBoard'
import { FunnelBoard } from './FunnelBoard'
import { TodayBoard } from './TodayBoard'
import { VaultBoard } from './VaultBoard'

const BOARD_VIEWS: Record<BoardId, () => React.ReactNode> = {
  today: TodayBoard,
  funnel: FunnelBoard,
  channels: ChannelsBoard,
  vault: VaultBoard,
  agents: AgentsBoard
}

export function BoardView({ boardId }: { boardId: BoardId | undefined }): React.ReactNode {
  const Board = boardId ? BOARD_VIEWS[boardId] : undefined
  return (
    <div data-testid="board-tab" data-board-id={boardId} className="h-full bg-background">
      {Board ? <Board /> : null}
    </div>
  )
}
