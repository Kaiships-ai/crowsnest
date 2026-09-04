import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Real in-memory DB for the tracked-channel check; addChannelAction/startSyncAction are
// mocked so this never reaches the sidecar.
beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  process.env.IG_SERVICE_URL = "http://127.0.0.1:1";
});

const addChannelAction = vi.fn();
const startSyncAction = vi.fn();

vi.mock("./sync-actions", () => ({
  addChannelAction: (...args: unknown[]) => addChannelAction(...args),
  startSyncAction: (...args: unknown[]) => startSyncAction(...args),
}));

async function seedTrackedChannel(handle: string) {
  const { db, newId, nowIso, tables } = await import("../db");
  const id = newId();
  await db.insert(tables.channels).values({
    id,
    platform: "instagram",
    handle,
    trackedSince: nowIso(),
  } as typeof tables.channels.$inferInsert);
  return id;
}

async function clearChannels() {
  const { db, tables } = await import("../db");
  await db.delete(tables.channels);
}

beforeEach(async () => {
  const { migrate } = await import("../db/test-migrate");
  migrate();
  await clearChannels();
  addChannelAction.mockReset();
  startSyncAction.mockReset();
});

describe("followCreatorAction", () => {
  test("new handle adds the channel and starts a channel-scoped sync", async () => {
    const { followCreatorAction } = await import("./discover-actions");
    addChannelAction.mockResolvedValue({ ok: true, channelId: "chan-1" });
    startSyncAction.mockResolvedValue({ ok: true, jobId: "job-1" });

    const result = await followCreatorAction("newcreator");

    expect(addChannelAction).toHaveBeenCalledWith("@newcreator");
    expect(startSyncAction).toHaveBeenCalledWith(["chan-1"]);
    expect(result).toEqual({ ok: true, channelId: "chan-1", syncQueued: true, alreadyTracked: false });
  });

  test("an already-tracked handle is a no-op: no add, no sync start", async () => {
    const id = await seedTrackedChannel("@existing");
    const { followCreatorAction } = await import("./discover-actions");

    const result = await followCreatorAction("existing");

    expect(addChannelAction).not.toHaveBeenCalled();
    expect(startSyncAction).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, channelId: id, syncQueued: false, alreadyTracked: true });
  });

  test("a new handle whose sync loses the lock still reports ok, with syncQueued false", async () => {
    const { followCreatorAction } = await import("./discover-actions");
    addChannelAction.mockResolvedValue({ ok: true, channelId: "chan-2" });
    startSyncAction.mockResolvedValue({ ok: false, error: "A sync is already running", code: "SYNC_ALREADY_RUNNING" });

    const result = await followCreatorAction("busycreator");

    expect(result).toEqual({ ok: true, channelId: "chan-2", syncQueued: false, alreadyTracked: false });
  });

  test("a junk handle fails before touching add or sync", async () => {
    const { followCreatorAction } = await import("./discover-actions");

    const result = await followCreatorAction("has spaces");

    expect(result.ok).toBe(false);
    expect(addChannelAction).not.toHaveBeenCalled();
    expect(startSyncAction).not.toHaveBeenCalled();
  });
});
