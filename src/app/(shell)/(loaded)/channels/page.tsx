import Link from "next/link";
import { Compass } from "lucide-react";

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
    <div className="flex h-full flex-col">
      {/* Neutral text link (same treatment as the "← Channels" back-link on the channel
          detail page) — not a Button, so it never reads as the board's primary action. */}
      <div className="flex justify-end px-6 pt-4">
        <Link
          href="/channels/discover"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Compass className="size-4" />
          Discover creators
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <ChannelsKanban board={board} />
      </div>
    </div>
  );
}
