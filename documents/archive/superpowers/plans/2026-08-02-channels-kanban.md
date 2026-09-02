# Channels Kanban implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/channels` fleet-rail-plus-table with a Kanban board where fleets are columns and channels are cards dragged between them, plus fleet rename, delete, and reorder.

**Architecture:** Keep the `fleet_channels` join table and enforce one fleet per channel at the write path. A new `fleets.sort_order` column drives column order. Channel moves are staged in client state (a pure `kanban-moves` module) and committed in one batch on Save; fleet create, rename, delete, and reorder write immediately. Drag uses `@dnd-kit`.

**Tech Stack:** Next.js 16 (app router, server actions), drizzle-orm + better-sqlite3, vitest, @dnd-kit, Tailwind + shadcn (Base UI), Archivo + IBM Plex Mono.

## Global constraints

- Spec: `docs/superpowers/specs/2026-08-02-channels-kanban-design.md`. Approved look and drag feel: `public/kanban-mockup.html` (deleted in the last task).
- Read `node_modules/next/dist/docs/` before writing framework code. This is Next.js 16, not a version from training data.
- One fleet per channel, move semantics. A channel is in zero or one fleet.
- Data model keeps `fleet_channels(fleet_id, channel_id)`. Single membership is enforced by the write path (delete then insert), not a new constraint.
- Only channel moves are staged behind Save. Fleet create, rename, delete, and reorder write immediately.
- Deleting a fleet drops its channels to Unassigned via the existing `onDelete: "cascade"` on `fleet_channels.fleet_id`.
- Unassigned is a pinned first column. It is not a fleet row and cannot be renamed, deleted, or reordered.
- Card face shows avatar letter, handle, follower count, outliers (30d), sync status. No median views.
- Amber (`--primary`) on one action per screen (Save changes) plus the score. Radius 0 except pill buttons and circular avatars. Dark theme has no shadows; the drag lift reads through border and surface.
- Match the mockup's spring character (roughly damping 0.8, response 0.35) and FLIP reflow. Respect `prefers-reduced-motion`.
- Every server action revalidates `/channels`, and the ones that change membership also revalidate `/feed`.
- Branch: `feat/channels-kanban` (already exists, spec committed). Commit each task there.
- Verify per task: `npx tsc --noEmit`, `npx vitest run`, and a real `npx next build` before the final PR (a page-file export broke the build in a prior round and tsc missed it).

---

### Task 1: Schema and migration, fleets.sort_order plus single-membership collapse

**Files:**
- Modify: `src/server/db/schema.ts` (the `fleets` table, around line 73)
- Create: `drizzle/0011_*.sql` (generated, then hand-edited)
- Create: `drizzle/meta/0011_snapshot.json` (generated) and updated `drizzle/meta/_journal.json`
- Test: `src/server/db/migrations.test.ts`

**Interfaces:**
- Produces: `tables.fleets.sortOrder` (integer, not null, default 0). Every channel has at most one `fleet_channels` row after this migration runs.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/db/migrations.test.ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("./index")["db"];
let tables: typeof import("./index")["tables"];
let newId: typeof import("./index")["newId"];
let nowIso: typeof import("./index")["nowIso"];
let migrate: typeof import("./test-migrate")["migrate"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("./index"));
  ({ migrate } = await import("./test-migrate"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.channels);
});

