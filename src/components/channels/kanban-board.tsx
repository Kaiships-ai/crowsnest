"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent, type DropAnimation,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { useNavigationBlocker } from "@/components/layout/navigation-blocker";
import type { ChannelRow, KanbanBoard as KanbanBoardData } from "@/server/queries/channels";
import { moveChannelsAction, reorderFleetsAction } from "@/server/actions/fleet-actions";
import {
  applyMove, commitDiff, currentFleet, groupByFleet, isDirty, pruneOverlay,
  type FleetId, type Overlay,
} from "@/lib/kanban-moves";
import { AddChannelDialog } from "./add-channel-dialog";
import { KanbanColumn, UNASSIGNED } from "./kanban-column";
import { ChannelCard } from "./channel-card";
import { NewFleetDialog } from "./new-fleet-dialog";
import { SyncSelectionBar } from "./sync-selection-bar";

function toFleetId(dropId: string): FleetId {
  return dropId === UNASSIGNED ? null : dropId;
}

/** Read once, not through a hook: this only feeds the drag animation, and the pieces it
 *  gates (the overlay clone, the drop animation) render nothing until a drag starts, so
 *  there is no server/client markup to disagree about. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Short, with a touch of overshoot at the end so a dropped card settles instead of
 *  sliding to a stop. Null under reduced motion: the card just lands. */
const DROP_ANIMATION: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
};

