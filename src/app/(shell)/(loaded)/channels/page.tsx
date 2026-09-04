import { ChannelsKanban } from "@/components/channels/kanban-board";
import { getKanbanBoard } from "@/server/queries/channels";

// The topbar renders the route title. The board's own header row carries only the meta
// line and the actions, so there is exactly one "Channels" heading on the screen.
//
// Unlike /runs and /logs (plain lists, capped at 1120px), this route is a horizontal
// multi-column kanban board — it needs the full viewport width, not a boxed column, or
// the fleet's columns get squeezed and clipped. No content-width wrapper here on purpose.
export default async function ChannelsPage() {
  const board = await getKanbanBoard();
  return (
    <div className="h-full">
      <ChannelsKanban board={board} />
    </div>
  );
}
