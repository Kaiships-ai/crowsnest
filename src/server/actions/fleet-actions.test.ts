import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let newId: typeof import("../db")["newId"];
let nowIso: typeof import("../db")["nowIso"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let createFleetAction: typeof import("./fleet-actions")["createFleetAction"];
let setChannelFleetsAction: typeof import("./fleet-actions")["setChannelFleetsAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  ({ createFleetAction, setChannelFleetsAction } = await import("./fleet-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.channels);
});

async function seedChannel(): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle: `@fleet-test-${id}`, trackedSince: nowIso() });
  return id;
}

describe("createFleetAction", () => {
  test("creates a fleet with the trimmed name and returns its id", async () => {
    const result = await createFleetAction("  Fitness Niche  ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.fleets).where(eq(tables.fleets.id, result.fleetId));
    expect(row.name).toBe("Fitness Niche");
  });

  test("rejects an empty or whitespace-only name without touching the db", async () => {
    const result = await createFleetAction("   ");
    expect(result).toEqual({ ok: false, error: "Fleet name can't be empty." });

    const rows = await db.select().from(tables.fleets);
    expect(rows).toHaveLength(0);
  });
});

describe("setChannelFleetsAction", () => {
  test("assigns a channel to the given fleets", async () => {
    const channelId = await seedChannel();
    const fleetA = (await createFleetAction("Fleet A")) as { ok: true; fleetId: string };
    const fleetB = (await createFleetAction("Fleet B")) as { ok: true; fleetId: string };

    const result = await setChannelFleetsAction(channelId, [fleetA.fleetId, fleetB.fleetId]);

    expect(result).toEqual({ ok: true });
    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, channelId));
    expect(rows.map((r) => r.fleetId).sort()).toEqual([fleetA.fleetId, fleetB.fleetId].sort());
  });

  test("replaces (not adds to) the existing membership set on a second call", async () => {
    const channelId = await seedChannel();
    const fleetA = (await createFleetAction("Fleet A")) as { ok: true; fleetId: string };
    const fleetB = (await createFleetAction("Fleet B")) as { ok: true; fleetId: string };
    const fleetC = (await createFleetAction("Fleet C")) as { ok: true; fleetId: string };

    await setChannelFleetsAction(channelId, [fleetA.fleetId, fleetB.fleetId]);
    await setChannelFleetsAction(channelId, [fleetB.fleetId, fleetC.fleetId]);

    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, channelId));
    expect(rows.map((r) => r.fleetId).sort()).toEqual([fleetB.fleetId, fleetC.fleetId].sort());
  });

  test("an empty array clears all fleet membership for the channel", async () => {
    const channelId = await seedChannel();
    const fleetA = (await createFleetAction("Fleet A")) as { ok: true; fleetId: string };
    await setChannelFleetsAction(channelId, [fleetA.fleetId]);

    const result = await setChannelFleetsAction(channelId, []);

    expect(result).toEqual({ ok: true });
    const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, channelId));
    expect(rows).toHaveLength(0);
  });
});