describe("0011 sort_order + single-membership collapse", () => {
  test("fleets carry a sort_order column defaulting to 0", async () => {
    const id = newId();
    await db.insert(tables.fleets).values({ id, name: "A", createdAt: nowIso() });
    const [row] = await db.select().from(tables.fleets).where(eq(tables.fleets.id, id));
    expect(row.sortOrder).toBe(0);
  });

  test("a channel in two fleets is collapsed to one row on migrate", async () => {
    // Seed a multi-membership row set by hand, then re-run migrate() to prove the
    // collapse SQL is idempotent and leaves exactly one membership.
    const chId = newId();
    const fA = newId(), fB = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@x", trackedSince: nowIso() });
    await db.insert(tables.fleets).values([
      { id: fA, name: "A", createdAt: "2026-01-01T00:00:00.000Z", sortOrder: 0 },
      { id: fB, name: "B", createdAt: "2026-01-02T00:00:00.000Z", sortOrder: 1 },
    ]);
    await db.insert(tables.fleetChannels).values([
      { fleetId: fA, channelId: chId },
      { fleetId: fB, channelId: chId },
    ]);

    migrate(); // re-applies committed migrations, including the collapse

    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, chId));
    expect(rows).toHaveLength(1);
    // Keeps the lowest sort_order fleet (A).
    expect(rows[0].fleetId).toBe(fA);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/db/migrations.test.ts`
Expected: FAIL, `row.sortOrder` is undefined (column does not exist yet).

- [ ] **Step 3: Add the column to the schema**

In `src/server/db/schema.ts`, the `fleets` table becomes:

```ts
export const fleets = sqliteTable("fleets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nicheLabel: text("niche_label"),
  // Column order on the Channels Kanban board. Backfilled by created_at on migration;
  // reorderFleetsAction writes the array index. Unassigned is not a fleet row and is
  // always pinned first, so it has no sort_order.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
This writes `drizzle/0011_<name>.sql` (the `ALTER TABLE fleets ADD sort_order`) plus meta files. Note the generated filename.

- [ ] **Step 5: Append the backfill and collapse SQL to the generated migration**

Open the new `drizzle/0011_*.sql` and append below the generated `ALTER TABLE`:

```sql
--> statement-breakpoint
-- Backfill column order from creation order so the current order is preserved.
UPDATE fleets
SET sort_order = (
  SELECT COUNT(*) FROM fleets f2 WHERE f2.created_at < fleets.created_at
);
--> statement-breakpoint
-- Collapse any channel in more than one fleet to a single membership: keep the row
-- whose fleet has the lowest sort_order, delete the rest. On this install every channel
-- is already in at most one fleet, so this is a safety step.
DELETE FROM fleet_channels
WHERE rowid NOT IN (
  SELECT fc.rowid
  FROM fleet_channels fc
  JOIN fleets f ON f.id = fc.fleet_id
  WHERE NOT EXISTS (
    SELECT 1 FROM fleet_channels fc2
    JOIN fleets f2 ON f2.id = fc2.fleet_id
    WHERE fc2.channel_id = fc.channel_id
      AND (f2.sort_order < f.sort_order OR (f2.sort_order = f.sort_order AND f2.id < f.id))
  )
);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/server/db/migrations.test.ts`
Expected: PASS both tests.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts drizzle/0011_* drizzle/meta src/server/db/migrations.test.ts
git commit -m "feat(channels): add fleets.sort_order and collapse to single fleet membership"
```

---

### Task 2: Pure staged-move core, src/lib/kanban-moves.ts

**Files:**
- Create: `src/lib/kanban-moves.ts`
- Test: `src/lib/kanban-moves.test.ts`

**Interfaces:**
- Produces:
  - `type FleetId = string | null` (null is the Unassigned bucket)
  - `type ChannelPlacement = { id: string; fleetId: FleetId }` (committed baseline placement)
  - `type Overlay = Record<string, FleetId>` (channelId to pending target; absent means unchanged)
  - `type Move = { channelId: string; fleetId: FleetId }`
  - `currentFleet(baselineFleet: FleetId, overlay: Overlay, id: string): FleetId`
  - `applyMove(overlay: Overlay, id: string, baselineFleet: FleetId, toFleet: FleetId): Overlay`
  - `isDirty(overlay: Overlay): boolean`
  - `commitDiff(overlay: Overlay): Move[]`
  - `groupByFleet(channels: ChannelPlacement[], overlay: Overlay, fleetOrder: FleetId[]): Map<FleetId, string[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/kanban-moves.test.ts
import { describe, expect, test } from "vitest";
import { applyMove, commitDiff, currentFleet, groupByFleet, isDirty } from "./kanban-moves";

describe("applyMove", () => {
  test("records a pending target when moving away from baseline", () => {
    expect(applyMove({}, "a", "f1", "f2")).toEqual({ a: "f2" });
  });

  test("clears the entry when moved back to baseline", () => {
    expect(applyMove({ a: "f2" }, "a", "f1", "f1")).toEqual({});
  });

  test("moving to Unassigned (null) records null; back to a null baseline clears it", () => {
    expect(applyMove({}, "a", "f1", null)).toEqual({ a: null });
    expect(applyMove({ a: "f1" }, "a", null, null)).toEqual({});
  });

  test("overwrites an existing pending move", () => {
    expect(applyMove({ a: "f2" }, "a", "f1", "f3")).toEqual({ a: "f3" });
  });
});

describe("currentFleet", () => {
  test("returns the overlay target when present, else the baseline", () => {
    expect(currentFleet("f1", { a: "f2" }, "a")).toBe("f2");
    expect(currentFleet("f1", {}, "a")).toBe("f1");
  });
});

describe("isDirty / commitDiff", () => {
  test("isDirty is false for an empty overlay, true otherwise", () => {
    expect(isDirty({})).toBe(false);
    expect(isDirty({ a: "f2" })).toBe(true);
  });

  test("commitDiff turns the overlay into a Move array", () => {
    expect(commitDiff({ a: "f2", b: null })).toEqual([
      { channelId: "a", fleetId: "f2" },
      { channelId: "b", fleetId: null },
    ]);
  });
});

describe("groupByFleet", () => {
  test("groups channels into buckets by current fleet, preserving input order", () => {
    const channels = [
      { id: "a", fleetId: null },
      { id: "b", fleetId: "f1" },
      { id: "c", fleetId: "f1" },
    ];
    const groups = groupByFleet(channels, { c: null }, [null, "f1"]);
    expect(groups.get(null)).toEqual(["a", "c"]);
    expect(groups.get("f1")).toEqual(["b"]);
  });

  test("every fleet in fleetOrder gets a bucket, empty ones included", () => {
    const groups = groupByFleet([], {}, [null, "f1", "f2"]);
    expect([...groups.keys()]).toEqual([null, "f1", "f2"]);
    expect(groups.get("f2")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/kanban-moves.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/kanban-moves.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/kanban-moves.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kanban-moves.ts src/lib/kanban-moves.test.ts
git commit -m "feat(channels): pure staged-move core for the Kanban board"
```

---

### Task 3: Fleet actions, rename, delete, reorder, batch move; drop the old setter

**Files:**
- Modify: `src/server/actions/fleet-actions.ts`
- Modify: `src/server/actions/fleet-actions.test.ts`

**Interfaces:**
- Consumes: `Move` shape from Task 2 (`{ channelId: string; fleetId: string | null }`).
- Produces:
  - `createFleetAction(name: string): Promise<ActionResult<{ fleetId: string }>>` (now sets sort_order to max+1)
  - `renameFleetAction(fleetId: string, name: string): Promise<SimpleResult>`
  - `deleteFleetAction(fleetId: string): Promise<SimpleResult>`
  - `reorderFleetsAction(orderedFleetIds: string[]): Promise<SimpleResult>`
  - `moveChannelsAction(moves: { channelId: string; fleetId: string | null }[]): Promise<SimpleResult>`
  - `setChannelFleetsAction` is removed.

- [ ] **Step 1: Rewrite the test file**

Replace `src/server/actions/fleet-actions.test.ts` with:

```ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let newId: typeof import("../db")["newId"];
let nowIso: typeof import("../db")["nowIso"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let actions: typeof import("./fleet-actions");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  actions = await import("./fleet-actions");
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.channels);
});

async function seedChannel(): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle: `@t-${id}`, trackedSince: nowIso() });
  return id;
}
async function makeFleet(name: string): Promise<string> {
  const r = (await actions.createFleetAction(name)) as { ok: true; fleetId: string };
  return r.fleetId;
}

describe("createFleetAction", () => {
  test("creates a trimmed fleet and appends it as the last column", async () => {
    const a = await makeFleet("First");
    const b = await makeFleet("Second");
    const rows = await db.select().from(tables.fleets);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[a].sortOrder).toBeLessThan(byId[b].sortOrder);
  });

  test("rejects an empty name without touching the db", async () => {
    const result = await actions.createFleetAction("   ");
    expect(result).toEqual({ ok: false, error: "Fleet name can't be empty." });
    expect(await db.select().from(tables.fleets)).toHaveLength(0);
  });
});

describe("renameFleetAction", () => {
  test("updates the name, trimmed", async () => {
    const id = await makeFleet("Old");
    const result = await actions.renameFleetAction(id, "  New  ");
    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(tables.fleets).where(eq(tables.fleets.id, id));
    expect(row.name).toBe("New");
  });

  test("rejects an empty name", async () => {
    const id = await makeFleet("Old");
    expect(await actions.renameFleetAction(id, "  ")).toEqual({ ok: false, error: "Fleet name can't be empty." });
  });
});

describe("deleteFleetAction", () => {
  test("deletes the fleet and drops its channels to Unassigned", async () => {
    const ch = await seedChannel();
    const id = await makeFleet("Gone");
    await actions.moveChannelsAction([{ channelId: ch, fleetId: id }]);

    const result = await actions.deleteFleetAction(id);

    expect(result).toEqual({ ok: true });
    expect(await db.select().from(tables.fleets).where(eq(tables.fleets.id, id))).toHaveLength(0);
    // membership cascaded away, so the channel is now in no fleet (Unassigned)
    expect(await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, ch))).toHaveLength(0);
  });
});

describe("reorderFleetsAction", () => {
  test("writes sort_order from the array index", async () => {
    const a = await makeFleet("A");
    const b = await makeFleet("B");
    const c = await makeFleet("C");

    await actions.reorderFleetsAction([c, a, b]);

    const rows = await db.select().from(tables.fleets);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.sortOrder]));
    expect([byId[c], byId[a], byId[b]]).toEqual([0, 1, 2]);
  });
});

