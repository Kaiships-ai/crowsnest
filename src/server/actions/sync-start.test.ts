import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";

/**
 * The one property that needs a live run to prove: `startSyncAction` answers while the
 * sync is still going.
 *
 * It gets its own file because it needs a different sidecar than the rest of the action
 * specs — one that accepts the request and never replies. That removes every timing
 * tolerance from the assertion: the run physically cannot reach its terminal write until
 * `afterAll` kills the socket, so finding the job row in `running` is proof the action
 * returned early rather than proof that it was quick.
 */
let sidecar: Server;

beforeAll(async () => {
  sidecar = createServer(() => {
    // No response, ever. Deliberate.
  });
  await new Promise<void>((resolve) => sidecar.listen(0, "127.0.0.1", resolve));
  const { port } = sidecar.address() as AddressInfo;

  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  process.env.IG_SERVICE_URL = `http://127.0.0.1:${port}`;
  // Long enough that the run cannot time out mid-test; AbortSignal.timeout's timer is
  // unref'd, so it does not hold the process open afterwards.
  process.env.IG_REQUEST_TIMEOUT_MS = "20000";

  // Warmed here for the same reason as in sync-actions.test.ts: the import chain costs
  // about a second, and charging it to the first test put that test within reach of
  // vitest's 5s ceiling whenever the suite ran workers in parallel.
  await import("./sync-actions");
});

afterAll(() => {
  // Frees the detached run: the socket dies, the fetch rejects, and the engine writes
  // its terminal row. Without this the worker would sit on an open connection.
  sidecar.closeAllConnections();
  sidecar.close();
});

test("startSyncAction returns a real job id while the run is still in flight", async () => {
  const { db, newId, nowIso, tables } = await import("../db");
  const { eq } = await import("drizzle-orm");
  const { migrate } = await import("../db/test-migrate");
  const { startSyncAction, getSyncProgressAction } = await import("./sync-actions");
  migrate();

  await db.insert(tables.channels).values({
    id: newId(),
    platform: "instagram",
    handle: "@hangs",
    trackedSince: nowIso(),
  });

  const result = await startSyncAction();
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const [row] = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
  expect(row).toBeDefined();
  expect(row.status).toBe("running");
  expect(row.finishedAt).toBeNull();
  expect(row.lockKey).toBe("__library__");

  // And the run is readable by anyone who asks, including a caller holding no id — the
  // reload / other-tab case.
  const progress = await getSyncProgressAction();
  expect(progress.ok).toBe(true);
  if (progress.ok) {
    expect(progress.progress?.jobId).toBe(result.jobId);
    expect(progress.progress?.status).toBe("running");
  }
});

test("a second start against the in-flight run loses the lock cleanly", async () => {
  const { startSyncAction } = await import("./sync-actions");

  const second = await startSyncAction();

  expect(second.ok).toBe(false);
  if (!second.ok) {
    // The code is what lets the UI say "a sync is already running" and attach to it,
    // rather than rendering a generic failure over a run that is working fine.
    expect(second.code).toBe("SYNC_ALREADY_RUNNING");
  }
});

test("cancelling the in-flight run flags it without killing it", async () => {
  const { db, tables } = await import("../db");
  const { and, eq } = await import("drizzle-orm");
  const { cancelSyncAction } = await import("./sync-actions");

  const [running] = await db
    .select()
    .from(tables.syncJobs)
    .where(and(eq(tables.syncJobs.status, "running"), eq(tables.syncJobs.lockKey, "__library__")));
  expect(running).toBeDefined();

  const result = await cancelSyncAction(running.id);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.requested).toBe(true);

  const [after] = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, running.id));
  expect(after.cancelRequested).toBe(true);
});
