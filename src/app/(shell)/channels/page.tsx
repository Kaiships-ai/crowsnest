import { ChannelsKanban } from "@/components/channels/kanban-board";
import { getKanbanBoard } from "@/server/queries/channels";

// The board renders its own "Channels" header inside its chrome. The topbar's route
// title stays as-is.
export default async function ChannelsPage() {
  const board = await getKanbanBoard();
  return <ChannelsKanban board={board} />;
}
