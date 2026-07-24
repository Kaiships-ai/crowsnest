import { beforeAll, describe, expect, test } from "vitest";

// In-memory DB + migrate, same pattern as db/schema.test.ts.
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
});

describe("sync actions", () => {
  test("action boundary never throws: ok:true with gaps on an empty provider chain, ok:false on invalid input", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { syncAllAction, syncChannelAction } = await import("./sync-actions");
    migrate();

    // No provider keys configured in this test env -> getProviderChain() resolves empty,
    // which the engine turns into gaps, never a throw.
    delete process.env.APIFY_TOKEN;
    delete process.env.HIKERAPI_KEY;
    const chId = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@nokeytest", trackedSince: nowIso() });

    const allResult = await syncAllAction();
    expect(allResult.ok).toBe(true);

    // Forced-throw path: runSync's channelIds validation guard rejects an empty-string id.
    const badResult = await syncChannelAction("");
    expect(badResult.ok).toBe(false);
  });
});
