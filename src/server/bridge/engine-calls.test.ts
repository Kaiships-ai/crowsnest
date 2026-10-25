import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let ENGINE_CALLS: typeof import("./engine-calls")["ENGINE_CALLS"];
let dispatchEngineCall: typeof import("./engine-calls")["dispatchEngineCall"];

const GRAPH_TOKEN = "sentinel-graph-token-5f1e";

vi.mock("@/server/queries/failure-surface", () => ({
  getFailureStrip: async () => {
    throw new Error(`Graph said no to access_token=${GRAPH_TOKEN}`);
  },
}));

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ ENGINE_CALLS, dispatchEngineCall } = await import("./engine-calls"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.channels);
  await db.delete(tables.secrets);
  const now = new Date().toISOString();
  await db.insert(tables.channels).values({ id: "ch-1", platform: "instagram", handle: "@bridge_fixture", trackedSince: now });
  await db.insert(tables.secrets).values({ name: "IG_GRAPH_TOKEN", value: GRAPH_TOKEN, updatedAt: now });
});

describe("dispatchEngineCall", () => {
  test("runs a query with parsed arguments and returns its rows", async () => {
    const res = await dispatchEngineCall("getChannelsList", []);
    expect(res.ok && (res.value as { handle: string }[]).map((c) => c.handle)).toEqual(["@bridge_fixture"]);
  });

  test("treats missing arguments as an empty tuple", async () => {
    const res = await dispatchEngineCall("getChannelsList", undefined);
    expect(res.ok).toBe(true);
  });

  test.each(["noSuchCall", "__proto__", "toString", "constructor", 42, null])("refuses the unknown name %s", async (name) => {
    const res = await dispatchEngineCall(name, []);
    expect(res).toMatchObject({ ok: false, error: { code: "unknown_call" } });
  });

  test.each([
    ["a wrong type", "getChannelDetail", [42]],
    ["an extra argument", "getChannelDetail", ["ch-1", "extra"]],
    ["a missing argument", "getChannelDetail", []],
    ["not a tuple", "getChannelDetail", { id: "ch-1" }],
    ["an unmanaged secret name", "setSecretAction", ["PATH", "x"]],
  ])("refuses %s before the engine runs", async (_label, name, args) => {
    const res = await dispatchEngineCall(name, args);
    expect(res).toMatchObject({ ok: false, error: { code: "bad_args" } });
  });

  test("a bad secret name never writes a row", async () => {
    await dispatchEngineCall("setSecretAction", ["PATH", "x"]);
    expect(await db.select().from(tables.secrets)).toHaveLength(1);
  });

  test("a thrown engine error crosses as failed with secret values scrubbed", async () => {
    const res = await dispatchEngineCall("getFailureStrip", []);
    expect(res).toEqual({ ok: false, error: { code: "failed", message: "Graph said no to access_token=[redacted]" } });
  });

  test("no read returns a stored secret value", async () => {
    const reads = Object.keys(ENGINE_CALLS).filter((n) => /^(get|list)/.test(n) && n !== "getIgStatusAction");
    const leaks: string[] = [];
    for (const name of reads) {
      const res = await dispatchEngineCall(name, []);
      if (JSON.stringify(res).includes(GRAPH_TOKEN)) leaks.push(name);
    }
    expect(leaks).toEqual([]);
    const status = await dispatchEngineCall("getSecretStatusAction", []);
    expect(status.ok && status.value).toContainEqual({ name: "IG_GRAPH_TOKEN", configured: true, source: "db" });
  });
});
