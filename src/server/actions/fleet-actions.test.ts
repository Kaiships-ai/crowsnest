import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

// revalidatePath requires a request-scoped work store that only exists inside a real
// Next.js request; calling it from a plain vitest unit test throws "Invariant: static
// generation store missing". The actions under test call it as a side effect on every
// mutation, so it's mocked out here the same way ig-actions.test.ts / media-actions.test.ts
// mock their own out-of-process dependencies.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let revalidatePath: ReturnType<typeof vi.fn>;
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
  ({ revalidatePath } = (await import("next/cache")) as unknown as { revalidatePath: ReturnType<typeof vi.fn> });
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

// /feed renders one filter chip per fleet from getFleets(), so every one of these
// changes what /feed would render — a rename changes a chip's label, a reorder its
// position, create and delete add or remove one, and a move changes what a chip
// filters to. Revalidating only /channels left the feed serving a cached fleet row.
describe("revalidation", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  test("create revalidates both the board and the feed", async () => {
    await actions.createFleetAction("Chips");
    expect(revalidatePath).toHaveBeenCalledWith("/channels");
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
  });

  test("rename revalidates the feed", async () => {
    const id = await makeFleet("Before");
    revalidatePath.mockClear();
    await actions.renameFleetAction(id, "After");
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
  });

  test("delete revalidates the feed", async () => {
    const id = await makeFleet("Gone");
    revalidatePath.mockClear();
    await actions.deleteFleetAction(id);
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
  });

  test("reorder revalidates the feed", async () => {
    const a = await makeFleet("A");
    const b = await makeFleet("B");
    revalidatePath.mockClear();
    await actions.reorderFleetsAction([b, a]);
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
  });

  test("move revalidates the feed", async () => {
    const ch = await seedChannel();
    const f = await makeFleet("F");
    revalidatePath.mockClear();
    await actions.moveChannelsAction([{ channelId: ch, fleetId: f }]);
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
  });

  test("a no-op move batch revalidates nothing", async () => {
    await actions.moveChannelsAction([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
