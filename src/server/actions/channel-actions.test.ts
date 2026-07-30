import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setOwnChannelAction: typeof import("./channel-actions")["setOwnChannelAction"];
let unsetOwnChannelAction: typeof import("./channel-actions")["unsetOwnChannelAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setOwnChannelAction, unsetOwnChannelAction } = await import("./channel-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.channels);
});

async function seedChannel(): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle: `@own-test-${id}`, trackedSince: nowIso() });
  return id;
}

describe("setOwnChannelAction", () => {
  test("marks the given channel as own", async () => {
    const id = await seedChannel();
    const result = await setOwnChannelAction(id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.isOwn).toBe(true);
  });

  test("switching to a second channel unmarks the first — only one channel is ever own", async () => {
    const first = await seedChannel();
    const second = await seedChannel();

    await setOwnChannelAction(first);
    await setOwnChannelAction(second);

    const rows = await db.select().from(tables.channels);
    const own = rows.filter((r) => r.isOwn);
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe(second);
  });

  test("fails cleanly for a channel that doesn't exist, rather than throwing", async () => {
    const result = await setOwnChannelAction("does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "CHANNEL_NOT_FOUND" });
  });
});

describe("unsetOwnChannelAction", () => {
  test("clears the flag without assigning it elsewhere", async () => {
    const id = await seedChannel();
    await setOwnChannelAction(id);

    const result = await unsetOwnChannelAction();
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.isOwn).toBe(false);
  });

  test("is a no-op, not an error, when no channel is marked own", async () => {
    await seedChannel();
    const result = await unsetOwnChannelAction();
    expect(result).toEqual({ ok: true });
  });
});
