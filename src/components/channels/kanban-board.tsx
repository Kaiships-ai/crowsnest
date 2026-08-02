"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ChannelRow, KanbanBoard as KanbanBoardData } from "@/server/queries/channels";
import { moveChannelsAction, reorderFleetsAction } from "@/server/actions/fleet-actions";
import { applyMove, commitDiff, currentFleet, groupByFleet, isDirty, type FleetId, type Overlay } from "@/lib/kanban-moves";
import { KanbanColumn, UNASSIGNED } from "./kanban-column";
import { ChannelCard } from "./channel-card";
import { NewFleetDialog } from "./new-fleet-dialog";

function toFleetId(dropId: string): FleetId {
  return dropId === UNASSIGNED ? null : dropId;
}

export function ChannelsKanban({ board }: { board: KanbanBoardData }) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<Overlay>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const channelsById = useMemo(
    () => Object.fromEntries(board.channels.map((c) => [c.id, c])) as Record<string, ChannelRow>,
    [board.channels]
  );
  const fleetOrder: FleetId[] = useMemo(() => [null, ...board.fleets.map((f) => f.id)], [board.fleets]);
  const placements = useMemo(
    () => board.channels.map((c) => ({ id: c.id, fleetId: board.placement[c.id] })),
    [board.channels, board.placement]
  );
  const buckets = groupByFleet(placements, overlay, fleetOrder);
  const dirty = isDirty(overlay);
  const moveCount = commitDiff(overlay).length;

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)); }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    // over.id is a column droppable id (UNASSIGNED or a fleet id) or a card id.
    const targetColumn = overId in channelsById
      ? currentFleet(board.placement[overId], overlay, overId)
      : toFleetId(overId);
    setOverlay((prev) => applyMove(prev, id, board.placement[id], targetColumn));
  }

  function save() {
    startTransition(async () => {
      const r = await moveChannelsAction(commitDiff(overlay));
      if (!r.ok) { toast.error(r.error); return; }
      setOverlay({});
      router.refresh();
    });
  }

  function reorder(fleetId: string, dir: -1 | 1) {
    const ids = board.fleets.map((f) => f.id);
    const i = ids.indexOf(fleetId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    startTransition(async () => {
      const r = await reorderFleetsAction(ids);
      if (!r.ok) { toast.error(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between gap-6 border-b border-border px-6 pt-6 pb-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Channels</h1>
          <p className="mt-2 font-mono text-2xs text-faint">
            <span data-num className="text-muted-foreground">{board.channels.length}</span> tracked
            <span className="mx-1.5 text-dim">&middot;</span>
            <span data-num className="text-muted-foreground">{board.fleets.length}</span> fleets
          </p>
        </div>
        <NewFleetDialog />
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 items-stretch overflow-x-auto px-4 py-6">
          <KanbanColumn
            fleetId={null} name="Unassigned" pinned count={buckets.get(null)?.length ?? 0}
            channelIds={buckets.get(null) ?? []} channelsById={channelsById}
            canMoveLeft={false} canMoveRight={false} onMoveLeft={() => {}} onMoveRight={() => {}}
          />
          {board.fleets.map((f, idx) => (
            <KanbanColumn
              key={f.id} fleetId={f.id} name={f.name} pinned={false} count={buckets.get(f.id)?.length ?? 0}
              channelIds={buckets.get(f.id) ?? []} channelsById={channelsById}
              canMoveLeft={idx > 0} canMoveRight={idx < board.fleets.length - 1}
              onMoveLeft={() => reorder(f.id, -1)} onMoveRight={() => reorder(f.id, 1)}
            />
          ))}
        </div>

        <DragOverlay>{activeId ? <ChannelCard channel={channelsById[activeId]} overlay /> : null}</DragOverlay>
      </DndContext>

      <div className="flex flex-none items-center justify-between gap-6 border-t border-line-strong bg-popover px-6 py-3">
        <span className="text-xs text-muted-foreground">
          {dirty
            ? <><span data-num className="text-foreground">{moveCount}</span> unsaved move{moveCount === 1 ? "" : "s"}</>
            : "No unsaved changes"}
        </span>
        <span className="flex items-center gap-3">
          <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={() => setOverlay({})}>Discard</Button>
          <Button variant="default" size="sm" disabled={!dirty || pending} onClick={save}>Save changes</Button>
        </span>
      </div>
    </div>
  );
}