describe("moveChannelsAction", () => {
  test("leaves each moved channel in exactly one fleet row", async () => {
    const ch = await seedChannel();
    const f1 = await makeFleet("F1");
    const f2 = await makeFleet("F2");

    await actions.moveChannelsAction([{ channelId: ch, fleetId: f1 }]);
    await actions.moveChannelsAction([{ channelId: ch, fleetId: f2 }]);

    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, ch));
    expect(rows).toHaveLength(1);
    expect(rows[0].fleetId).toBe(f2);
  });

  test("a move to null (Unassigned) removes the membership row", async () => {
    const ch = await seedChannel();
    const f1 = await makeFleet("F1");
    await actions.moveChannelsAction([{ channelId: ch, fleetId: f1 }]);

    await actions.moveChannelsAction([{ channelId: ch, fleetId: null }]);

    expect(await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, ch))).toHaveLength(0);
  });

  test("applies a batch of moves for several channels at once", async () => {
    const a = await seedChannel();
    const b = await seedChannel();
    const f1 = await makeFleet("F1");
    const f2 = await makeFleet("F2");

    await actions.moveChannelsAction([
      { channelId: a, fleetId: f1 },
      { channelId: b, fleetId: f2 },
    ]);

    const rowsA = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, a));
    const rowsB = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, b));
    expect(rowsA.map((r) => r.fleetId)).toEqual([f1]);
    expect(rowsB.map((r) => r.fleetId)).toEqual([f2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/actions/fleet-actions.test.ts`
Expected: FAIL, the new actions do not exist.

- [ ] **Step 3: Rewrite the actions file**

Replace `src/server/actions/fleet-actions.ts` with:

```ts
"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, newId, nowIso, tables } from "../db";

type SimpleResult = { ok: true } | { ok: false; error: string };
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/** Revalidate the board, and the feed too when fleet membership changed (the feed's
 *  fleet filter reads the same join table). */
function revalidateChannels(touchesMembership = false) {
  revalidatePath("/channels");
  if (touchesMembership) revalidatePath("/feed");
}

export async function createFleetAction(name: string): Promise<ActionResult<{ fleetId: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Fleet name can't be empty." };
    const [{ max }] = await db.select({ max: sql<number | null>`max(${tables.fleets.sortOrder})` }).from(tables.fleets);
    const id = newId();
    await db.insert(tables.fleets).values({ id, name: trimmed, createdAt: nowIso(), sortOrder: (max ?? -1) + 1 });
    revalidateChannels();
    return { ok: true, fleetId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function renameFleetAction(fleetId: string, name: string): Promise<SimpleResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Fleet name can't be empty." };
    await db.update(tables.fleets).set({ name: trimmed }).where(eq(tables.fleets.id, fleetId));
    revalidateChannels();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The `onDelete: "cascade"` on fleet_channels.fleet_id drops the memberships, so the
 *  fleet's channels become Unassigned. */
export async function deleteFleetAction(fleetId: string): Promise<SimpleResult> {
  try {
    await db.delete(tables.fleets).where(eq(tables.fleets.id, fleetId));
    revalidateChannels(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function reorderFleetsAction(orderedFleetIds: string[]): Promise<SimpleResult> {
  try {
    await db.transaction((tx) => {
      orderedFleetIds.forEach((id, index) => {
        tx.update(tables.fleets).set({ sortOrder: index }).where(eq(tables.fleets.id, id)).run();
      });
    });
    revalidateChannels();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commit a batch of channel moves in one transaction. Each move replaces the channel's
 * single fleet_channels row: delete any existing row, then insert one when fleetId is
 * not null (null means Unassigned, so no row). This is the Save-button commit and the
 * only place that enforces one fleet per channel.
 */
export async function moveChannelsAction(
  moves: { channelId: string; fleetId: string | null }[]
): Promise<SimpleResult> {
  try {
    if (moves.length === 0) return { ok: true };
    await db.transaction((tx) => {
      const channelIds = moves.map((m) => m.channelId);
      tx.delete(tables.fleetChannels).where(inArray(tables.fleetChannels.channelId, channelIds)).run();
      const inserts = moves
        .filter((m) => m.fleetId !== null)
        .map((m) => ({ fleetId: m.fleetId as string, channelId: m.channelId }));
      if (inserts.length > 0) tx.insert(tables.fleetChannels).values(inserts).run();
    });
    revalidateChannels(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/actions/fleet-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/fleet-actions.ts src/server/actions/fleet-actions.test.ts
git commit -m "feat(channels): fleet rename/delete/reorder and batch moveChannels actions"
```

---

### Task 4: Queries, order fleets by sort_order and expose the board grouping

**Files:**
- Modify: `src/server/queries/channels.ts` (`getFleets`, and add `getKanbanBoard`)
- Test: `src/server/queries/channels.kanban.test.ts`

**Interfaces:**
- Consumes: `ChannelRow` (existing), `Fleet` (existing, gains `sortOrder`).
- Produces:
  - `getFleets(): Promise<Fleet[]>` ordered by `sortOrder` then `createdAt`.
  - `type KanbanBoard = { fleets: Fleet[]; channels: ChannelRow[]; placement: Record<string, string | null> }` where `placement[channelId]` is the channel's single fleet id or null.
  - `getKanbanBoard(): Promise<KanbanBoard>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/queries/channels.kanban.test.ts
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let newId: typeof import("../db")["newId"];
let nowIso: typeof import("../db")["nowIso"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let getFleets: typeof import("./channels")["getFleets"];
let getKanbanBoard: typeof import("./channels")["getKanbanBoard"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  ({ getFleets, getKanbanBoard } = await import("./channels"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.channels);
});

async function seedChannel(handle: string): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle, trackedSince: nowIso(), lastSyncedAt: nowIso() });
  return id;
}

describe("getFleets ordering", () => {
  test("returns fleets by sort_order ascending", async () => {
    await db.insert(tables.fleets).values([
      { id: "b", name: "B", createdAt: nowIso(), sortOrder: 1 },
      { id: "a", name: "A", createdAt: nowIso(), sortOrder: 0 },
    ]);
    const fleets = await getFleets();
    expect(fleets.map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("getKanbanBoard", () => {
  test("places a member in its fleet and a non-member as null (Unassigned)", async () => {
    const inFleet = await seedChannel("@in");
    const loose = await seedChannel("@loose");
    await db.insert(tables.fleets).values({ id: "f1", name: "F1", createdAt: nowIso(), sortOrder: 0 });
    await db.insert(tables.fleetChannels).values({ fleetId: "f1", channelId: inFleet });

    const board = await getKanbanBoard();

    expect(board.fleets.map((f) => f.id)).toEqual(["f1"]);
    expect(board.placement[inFleet]).toBe("f1");
    expect(board.placement[loose]).toBe(null);
    expect(board.channels.map((c) => c.id).sort()).toEqual([inFleet, loose].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/queries/channels.kanban.test.ts`
Expected: FAIL, `getKanbanBoard` not exported; `getFleets` may not order yet.

- [ ] **Step 3: Update getFleets and add getKanbanBoard**

In `src/server/queries/channels.ts`:

Add `sortOrder` to the `Fleet` interface (near line 178) and order the query:

```ts
export interface Fleet {
  id: string;
  name: string;
  channelCount: number;
  sortOrder: number;
}

export async function getFleets(): Promise<Fleet[]> {
  const fleets = await db.select().from(tables.fleets).orderBy(tables.fleets.sortOrder, tables.fleets.createdAt);
  return Promise.all(
    fleets.map(async (f) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tables.fleetChannels)
        .where(eq(tables.fleetChannels.fleetId, f.id));
      return { id: f.id, name: f.name, channelCount: row?.count ?? 0, sortOrder: f.sortOrder };
    })
  );
}
```

Then add, near `getChannelsList`:

```ts
export interface KanbanBoard {
  fleets: Fleet[];
  channels: ChannelRow[];
  /** channelId to its single fleet id, or null for Unassigned. */
  placement: Record<string, string | null>;
}

/**
 * The Channels Kanban board: ordered fleets, every channel as a card row, and each
 * channel's single fleet placement (null is Unassigned). Membership is single now
 * (Task 1 collapse plus moveChannelsAction), so `channel.fleets[0]` is the whole story.
 */
export async function getKanbanBoard(): Promise<KanbanBoard> {
  const [fleets, channels] = await Promise.all([getFleets(), getChannelsList()]);
  const placement: Record<string, string | null> = {};
  for (const c of channels) placement[c.id] = c.fleets[0]?.id ?? null;
  return { fleets, channels, placement };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/queries/channels.kanban.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the existing channels-query tests still pass (Fleet gained a field)**

Run: `npx vitest run src/server/queries`
Expected: PASS. If a test asserts a full `Fleet` object with `toEqual`, add `sortOrder` to its expectation.

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/channels.ts src/server/queries/channels.kanban.test.ts
git commit -m "feat(channels): order fleets by sort_order and add getKanbanBoard"
```

---

### Task 5: Add @dnd-kit

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` available to import.

- [ ] **Step 1: Install**

Run: `npm install @dnd-kit/core@^6 @dnd-kit/sortable@^8 @dnd-kit/utilities@^3`

- [ ] **Step 2: Verify tsc still resolves**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit for the Channels Kanban board"
```

---

### Task 6: channel-card component

**Files:**
- Create: `src/components/channels/channel-card.tsx`

**Interfaces:**
- Consumes: `ChannelRow` from `@/server/queries/channels`, `useSyncProgress` from `@/components/sync/use-sync-progress`, `RemoveChannelDialog` from `./remove-channel-dialog`, `formatCompact`/`relativeTime` from `@/lib/format`, `assetUrl` from `@/lib/media-url`, `@dnd-kit/sortable`'s `useSortable`, `@dnd-kit/utilities`'s `CSS`.
- Produces: `ChannelCard({ channel, overlay }: { channel: ChannelRow; overlay?: boolean })`. `overlay` renders the static drag-overlay clone (no dnd hooks, no menu).

Before writing, open the current `src/components/channels/channel-table.tsx` and copy the exact `syncHealth` wording, the `useSyncProgress().start([id])` call, the `Button` size and variant names, and the `RemoveChannelDialog` props. Match them so behavior is identical. The outliers value uses the same missing-data dash the table uses: `channel.lastSyncedAt === null ? "—" : channel.outliers30d`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { formatCompact, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import type { ChannelRow } from "@/server/queries/channels";
import { RemoveChannelDialog } from "./remove-channel-dialog";

function syncLine(c: ChannelRow): { label: string; tone: "faint" | "muted" | "destructive" } {
  if (c.lastSyncedAt === null) return { label: "Never synced", tone: "faint" };
  if (c.syncError) return { label: "Sync failed", tone: "destructive" };
  return { label: `Synced ${relativeTime(c.lastSyncedAt)}`, tone: "muted" };
}

export function ChannelCard({ channel, overlay = false }: { channel: ChannelRow; overlay?: boolean }) {
  const router = useRouter();
  const { start } = useSyncProgress();
  const [removing, setRemoving] = useState(false);
  const sortable = useSortable({ id: channel.id, disabled: overlay });
  const health = syncLine(channel);

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };

  return (
    <>
      <article
        ref={overlay ? undefined : sortable.setNodeRef}
        style={style}
        data-dragging={sortable.isDragging ? "" : undefined}
        className="border border-border bg-card px-4 pt-3 pb-4 select-none data-[dragging]:opacity-40"
      >
        <div className="flex items-center gap-2.5">
          {/* The card body is the drag handle; the menu button stops propagation. */}
          <span
            {...(overlay ? {} : { ...sortable.attributes, ...sortable.listeners })}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Avatar size="sm">
              <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
              <AvatarFallback>
                {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{channel.handle}</span>
              {channel.isOwn && <span className="font-mono text-2xs uppercase tracking-wide text-faint">My channel</span>}
            </span>
          </span>
          {!overlay && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Channel actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void start([channel.id])}>Sync now</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/channels/${channel.id}`)}>View</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>Remove channel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-3 flex gap-6">
          <span className="flex flex-col gap-0.5">
            <span data-num className="text-xs text-foreground">{formatCompact(channel.followerCount)}</span>
            <span className="text-2xs text-faint">followers</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span data-num className="text-xs text-foreground">{channel.lastSyncedAt === null ? "—" : channel.outliers30d}</span>
            <span className="text-2xs text-faint">outliers 30d</span>
          </span>
        </div>

        <div className={`mt-3 text-2xs ${health.tone === "destructive" ? "text-destructive" : health.tone === "faint" ? "text-faint" : "text-muted-foreground"}`}>
          {health.label}
        </div>
      </article>

      {removing && (
        <RemoveChannelDialog
          channel={channel}
          open={removing}
          onOpenChange={(o) => !o && setRemoving(false)}
          onRemoved={() => { setRemoving(false); router.refresh(); }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/channels/channel-card.tsx
git commit -m "feat(channels): channel card for the Kanban board"
```

---

### Task 7: fleet-column-menu and rename dialog

**Files:**
- Create: `src/components/channels/fleet-column-menu.tsx`
- Create: `src/components/channels/rename-fleet-dialog.tsx`

**Interfaces:**
- Consumes: `renameFleetAction`, `deleteFleetAction` from `@/server/actions/fleet-actions`.
- Produces: `FleetColumnMenu({ fleetId, name, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight }: { fleetId: string; name: string; canMoveLeft: boolean; canMoveRight: boolean; onMoveLeft: () => void; onMoveRight: () => void })`.

Model `rename-fleet-dialog.tsx` on the existing `new-fleet-dialog.tsx` (same input, submit, and error handling), pre-filled with `currentName`, calling the passed `rename(fleetId, value)` action.

- [ ] **Step 1: Write both components**

```tsx
// src/components/channels/fleet-column-menu.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteFleetAction, renameFleetAction } from "@/server/actions/fleet-actions";
import { RenameFleetDialog } from "./rename-fleet-dialog";

export function FleetColumnMenu({
  fleetId, name, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
}: {
  fleetId: string; name: string; canMoveLeft: boolean; canMoveRight: boolean; onMoveLeft: () => void; onMoveRight: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);

  async function del() {
    const r = await deleteFleetAction(fleetId);
    if (!r.ok) { toast.error(r.error); return; }
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Fleet actions" />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => setRenaming(true)}><Pencil /> Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => void del()}><Trash2 /> Delete</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!canMoveLeft} onClick={onMoveLeft}><ChevronLeft /> Move left</DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveRight} onClick={onMoveRight}><ChevronRight /> Move right</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renaming && (
        <RenameFleetDialog
          fleetId={fleetId}
          currentName={name}
          open={renaming}
          onOpenChange={(o) => !o && setRenaming(false)}
          onRenamed={() => { setRenaming(false); router.refresh(); }}
          rename={renameFleetAction}
        />
      )}
    </>
  );
}
```

The `rename-fleet-dialog.tsx` uses the same Dialog primitives as `new-fleet-dialog.tsx`. Signature:

```tsx
export function RenameFleetDialog({
  fleetId, currentName, open, onOpenChange, onRenamed, rename,
}: {
  fleetId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
  rename: (fleetId: string, name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) { /* text input pre-filled with currentName; submit calls rename(fleetId, value); on ok call onRenamed(), on error show the message */ }
```

Copy the input, submit button, and error-line markup from `new-fleet-dialog.tsx` so the two dialogs match.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/channels/fleet-column-menu.tsx src/components/channels/rename-fleet-dialog.tsx
git commit -m "feat(channels): fleet column menu (rename, delete, reorder)"
```

---

### Task 8: kanban-column component

**Files:**
- Create: `src/components/channels/kanban-column.tsx`

**Interfaces:**
- Consumes: `ChannelCard` (Task 6), `FleetColumnMenu` (Task 7), `@dnd-kit/core`'s `useDroppable`, `@dnd-kit/sortable`'s `SortableContext` + `verticalListSortingStrategy`.
- Produces: `KanbanColumn` and the `UNASSIGNED` sentinel. Props: `{ fleetId: string | null; name: string; pinned: boolean; count: number; channelIds: string[]; channelsById: Record<string, ChannelRow>; canMoveLeft: boolean; canMoveRight: boolean; onMoveLeft: () => void; onMoveRight: () => void }`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { ChannelRow } from "@/server/queries/channels";
import { ChannelCard } from "./channel-card";
import { FleetColumnMenu } from "./fleet-column-menu";

export const UNASSIGNED = "unassigned";

export function KanbanColumn({
  fleetId, name, pinned, count, channelIds, channelsById, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight,
}: {
  fleetId: string | null; name: string; pinned: boolean; count: number;
  channelIds: string[]; channelsById: Record<string, ChannelRow>;
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
          {channelIds.map((id) => <ChannelCard key={id} channel={channelsById[id]} />)}
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
```

Note: confirm `text-2xs` exists (it does, used across the app) and that `w-[280px]` renders. If the app defines a spacing token for column width, prefer it.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/channels/kanban-column.tsx
git commit -m "feat(channels): kanban column with droppable body and empty well"
```

---

### Task 9: kanban-board component, dnd context, staged moves, save bar

**Files:**
- Create: `src/components/channels/kanban-board.tsx`

**Interfaces:**
- Consumes: `KanbanBoard` type from `@/server/queries/channels`, `kanban-moves` (Task 2), `moveChannelsAction` + `reorderFleetsAction` from `@/server/actions/fleet-actions`, `KanbanColumn` + `UNASSIGNED` (Task 8), `ChannelCard` (Task 6, as the drag overlay), `@dnd-kit/core` (`DndContext`, `DragOverlay`, `PointerSensor`, `useSensor`, `useSensors`), `NewFleetDialog` from `./new-fleet-dialog`.
- Produces: `ChannelsKanban({ board }: { board: KanbanBoard })`.

- [ ] **Step 1: Write the component**

```tsx
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
```

Note: `variant="default"` is the amber primary, the one amber action on this screen. Confirm the `Button` variants and sizes against `src/components/ui/button.tsx`. dnd-kit's `DragOverlay` gives the lift-and-settle drop animation; its default drop transition is close to the mockup. If it feels off, pass a `dropAnimation` with a snappy easing, and disable it under `prefers-reduced-motion`.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/channels/kanban-board.tsx
git commit -m "feat(channels): kanban board with staged moves and save bar"
```

---

### Task 10: Wire the /channels page to the board; remove the table, rail, and edit-fleets dialog

**Files:**
- Modify: `src/app/(shell)/channels/page.tsx`
- Delete: `src/components/channels/channel-table.tsx`, `src/components/channels/fleet-rail.tsx`, `src/components/channels/edit-channel-fleets-dialog.tsx`

**Interfaces:**
- Consumes: `getKanbanBoard` (Task 4), `ChannelsKanban` (Task 9).

- [ ] **Step 1: Replace the page body**

```tsx
// src/app/(shell)/channels/page.tsx
import { ChannelsKanban } from "@/components/channels/kanban-board";
import { getKanbanBoard } from "@/server/queries/channels";

// The board renders its own "Channels" header inside its chrome. The topbar's route
// title stays as-is.
export default async function ChannelsPage() {
  const board = await getKanbanBoard();
  return <ChannelsKanban board={board} />;
}
```

- [ ] **Step 2: Delete the superseded components**

```bash
git rm src/components/channels/channel-table.tsx src/components/channels/fleet-rail.tsx src/components/channels/edit-channel-fleets-dialog.tsx
```

- [ ] **Step 3: Find and fix any remaining imports**

Run: `grep -rn "channel-table\|fleet-rail\|edit-channel-fleets\|EditChannelFleetsDialog\|ChannelTable\|FleetRail\|setChannelFleetsAction" src --include="*.ts*"`
Expected: no matches outside deleted files. Fix any straggler (for example a test importing `channel-table`). The old page passed `sampleSizeById` for the table's thin-sample note; the card computes its own sync line, so that prop is gone.

- [ ] **Step 4: Typecheck, test, and build**

Run: `npx tsc --noEmit`
Run: `npx vitest run`
Run: `npx next build`
Expected: all pass. The build is the gate that catches a broken page export.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(channels): render the Kanban board, remove the table and fleet rail"
```

---

### Task 11: Browser pass, then remove the throwaway mockup

**Files:**
- Delete: `public/kanban-mockup.html`

- [ ] **Step 1: Bring the stack up and load the real page**

Ensure the dev server is running (see the `crowsnest-up` skill). Open `http://localhost:3000/channels`.

- [ ] **Step 2: Manually verify against the spec**

Confirm each: a pinned Unassigned column then the fleets in order; cards show avatar, handle, followers, outliers 30d, sync line, no median; dragging a card between columns updates the column counts and the "N unsaved moves" bar; Save persists (reload keeps the move) and clears the count; Discard reverts; a card dropped into an empty fleet lands and the hatch well disappears; the fleet menu renames, deletes (its cards fall to Unassigned), and moves the column left or right; the own channel shows "My channel". Fix anything that does not match before proceeding.

- [ ] **Step 3: Remove the mockup**

```bash
git rm public/kanban-mockup.html
git commit -m "chore(channels): remove the throwaway Kanban mockup"
```

- [ ] **Step 4: Final gates and open the PR**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Then request a whole-branch review before opening the PR from `feat/channels-kanban` to `main`.

---

## Self-review notes

- Spec coverage: one-fleet-per-channel move semantics (Tasks 2, 3, 9), pinned Unassigned plus per-fleet columns (Tasks 8, 9), card fields without median (Task 6), staged moves behind Save with immediate fleet CRUD (Tasks 3, 9), keep the join with single membership enforced (Tasks 1, 3), fleets.sort_order plus collapse migration (Task 1), rename/delete/reorder/move actions and the dropped setter and dialog (Tasks 3, 10), @dnd-kit and the mockup's feel (Tasks 5, 9), delete the mockup (Task 11). All present.
- Type consistency: `FleetId = string | null`, `Overlay`, `Move`, and `commitDiff` flow unchanged from Task 2 through Tasks 3 and 9. `KanbanBoard` and `placement` defined in Task 4 and consumed in Task 9. `UNASSIGNED` defined in Task 8 and used in Task 9.
- Open confirmations for the implementer (verify against current code, adjust names if they differ): `Button` variant and size names (`icon-sm`, `variant="default"` as amber), `useSyncProgress().start([id])` signature, `RemoveChannelDialog` and `NewFleetDialog` prop shapes, and whether the app has a preset width token for columns.
