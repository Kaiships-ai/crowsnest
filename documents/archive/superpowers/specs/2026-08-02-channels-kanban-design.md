# Channels Kanban redesign

Date: 2026-08-02
Backlog items: 7 (fleet CRUD) and 8 (Kanban board).

## Problem

The `/channels` page today is a left fleet rail plus a table. Fleets can only be
created, not renamed, reordered, or deleted. Assigning a channel to a fleet goes
through a 3-dot "Edit fleets" dialog per row. The user wants a Kanban board where
fleets are columns and channels are cards dragged between them, with fleet
rename/delete/reorder, and the per-row edit dialog gone.

## Decisions locked with the user

1. One fleet per channel, move semantics. Dragging a card from one column to
   another moves it (it leaves the source). A channel is in zero or one fleet.
2. Columns are a pinned "Unassigned" bucket first, then one column per fleet in
   `sort_order`. Creating or deleting a fleet adds or removes a column. Deleting a
   fleet drops its channels back to Unassigned. Unassigned cannot be renamed or
   deleted.
3. Card face shows avatar, handle, follower count, outliers (30d), and sync
   status. No median views on the card.
4. Only channel moves are staged behind a Save button. Fleet create, rename,
   delete, and reorder write immediately.
5. Data model keeps the `fleet_channels` join table and enforces at most one row
   per channel. A new `fleets.sort_order` column drives column order.
6. Drag and drop uses `@dnd-kit`. Only cards are draggable. Fleet reorder is
   move-left / move-right in the column header menu, not a column drag.

## The median-views note

The "median views bug" the user cited is correct behavior, not a bug. A median
shows a dash when a channel has fewer than 5 posts carrying view counts, too few
to compute a real median (`medianConfidence` / `score_min_usable_posts`). The card
drops median views anyway, per decision 3, so this does not affect the board.

## Data model and migration

Keep `fleet_channels(fleet_id, channel_id)` (composite primary key). Single
membership is enforced by the write path, not a new constraint: a move deletes the
channel's existing row and inserts the new one; a move to Unassigned deletes the
row and inserts nothing.

New migration under `./drizzle`:

- Add `fleets.sort_order` (integer, not null, default 0). Backfill existing fleets
  by `created_at` ascending so current order is preserved.
- Collapse any channel currently in more than one fleet down to a single row. Keep
  the membership whose fleet has the lowest `sort_order` after backfill; delete the
  rest. On this install every channel is already in at most one fleet, so this is a
  safety step, not a data change we expect to fire.

The feed's fleet filter, `getChannelsList(fleetId)`, and fleet counts already join
`fleet_channels`, so they keep working with no query change.

## Server actions

File: `src/server/actions/fleet-actions.ts`.

New:

- `renameFleetAction(fleetId: string, name: string)`. Trims and validates the name
  the same way `createFleetAction` does. Rejects empty.
- `deleteFleetAction(fleetId: string)`. Deletes the fleet row; the existing
  `onDelete: "cascade"` on `fleet_channels.fleet_id` drops its memberships, so
  those channels become Unassigned.
- `reorderFleetsAction(orderedFleetIds: string[])`. Writes `sort_order` from the
  array index. Ignores ids not present; does not touch Unassigned (it has no row).
- `moveChannelsAction(moves: { channelId: string; fleetId: string | null }[])`.
  Applies all moves in one transaction. For each move, delete the channel's current
  `fleet_channels` row, then insert `{fleetId, channelId}` when `fleetId` is not
  null. This is the Save-button commit.

Changed:

- `createFleetAction` sets `sort_order` to the current max plus one so a new fleet
  lands as the last column.

Removed:

- `setChannelFleetsAction` (plural) and the `EditChannelFleetsDialog` component.
  Dragging replaces them.

Every action revalidates `/channels` (and `/feed` where fleet membership affects
the filter) the same way the current actions do.

## Queries

File: `src/server/queries/channels.ts`.

- `getFleets` returns `sort_order` and orders by it, then `created_at` as a tie
  break.
- The board reads ordered fleets plus all channels (each already carrying its
  single fleet via the existing `getChannelsList`), then partitions channels into
  Unassigned plus one list per fleet. A channel with no membership goes to
  Unassigned. Grouping is a simple partition now that membership is single.

## Components

Page: `src/app/(shell)/channels/page.tsx` renders the board instead of the rail +
table. The "Add channel" control and the never-synced/thin-sample summary stay.

New components under `src/components/channels/`:

- `kanban-board.tsx` (client). Owns the board state and the `@dnd-kit` context.
  Holds server-provided buckets as the baseline, plus a local overlay of pending
  moves. Renders the Save/Discard bar when the overlay is non-empty.
