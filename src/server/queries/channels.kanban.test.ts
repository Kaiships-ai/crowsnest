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