export function ChannelsKanban({ board }: { board: KanbanBoardData }) {
  const router = useRouter();
  const [overlay, setOverlay] = useState<Overlay>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  // The overlay as it stood when the current drag began. onDragOver moves the card live
  // so the target column opens a gap under the cursor; a cancelled or dropped-nowhere
  // drag has to put all of that back.
  const [dragStartOverlay, setDragStartOverlay] = useState<Overlay | null>(null);
  const [pending, startTransition] = useTransition();
  const [reduceMotion] = useState(prefersReducedMotion);

  // Bulk-select state, board-local and in memory only: a reload drops it (ig-sync
  // 03-feature-description, "Sync several channels at once"). Independent of the move
  // overlay above, so selecting never touches a staged fleet move.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { start: startSync, isRunning: syncRunning } = useSyncProgress();
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleColumn(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function syncSelected() {
    if (selected.size === 0) return;
    // Clears once the start resolves. The button is disabled while a sync runs, so the
    // "already running" refusal path is not normally reachable from here.
    void startSync([...selected]).then(() => setSelected(new Set()));
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // The card already spreads sortable.attributes/listeners onto a focusable handle, so
    // this alone makes it movable without a pointer: Space to lift, arrows, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // A refresh (Save, a fleet delete, a rename) hands down a new board. Any pending move
  // aimed at a fleet that no longer exists would render into a bucket the loop below
  // never walks — the card would simply disappear, and Save would fail its foreign key.
  // React's "adjust state when a prop changes" pattern: reconcile during render, before
  // anything is painted, rather than in an effect that paints the broken frame first.
  const [lastBoard, setLastBoard] = useState(board);
  if (lastBoard !== board) {
    setLastBoard(board);
    setOverlay((prev) => pruneOverlay(prev, board.placement, board.fleets.map((f) => f.id)));
  }

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
  const neverSynced = board.channels.filter((c) => c.lastSyncedAt === null).length;

  // Same `dirty` the footer already reads for "No unsaved changes" vs the Save button —
  // reused, not duplicated, as the single source of truth for both leave-guards below.
  const { setIsBlocked } = useNavigationBlocker();
  useEffect(() => {
    setIsBlocked(dirty);
    // Unmounting (the route actually changed, or this board got swapped for another)
    // clears the flag rather than leaving a stale "blocked" behind for whatever mounts
    // next in the shell.
    return () => setIsBlocked(false);
  }, [dirty, setIsBlocked]);

  // Tab close, refresh, or a bare `<a>`/bookmark navigation never runs React effects on
  // the way out, so `onNavigate` on the sidebar's `Link`s (which does cover in-app
  // navigation) cannot reach those cases — only the browser's own confirm can. Standard
  // pattern: set `returnValue` to opt into the native prompt, clear it once nothing is
  // pending so an already-saved board can't still hold the tab hostage.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** over.id is a column droppable id (UNASSIGNED or a fleet id) or a card id; a card
   *  resolves to whichever column that card is currently sitting in. */
  function targetOf(overId: string, from: Overlay): FleetId {
    return overId in channelsById ? currentFleet(board.placement[overId], from, overId) : toFleetId(overId);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragStartOverlay(overlay);
  }

  // Live during the drag, not on drop: moving the card into the hovered column as soon as
  // the cursor is over it is what makes the target open a gap. applyMove still clears the
  // entry when the card comes back over its origin, so hovering home and dropping there
  // leaves nothing staged.
  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (overId === id) return;
    setOverlay((prev) => applyMove(prev, id, board.placement[id], targetOf(overId, prev)));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setDragStartOverlay(null);
    // Dropped outside every column: onDragOver already staged whatever was hovered on the
    // way there, so this reverts rather than leaving a move nobody asked for.
    if (!e.over) {
      if (dragStartOverlay) setOverlay(dragStartOverlay);
      return;
    }
    // Otherwise the overlay already holds the move onDragOver staged; re-apply the final
    // target so a drop that lands without a last dragOver still commits the right column.
    const id = String(e.active.id);
    const overId = String(e.over.id);
    if (overId === id) return;
    setOverlay((prev) => applyMove(prev, id, board.placement[id], targetOf(overId, prev)));
  }

  function onDragCancel() {
    setActiveId(null);
    if (dragStartOverlay) setOverlay(dragStartOverlay);
    setDragStartOverlay(null);
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
      {/* No heading here: the topbar already renders the route title, and a second
          "Channels" one line below it is the duplicate the M6 rule bans. */}
      <div className="flex items-end justify-between gap-6 border-b border-border px-6 pt-6 pb-4">
        <p className="font-mono text-2xs text-faint">
          <span data-testid="channels-tracked-count" data-num className="text-muted-foreground">
            {board.channels.length}
          </span>{" "}
          tracked
          {neverSynced > 0 && (
            <>
              <span className="mx-1.5 text-dim">&middot;</span>
              <span data-num className="text-muted-foreground">{neverSynced}</span> never synced
            </>
          )}
          <span className="mx-1.5 text-dim">&middot;</span>
          <span data-num className="text-muted-foreground">{board.fleets.length}</span> fleets
        </p>
        <span className="flex items-center gap-2">
          <NewFleetDialog />
          <AddChannelDialog />
        </span>
      </div>

      {board.channels.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <p className="text-sm text-foreground">No channels tracked yet.</p>
          <p className="max-w-[44ch] text-sm text-muted-foreground">
            Add the creators you want to research as sources, then run a sync to pull their posts and start scoring
            outliers.
          </p>
          <div className="pt-2">
            <AddChannelDialog />
          </div>
        </div>
      ) : (
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex flex-1 items-stretch overflow-x-auto px-4 py-6">
          <KanbanColumn
            fleetId={null} name="Unassigned" pinned count={buckets.get(null)?.length ?? 0}
            channelIds={buckets.get(null) ?? []} channelsById={channelsById}
            sampleSizeById={board.sampleSizeById}
            canMoveLeft={false} canMoveRight={false} onMoveLeft={() => {}} onMoveRight={() => {}}
            selectedIds={selected} onToggleSelect={toggleSelect} onToggleColumn={toggleColumn}
          />
          {board.fleets.map((f, idx) => (
            <KanbanColumn
              key={f.id} fleetId={f.id} name={f.name} pinned={false} count={buckets.get(f.id)?.length ?? 0}
              channelIds={buckets.get(f.id) ?? []} channelsById={channelsById}
              sampleSizeById={board.sampleSizeById}
              canMoveLeft={idx > 0} canMoveRight={idx < board.fleets.length - 1}
              onMoveLeft={() => reorder(f.id, -1)} onMoveRight={() => reorder(f.id, 1)}
              selectedIds={selected} onToggleSelect={toggleSelect} onToggleColumn={toggleColumn}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={reduceMotion ? null : DROP_ANIMATION}>
          {activeId && channelsById[activeId] ? (
            // The tilt lives on a wrapper, not the card: dnd-kit writes its own transform
            // onto the overlay element it owns, and a rotate on the same node would be
            // overwritten every frame.
            <div style={reduceMotion ? undefined : { transform: "rotate(3deg) scale(1.02)" }}>
              <ChannelCard channel={channelsById[activeId]} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      )}

      {selected.size > 0 && (
        <SyncSelectionBar
          count={selected.size}
          syncing={syncRunning}
          onSync={syncSelected}
          onClear={() => setSelected(new Set())}
        />
      )}

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