- `kanban-column.tsx`. One column: header (name, count, menu), a droppable body,
  and its cards. Unassigned renders without the rename/delete/move menu.
- `channel-card.tsx`. Draggable card. Face shows avatar, handle, follower count,
  outliers (30d), sync status. Click opens `/channels/[id]`. A small menu keeps
  "Sync now" and "Remove channel".
- `fleet-column-menu.tsx`. Rename (inline or small dialog), delete (confirm),
  move left, move right. These call the immediate fleet actions.

The `RemoveChannelDialog` and the per-channel sync flow (`useSyncProgress`) are
reused as-is from the current table.

## Staged-move core (the testable unit)

File: `src/lib/kanban-moves.ts` (pure, no React, no DB).

State: a map of `channelId -> fleetId | null` for channels whose bucket differs
from the server baseline. Functions:

- `applyMove(state, channelId, fromFleetId, toFleetId)`: records the pending
  target, or clears the entry when the target equals the baseline again (moving a
  card back to where it started leaves nothing to save).
- `isDirty(state)`: whether any pending move exists.
- `commitDiff(state)`: the `moves` array `moveChannelsAction` takes.
- `bucketsWithOverlay(baseline, state)`: the buckets to render, baseline with
  pending moves applied, so the board shows the dragged result before Save.

The board component is a thin shell over this: drag events call `applyMove`, the
render reads `bucketsWithOverlay`, Save calls `moveChannelsAction(commitDiff(...))`
then clears the overlay, Discard clears the overlay.

## Save / Discard behavior

- The overlay lives only in the board component. A page refresh or navigation away
  drops unsaved moves; there is no navigation guard in this version (out of scope,
  the sticky bar is the signal).
- Save commits, then relies on the action's revalidate to refresh the baseline;
  the overlay is cleared on success. On failure, show the action error and keep the
  overlay so the moves are not lost.
- Fleet create/rename/delete/reorder happen outside the overlay and refresh the
  board immediately. A delete while moves are pending drops the deleted fleet's
  cards to Unassigned in the new baseline; any pending move targeting that fleet is
  dropped from the overlay on refresh.

## Testing

- `kanban-moves.ts`: unit tests for applyMove (new move, move back to baseline
  clears, overwrite an existing pending move), isDirty, commitDiff shape, and
  bucketsWithOverlay grouping.
- `fleet-actions`: rename (trim, reject empty), delete cascades memberships to
  Unassigned, reorder writes sort_order by index, moveChannels applies a batch and
  leaves each channel in exactly one row (or none for Unassigned), createFleet
  appends sort_order.
- `channels` query: getFleets ordering by sort_order, board partition puts a
  no-membership channel in Unassigned and a member in its fleet.
- Migration: a channel seeded in two fleets collapses to the lowest-sort_order one.

Drag gestures themselves are not unit tested; the logic they drive lives in
`kanban-moves.ts` and is tested there. A live browser pass confirms the drag,
Save, Discard, and fleet menu actions.

## Reference mockup and interaction feel (approved)

An interactive mockup was built and approved: `public/kanban-mockup.html` (served at
http://localhost:3000/kanban-mockup.html during design; a throwaway, removed in the
implementation PR). It fixes the look and the drag feel the production build should match.

Look, from src/app/globals.css: dark tokens, radius 0 except pill buttons and circular
avatars, Archivo for words and IBM Plex Mono for numbers, amber on one action per screen
(Save changes) plus the score. Board is a pinned Unassigned column then one column per
fleet, split by full-height hairline lane dividers. Card face: avatar letter, handle,
follower count, outliers 30d, a sync-status line with a small state dot. The own channel
carries a "My channel" caption under the handle. Empty fleet uses the hatch "no data" well.

Drag feel (apple-design): the card tracks the pointer 1:1 from the grab point, tilts
toward the drag direction, and lifts through border and surface (dark theme has no
shadows). Sibling cards slide to open the target gap. On release the card springs to the
slot carrying the throw velocity, slight bounce, then settles. Column counts and the
"N unsaved moves" bar update live; Discard reverts, Save clears. prefers-reduced-motion
drops the tilt and spring for an instant move.

The mockup runs on vanilla JS to prove the interaction. Production uses @dnd-kit (decision
6), which reaches the same feel with keyboard and pointer support the hand-rolled version
skips. Match the mockup's spring character (roughly damping 0.8, response 0.35) and the
FLIP reflow.

## Out of scope

- Median views on cards.
- A navigation-away guard for unsaved moves.
- Column drag (reorder is menu-driven).
- Any change to the feed's fleet filter or the channel detail page.
