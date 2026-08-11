import { ChannelsKanban } from "@/components/channels/kanban-board";
import { getKanbanBoard } from "@/server/queries/channels";

// The topbar renders the route title. The board's own header row carries only the meta
// line and the actions, so there is exactly one "Channels" heading on the screen.
export default async function ChannelsPage() {
  const board = await getKanbanBoard();
  return (
    <div className="mx-auto h-full max-w-[1120px]">
      <ChannelsKanban board={board} />
    </div>
  );
}
