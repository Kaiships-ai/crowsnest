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
