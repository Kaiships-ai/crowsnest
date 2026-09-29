import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({ fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(), fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn() }));
vi.mock("@/server/graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "t", isGraphConfigured: () => false }));
process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let runDueOwnMeasure: typeof import("./own-measure-scheduler")["runDueOwnMeasure"];

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ runDueOwnMeasure } = await import("./own-measure-scheduler"));
});
beforeEach(async () => {
  migrate();
  for (const t of [tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.channels]) await db.delete(t);
  vi.clearAllMocks();
});

async function markOwn() {
  await db.insert(tables.channels).values({ id: "c1", platform: "instagram", handle: "@me", externalId: "e1", displayName: "Me", isVerified: false, isPrivate: false, trackedSince: "2026-09-01T00:00:00.000Z", isOwn: true });
}
const ownRows = async () => (await db.select().from(tables.ownAccountSnapshots)).length + (await db.select().from(tables.ownPosts)).length;

describe("runDueOwnMeasure (ACTION-27)", () => {
  test("no own channel: skipped, zero Graph calls", async () => {
    expect(await runDueOwnMeasure(new Date(), { configured: () => true })).toMatchObject({ ran: false, reason: "no_own_channel" });
    expect(graphClient.fetchAccount).not.toHaveBeenCalled();
    expect(await ownRows()).toBe(0);
  });
  test("no token: skipped, zero Graph calls", async () => {
    await markOwn();
    expect(await runDueOwnMeasure(new Date())).toMatchObject({ ran: false, reason: "not_configured" });
    expect(graphClient.fetchAccount).not.toHaveBeenCalled();
  });
  test("rejected token: one call, nothing written", async () => {
    await markOwn();
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_AUTH_FAILED", "bad"));
    expect(await runDueOwnMeasure(new Date(), { configured: () => true })).toMatchObject({ ran: true, reason: "failed" });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    expect(await ownRows()).toBe(0);
  });
});
