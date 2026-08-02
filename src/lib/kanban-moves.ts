/**
 * Pure staged-move core for the Channels Kanban board. No React, no DB. The board
 * component holds the server-provided baseline plus this overlay of pending moves;
 * Save commits `commitDiff`, Discard drops the overlay. Extracted so the move logic is
 * unit-testable without mounting the board or driving a drag.
 */
export type FleetId = string | null; // null is the pinned Unassigned bucket
export type ChannelPlacement = { id: string; fleetId: FleetId };
export type Overlay = Record<string, FleetId>;
export type Move = { channelId: string; fleetId: FleetId };

export function currentFleet(baselineFleet: FleetId, overlay: Overlay, id: string): FleetId {
  return id in overlay ? overlay[id] : baselineFleet;
}

/**
 * Record a pending target for `id`, or clear it when the target equals the baseline
 * again (dragging a card back where it started leaves nothing to save). Returns a new
 * overlay; never mutates the input.
 */
export function applyMove(overlay: Overlay, id: string, baselineFleet: FleetId, toFleet: FleetId): Overlay {
  const next = { ...overlay };
  if (toFleet === baselineFleet) delete next[id];
  else next[id] = toFleet;
  return next;
}

/**
 * Drop overlay entries the server no longer agrees with, after a refresh handed the
 * board a new baseline. Three ways an entry goes stale: the channel was removed, the
 * target fleet was deleted (its column is gone, so `groupByFleet` would mint a bucket
 * the render loop never walks and the card would vanish, and Save's insert would fail
 * the foreign key), or the move already landed and the baseline now matches the target
 * so there is nothing left to save.
 */
export function pruneOverlay(
  overlay: Overlay,
  baseline: Record<string, FleetId>,
  fleetIds: Iterable<string>
): Overlay {
  const live = new Set(fleetIds);
  const next: Overlay = {};
  for (const [id, target] of Object.entries(overlay)) {
    if (!(id in baseline)) continue;
    if (target !== null && !live.has(target)) continue;
    if (target === baseline[id]) continue;
    next[id] = target;
  }
  return next;
}

export function isDirty(overlay: Overlay): boolean {
  return Object.keys(overlay).length > 0;
}

export function commitDiff(overlay: Overlay): Move[] {
  return Object.entries(overlay).map(([channelId, fleetId]) => ({ channelId, fleetId }));
}

/**
 * The buckets to render: each channel placed in its current fleet (overlay target if
 * pending, else baseline), grouped in the given fleet order, preserving the channels'
 * input order within each bucket. Every fleet in `fleetOrder` gets a bucket so empty
 * columns still render.
 */
export function groupByFleet(
  channels: ChannelPlacement[],
  overlay: Overlay,
  fleetOrder: FleetId[]
): Map<FleetId, string[]> {
  const groups = new Map<FleetId, string[]>();
  for (const f of fleetOrder) groups.set(f, []);
  for (const c of channels) {
    const fleet = currentFleet(c.fleetId, overlay, c.id);
    if (!groups.has(fleet)) groups.set(fleet, []);
    groups.get(fleet)!.push(c.id);
  }
  return groups;
}
