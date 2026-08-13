import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getCreateRun: typeof import("./create-runs")["getCreateRun"];
let getLatestCreateRunForPost: typeof import("./create-runs")["getLatestCreateRunForPost"];
let updateCreateRun: typeof import("./create-runs")["updateCreateRun"];
let reconcileOrphanCreateRuns: typeof import("./create-runs")["reconcileOrphanCreateRuns"];
let startCreateRunAction: typeof import("../actions/create-run-actions")["startCreateRunAction"];
let stopCreateRunAction: typeof import("../actions/create-run-actions")["stopCreateRunAction"];

beforeAll(async () => {
  // Must be set before @/server/db (and anything importing it) is ever loaded — that
  // module reads CROWSNEST_DB_PATH at import time and defaults to the real
  // "data/crowsnest.db" when unset. Same pattern as src/server/queries/runs.test.ts.
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";

  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getCreateRun, getLatestCreateRunForPost, updateCreateRun, reconcileOrphanCreateRuns } = await import("./create-runs"));
  ({ startCreateRunAction, stopCreateRunAction } = await import("../actions/create-run-actions"));
});

beforeEach(() => {
  migrate();
  db.delete(tables.createRuns).run();
});

/** A pid guaranteed not to belong to a live process, for orphan-reconcile tests. PIDs
 *  are 16-bit on darwin/linux in practice; this is comfortably past any real one. */
const DEAD_PID = 999_999;

function seedPost(): string {
  // create_runs.postId is not a foreign key (see schema.ts), so a bare id is enough —
  // no posts table row is required to exercise this query layer.
  return newId();
}

describe("startCreateRunAction", () => {
  test("inserts a running row and returns its id", async () => {
    const postId = seedPost();
    const result = await startCreateRunAction({ postId, slug: "my-post" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = getCreateRun(result.runId);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({ postId, slug: "my-post", status: "running", finishedAt: null });
    expect(row!.startedAt).toBeTruthy();
  });
});

describe("updateCreateRun", () => {
  test("moves status and stamps fields", async () => {
    const postId = seedPost();
    const { runId } = (await startCreateRunAction({ postId, slug: "s" })) as { ok: true; runId: string };

    updateCreateRun(runId, { status: "success", finishedAt: "2026-08-14T00:00:00.000Z", renderAssetId: "asset_1" });

    const row = getCreateRun(runId);
    expect(row).toMatchObject({ status: "success", finishedAt: "2026-08-14T00:00:00.000Z", renderAssetId: "asset_1" });
  });
});

describe("getCreateRun / getLatestCreateRunForPost", () => {
  test("getCreateRun returns null for an unknown id", () => {
    expect(getCreateRun("nope")).toBeNull();
  });

  test("getLatestCreateRunForPost reads back the newest row for a post by startedAt", () => {
    const postId = seedPost();
    const olderId = newId();
    const newerId = newId();
    db.insert(tables.createRuns)
      .values({ id: olderId, postId, slug: "s", status: "success", startedAt: "2026-08-14T09:00:00.000Z" })
      .run();
    db.insert(tables.createRuns)
      .values({ id: newerId, postId, slug: "s", status: "running", startedAt: "2026-08-14T10:00:00.000Z" })
      .run();

    const latest = getLatestCreateRunForPost(postId);
    expect(latest?.id).toBe(newerId);
  });

  test("getLatestCreateRunForPost is null for a post with no runs", () => {
    expect(getLatestCreateRunForPost(seedPost())).toBeNull();
  });
});

describe("stopCreateRunAction", () => {
  test("marks the run canceled with a finishedAt stamp", async () => {
    const postId = seedPost();
    const { runId } = (await startCreateRunAction({ postId, slug: "s" })) as { ok: true; runId: string };

    const result = await stopCreateRunAction(runId);
    expect(result).toMatchObject({ ok: true, stopped: true });

    const row = getCreateRun(runId);
    expect(row?.status).toBe("canceled");
    expect(row?.finishedAt).toBeTruthy();
  });

  test("errors for an unknown run id", async () => {
    const result = await stopCreateRunAction("nope");
    expect(result.ok).toBe(false);
  });
});

describe("reconcileOrphanCreateRuns", () => {
  test("marks a stale running row (pid of a dead process) failed", () => {
    const postId = seedPost();
    const id = newId();
    db.insert(tables.createRuns)
      .values({ id, postId, slug: "s", status: "running", startedAt: "2026-08-14T09:00:00.000Z", pid: DEAD_PID })
      .run();

    const changed = reconcileOrphanCreateRuns();
    expect(changed).toBe(1);

    const row = getCreateRun(id);
    expect(row).toMatchObject({ status: "failed", errorMessage: "stopped, server restarted" });
    expect(row?.finishedAt).toBeTruthy();
  });

  test("marks a stale waiting row with a null pid failed", () => {
    const postId = seedPost();
    const id = newId();
    db.insert(tables.createRuns)
      .values({ id, postId, slug: "s", status: "waiting", startedAt: "2026-08-14T09:00:00.000Z", pid: null })
      .run();

    const changed = reconcileOrphanCreateRuns();
    expect(changed).toBe(1);
    expect(getCreateRun(id)?.status).toBe("failed");
  });

  test("leaves a running row alone when its pid is this test process (definitely alive)", () => {
    const postId = seedPost();
    const id = newId();
    db.insert(tables.createRuns)
      .values({ id, postId, slug: "s", status: "running", startedAt: "2026-08-14T09:00:00.000Z", pid: process.pid })
      .run();

    const changed = reconcileOrphanCreateRuns();
    expect(changed).toBe(0);
    expect(getCreateRun(id)?.status).toBe("running");
  });

  test("does not touch terminal-status rows", () => {
    const postId = seedPost();
    const id = newId();
    db.insert(tables.createRuns)
      .values({ id, postId, slug: "s", status: "success", startedAt: "2026-08-14T09:00:00.000Z", pid: DEAD_PID })
      .run();

    expect(reconcileOrphanCreateRuns()).toBe(0);
    expect(getCreateRun(id)?.status).toBe("success");
  });
});
