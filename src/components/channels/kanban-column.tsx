"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { ChannelRow } from "@/server/queries/channels";
import { ChannelCard } from "./channel-card";
import { FleetColumnMenu } from "./fleet-column-menu";

export const UNASSIGNED = "unassigned";

export function KanbanColumn({
  fleetId, name, pinned, count, channelIds, channelsById, sampleSizeById,
  canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
}: {
  fleetId: string | null; name: string; pinned: boolean; count: number;
  channelIds: string[]; channelsById: Record<string, ChannelRow>;
  /** channelId to the sample its median was computed from — see KanbanBoard. */
  sampleSizeById: Record<string, number>;
  canMoveLeft: boolean; canMoveRight: boolean; onMoveLeft: () => void; onMoveRight: () => void;
}) {
  const droppableId = fleetId ?? UNASSIGNED;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <section className="flex min-h-0 w-[280px] flex-none flex-col border-r border-border px-4 last:border-r-0">
      <div className="flex items-center gap-2 border-b border-border px-1 pb-3">
        <span className={`font-mono text-2xs uppercase tracking-wider ${pinned ? "text-faint" : "text-muted-foreground"}`}>{name}</span>
        <span data-num className="text-2xs text-faint">{count}</span>
        <span className="flex-1" />
        {pinned ? (
          <span className="font-mono text-2xs tracking-wide text-dim">pinned</span>
        ) : (
          fleetId && (
            <FleetColumnMenu
              fleetId={fleetId} name={name}
              canMoveLeft={canMoveLeft} canMoveRight={canMoveRight}
              onMoveLeft={onMoveLeft} onMoveRight={onMoveRight}
            />
          )
        )}
      </div>

      <div
        ref={setNodeRef}
        data-over={isOver ? "" : undefined}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pt-3 pb-4 data-[over]:bg-line-strong/5"
      >
        <SortableContext items={channelIds} strategy={verticalListSortingStrategy}>
          {channelIds.map((id) => (
            <ChannelCard key={id} channel={channelsById[id]} sampleSize={sampleSizeById[id] ?? 0} />
          ))}
        </SortableContext>
        {channelIds.length === 0 && (
          <div className="grid flex-1 place-items-center border border-dashed border-border text-2xs tracking-wide text-faint [background-image:repeating-linear-gradient(135deg,var(--hatch-2)_0,var(--hatch-2)_1px,transparent_1px,transparent_11px)]">
            Drop channels here
          </div>
        )}
      </div>
    </section>
  );
}
