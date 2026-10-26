import React from 'react'
import type { BoardId } from '../../../../shared/lead-studio-boards'
import { AgentsBoard } from './AgentsBoard'
import { FunnelBoard } from './FunnelBoard'
import { OwnBoard } from './OwnBoard'
import { PlanBoard } from './PlanBoard'
import { RivalsBoard } from './RivalsBoard'
import { TodayBoard } from './TodayBoard'
import { VaultBoard } from './VaultBoard'
import { Cp2GateBoard } from '../cp2/Cp2GateBoard'
import { Cp2DataBoard } from '../cp2/Cp2DataBoard'

const BOARD_VIEWS: Record<BoardId, () => React.ReactNode> = {
  today: TodayBoard,
  funnel: FunnelBoard,
  own: OwnBoard,
  rivals: RivalsBoard,
  plan: PlanBoard,
  vault: VaultBoard,
  agents: AgentsBoard,
  cp2gate: Cp2GateBoard,
  cp2data: Cp2DataBoard
}

export function BoardView({ boardId }: { boardId: BoardId | undefined }): React.ReactNode {
  const Board = boardId ? BOARD_VIEWS[boardId] : undefined
  return (
    <div data-testid="board-tab" data-board-id={boardId} className="h-full bg-background">
      {Board ? <Board /> : null}
    </div>
  )
}
