import React from 'react'
import type { BoardId } from '../../../../shared/lead-studio-boards'
import { AgentsBoard } from './AgentsBoard'
import { COOK_TAB_PREFIX } from './cook-reel'
import { CookPane } from './CookPane'
import { FunnelBoard } from './FunnelBoard'
import { GateBoard } from './GateBoard'
import { Gate2Board } from './Gate2Board'
import { OwnBoard } from './OwnBoard'
import { PlanBoard } from './PlanBoard'
import { RivalsBoard } from './RivalsBoard'
import { TodayBoard } from './TodayBoard'

const BOARD_VIEWS: Record<BoardId, () => React.ReactNode> = {
  today: TodayBoard,
  funnel: FunnelBoard,
  own: OwnBoard,
  rivals: RivalsBoard,
  plan: PlanBoard,
  gate: GateBoard,
  gate2: Gate2Board,
  agents: AgentsBoard
}

export function BoardView({
  boardId,
  filePath,
  worktreeId
}: {
  boardId: BoardId | undefined
  filePath: string
  worktreeId: string
}): React.ReactNode {
  const Board = boardId ? BOARD_VIEWS[boardId] : undefined
  // A Cook pane tab is a board tab per reel: its path names the plan row.
  const cookPlanId = filePath.startsWith(COOK_TAB_PREFIX)
    ? filePath.slice(COOK_TAB_PREFIX.length)
    : null
  return (
    <div data-testid="board-tab" data-board-id={boardId} className="h-full bg-background">
      {cookPlanId ? (
        <CookPane planId={cookPlanId} worktreeId={worktreeId} />
      ) : Board ? (
        <Board />
      ) : null}
    </div>
  )
}
