import { GraphTokenLine } from "@/components/status/graph-token-line";
import { ChannelsKanban } from "@/components/channels/kanban-board";
import { SourcesTabs } from "@/components/layout/section-tabs";
import { getKanbanBoard } from "@/server/queries/channels";

export default async function ChannelsPage() {
  const board = await getKanbanBoard();
  return (
    <div className="flex h-full flex-col">
      <SourcesTabs />
      <GraphTokenLine className="mx-4 mt-3 mb-0 sm:mx-6" />
      <div className="min-h-0 flex-1">
        <ChannelsKanban board={board} />
      </div>
    </div>
  );
}
