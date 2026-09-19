"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import type { ChannelRow } from "@/server/queries/channels";
import { ChannelCard } from "./channel-card";
import { FleetColumnMenu } from "./fleet-column-menu";

export const UNASSIGNED = "unassigned";

export function KanbanColumn({
  fleetId, name, pinned, count, channelIds, channelsById, sampleSizeById,
  canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
  selectedIds, onToggleSelect, onToggleColumn,
}: {
  fleetId: string | null; name: string; pinned: boolean; count: number;
  channelIds: string[]; channelsById: Record<string, ChannelRow>;
  /** channelId to the sample its median was computed from — see KanbanBoard. */
  sampleSizeById: Record<string, number>;
  canMoveLeft: boolean; canMoveRight: boolean; onMoveLeft: () => void; onMoveRight: () => void;
  /** Absent means the board is not in selection mode, so no checkboxes render. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Tick (next true) or clear (next false) every channel in this column at once. */
  onToggleColumn?: (ids: string[], next: boolean) => void;
}) {
  const droppableId = fleetId ?? UNASSIGNED;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const selecting = selectedIds !== undefined && onToggleSelect !== undefined;
  const allSelected = selecting && channelIds.length > 0 && channelIds.every((id) => selectedIds.has(id));
  const someSelected = selecting && channelIds.some((id) => selectedIds.has(id));

  return (
    <section className="flex min-h-0 w-[280px] min-w-[280px] flex-none flex-col border-r border-border px-4 last:border-r-0">
      <div className="flex items-center gap-2 border-b border-border px-1 pb-3">
        {selecting && channelIds.length > 0 && (
          <Checkbox
            data-testid="channels-column-select-all"
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onCheckedChange={() => onToggleColumn?.(channelIds, !allSelected)}
            aria-label={`Select all in ${name}`}
            className="shrink-0"
          />
        )}
        <span className={`font-mono text-2xs uppercase tracking-wider ${pinned ? "text-muted-foreground" : "text-muted-foreground"}`}>{name}</span>
        <span data-num className="text-2xs text-muted-foreground">{count}</span>
        <span className="flex-1" />
        {pinned ? (
          <span className="font-mono text-2xs tracking-wide text-muted-foreground">pinned</span>
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
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pt-3 pb-4 data-[over]:bg-border/5"
      >
        <SortableContext items={channelIds} strategy={verticalListSortingStrategy}>
          {channelIds.map((id) => (
            <ChannelCard
              key={id}
              channel={channelsById[id]}
              sampleSize={sampleSizeById[id] ?? 0}
              selected={selectedIds?.has(id) ?? false}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </SortableContext>
        {channelIds.length === 0 && (
          // Empty ships the dash style but no border width, so a drop target that has
          // to read as an outlined well supplies its own `border`.
          <Empty className="flex-1 border border-dashed p-6">
            <EmptyHeader>
              <EmptyDescription>Drop channels here</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}
