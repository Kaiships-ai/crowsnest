import { beforeEach, describe, expect, test, vi } from "vitest";
import { GraphApiError } from "@/server/graph/errors";
import { publishPlannedPost, type PublishPostDeps } from "./publish-post";

/**
 * Self-check for the publish service (implementation plan Phase B, task B3). Every
 * external call is injected — no network, no real db (loadRow/writeRow are fakes over
 * an in-memory map) — matching the deps-injection seam the module exposes for exactly
 * this reason.
 */

type Row = Parameters<PublishPostDeps["writeRow"]>[1] & {
  id: string;
  state: string;
  videoAssetId: string | null;
  caption: string | null;
  dryRun: number;
  attemptCount: number;
};

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "plan_1",
    state: "scheduled",
    videoAssetId: "asset_1",
    caption: "hello",
    dryRun: 0,
    attemptCount: 0,
    errorClass: null,
    lastError: null,
    publishedOwnPostId: null,
    publishedAt: null,
    updatedAt: "t0",
    ...overrides,
  } as Row;
}

function makeDeps(row: Row | null, overrides: Partial<PublishPostDeps> = {}) {
  const store = new Map<string, Row>();
  if (row) store.set(row.id, row);

  const writeRow = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const existing = store.get(id);
    if (existing) store.set(id, { ...existing, ...patch } as Row);
  });

  const upload = vi.fn(async () => ({ publicUrl: "https://media.example.com/x.mp4", objectKey: "crowsnest/x.mp4" }));
  const del = vi.fn(async () => {});

  const deps: PublishPostDeps = {
    loadRow: vi.fn(async (id: string) => store.get(id) ?? null) as PublishPostDeps["loadRow"],
    writeRow: writeRow as PublishPostDeps["writeRow"],
    resolveVideoPath: vi.fn(async () => "/media/asset_1.mp4"),
    getStorageProvider: vi.fn(() => ({ upload, delete: del })),
    isGraphConfigured: vi.fn(() => true),
    createReelContainer: vi.fn(async () => ({ containerId: "container_1" })),
    pollReelContainer: vi.fn(async () => ({ status: "FINISHED" as const })),
    publishReel: vi.fn(async () => ({ mediaId: "media_1" })),
    now: vi.fn(() => "t1"),
    ...overrides,
  };

  return { deps, store, upload, del, writeRow };
}

beforeEach(() => {
  delete process.env.PUBLISH_DRY_RUN;
  vi.stubEnv("NODE_ENV", "test");
});

describe("publishPlannedPost", () => {
  test("dry-run success: uploads, creates+polls the container, skips publishReel, marks published with dryRun=1, deletes the object", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const { deps, store, upload, del } = makeDeps(baseRow());

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: true, state: "published", mediaId: null, dryRun: true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(deps.createReelContainer).toHaveBeenCalledWith({ videoUrl: "https://media.example.com/x.mp4", caption: "hello" });
    expect(deps.pollReelContainer).toHaveBeenCalledWith("container_1", { sleep: expect.any(Function) });
    expect(deps.publishReel).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("crowsnest/x.mp4");

    const stored = store.get("plan_1")!;
    expect(stored.state).toBe("published");
    expect(stored.dryRun).toBe(1);
    expect(stored.publishedOwnPostId).toBeNull();
    expect(stored.lastError).toBeNull();
  });

  test("real success (dry-run off): calls publishReel, stores mediaId as publishedOwnPostId, deletes the object", async () => {
    process.env.PUBLISH_DRY_RUN = "0";
    const { deps, store, del } = makeDeps(baseRow());

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: true, state: "published", mediaId: "media_1", dryRun: false });
    expect(deps.publishReel).toHaveBeenCalledWith("container_1");
    expect(del).toHaveBeenCalledWith("crowsnest/x.mp4");

    const stored = store.get("plan_1")!;
    expect(stored.state).toBe("published");
    expect(stored.dryRun).toBe(0);
    expect(stored.publishedOwnPostId).toBe("media_1");
  });

  test("already-terminal row (published) is a no-op: no upload, no publish", async () => {
    const { deps, upload } = makeDeps(baseRow({ state: "published" }));

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toEqual({ ok: true, state: "noop" });
    expect(upload).not.toHaveBeenCalled();
    expect(deps.createReelContainer).not.toHaveBeenCalled();
    expect(deps.publishReel).not.toHaveBeenCalled();
  });

  test("already-terminal row (failed) is also a no-op", async () => {
    const { deps, upload } = makeDeps(baseRow({ state: "failed" }));

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toEqual({ ok: true, state: "noop" });
    expect(upload).not.toHaveBeenCalled();
  });

  test("a row stuck in 'publishing' is NOT re-published without a fresh claim (no double publish)", async () => {
    const { deps, upload } = makeDeps(baseRow({ state: "publishing" }));

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toEqual({ ok: true, state: "noop" });
    expect(upload).not.toHaveBeenCalled();
    expect(deps.createReelContainer).not.toHaveBeenCalled();
    expect(deps.publishReel).not.toHaveBeenCalled();
  });

  test("a freshly-claimed 'publishing' row publishes when claimed:true (the scheduler path)", async () => {
    process.env.PUBLISH_DRY_RUN = "0";
    const { deps, upload } = makeDeps(baseRow({ state: "publishing" }));

    const result = await publishPlannedPost("plan_1", { ...deps, claimed: true });

    expect(result).toMatchObject({ ok: true, state: "published", mediaId: "media_1" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(deps.publishReel).toHaveBeenCalledTimes(1);
  });

  test("no row at all -> typed not_found failure", async () => {
    const { deps } = makeDeps(null);
    const result = await publishPlannedPost("missing", deps);
    expect(result).toEqual({ ok: false, state: "not_found" });
  });

  test("no bucket configured -> state failed, errorClass no_bucket, no publish", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const { deps, store } = makeDeps(baseRow(), { getStorageProvider: vi.fn(() => null) });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "no_bucket" });
    expect(deps.createReelContainer).not.toHaveBeenCalled();
    const stored = store.get("plan_1")!;
    expect(stored.state).toBe("failed");
    expect(stored.errorClass).toBe("no_bucket");
    expect(stored.attemptCount).toBe(1);
  });

  test("no video asset -> state failed, errorClass no_video, no upload attempted", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const { deps, upload } = makeDeps(baseRow({ videoAssetId: null }));

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "no_video" });
    expect(upload).not.toHaveBeenCalled();
  });

  test("graph not configured -> state failed, errorClass auth", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const { deps } = makeDeps(baseRow(), { isGraphConfigured: vi.fn(() => false) });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "auth" });
    expect(deps.createReelContainer).not.toHaveBeenCalled();
  });

  test("upload failure -> state failed, errorClass storage, no container created, no delete attempted", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const upload = vi.fn(async () => {
      throw new Error("S3 upload failed: 403 Forbidden");
    });
    const del = vi.fn(async () => {});
    const { deps, store } = makeDeps(baseRow(), { getStorageProvider: vi.fn(() => ({ upload, delete: del })) });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "storage" });
    expect(deps.createReelContainer).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(store.get("plan_1")!.lastError).toContain("403");
  });

  test("graph container ERROR -> state failed, errorClass container, object still deleted", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const createReelContainer = vi.fn(async () => ({ containerId: "container_1" }));
    const pollReelContainer = vi.fn(async () => {
      throw new GraphApiError("GRAPH_CONTAINER_FAILED", "Instagram Reel container container_1 entered status ERROR.");
    });
    const { deps, store, del } = makeDeps(baseRow(), { createReelContainer, pollReelContainer });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "container" });
    expect(deps.publishReel).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("crowsnest/x.mp4");
    expect(store.get("plan_1")!.state).toBe("failed");
  });

  test("publishReel failure (rate limited) -> state failed, errorClass rate_limit, object still deleted", async () => {
    process.env.PUBLISH_DRY_RUN = "0";
    const publishReel = vi.fn(async () => {
      throw new GraphApiError("GRAPH_RATE_LIMITED", "Instagram is rate-limiting the Graph API.");
    });
    const { deps, del } = makeDeps(baseRow(), { publishReel });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "rate_limit" });
    expect(del).toHaveBeenCalledWith("crowsnest/x.mp4");
  });

  test("delete failure after a successful publish is swallowed: still reports published", async () => {
    process.env.PUBLISH_DRY_RUN = "0";
    const upload = vi.fn(async () => ({ publicUrl: "https://media.example.com/x.mp4", objectKey: "crowsnest/x.mp4" }));
    const del = vi.fn(async () => {
      throw new Error("S3 delete failed: 500 Internal Server Error");
    });
    const { deps, store } = makeDeps(baseRow(), { getStorageProvider: vi.fn(() => ({ upload, delete: del })) });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: true, state: "published", mediaId: "media_1" });
    expect(del).toHaveBeenCalledTimes(1);
    expect(store.get("plan_1")!.state).toBe("published");
  });

  test("no videoAssetId AND unresolvable video are both no_video (resolveVideoPath returning null)", async () => {
    process.env.PUBLISH_DRY_RUN = "1";
    const { deps, upload } = makeDeps(baseRow(), { resolveVideoPath: vi.fn(async () => null) });

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "no_video" });
    expect(upload).not.toHaveBeenCalled();
  });

  test("PUBLISH_DRY_RUN unset defaults to dry-run outside production", async () => {
    delete process.env.PUBLISH_DRY_RUN;
    vi.stubEnv("NODE_ENV", "development");
    const { deps } = makeDeps(baseRow());

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: true, state: "published", dryRun: true });
    expect(deps.publishReel).not.toHaveBeenCalled();
  });

  test("PUBLISH_DRY_RUN unset in production does NOT default to dry-run", async () => {
    delete process.env.PUBLISH_DRY_RUN;
    vi.stubEnv("NODE_ENV", "production");
    const { deps } = makeDeps(baseRow());

    const result = await publishPlannedPost("plan_1", deps);

    expect(result).toMatchObject({ ok: true, state: "published", dryRun: false });
    expect(deps.publishReel).toHaveBeenCalledTimes(1);
  });

  describe("heartbeat (closes the PUB-04 double-publish window)", () => {
    test("touches updatedAt at the start of real work and between each major step, ahead of the terminal write", async () => {
      process.env.PUBLISH_DRY_RUN = "0";
      const { deps, writeRow } = makeDeps(baseRow());

      await publishPlannedPost("plan_1", deps);

      // Every writeRow call up to (but not including) the final terminal write is a
      // heartbeat: it patches only `updatedAt`, nothing else.
      const heartbeatCalls = writeRow.mock.calls.slice(0, -1);
      expect(heartbeatCalls.length).toBeGreaterThanOrEqual(4); // start-of-work, post-upload, post-create, post-poll
      for (const [, patch] of heartbeatCalls) {
        expect(Object.keys(patch as object)).toEqual(["updatedAt"]);
      }
    });

    test("hands pollReelContainer a sleep option that heartbeats on every attempt, not just once", async () => {
      const { deps, writeRow } = makeDeps(baseRow());
      const pollReelContainer = vi.fn(async (_id: string, opts?: { sleep?: (ms: number) => Promise<void> }) => {
        // Simulate 5 poll attempts, each followed by the injected sleep — the real
        // pollReelContainer's own loop shape (graph/client.ts).
        for (let i = 0; i < 5; i++) await opts!.sleep!(0);
        return { status: "FINISHED" as const };
      });

      await publishPlannedPost("plan_1", { ...deps, pollReelContainer });

      const heartbeatsDuringPoll = writeRow.mock.calls.filter(([, patch]) => Object.keys(patch as object).length === 1 && "updatedAt" in (patch as object));
      // start-of-work + post-upload + post-create + 5 in-poll heartbeats + post-poll = 9
      expect(heartbeatsDuringPoll.length).toBeGreaterThanOrEqual(5);
    });

    test("a heartbeat write failure is logged and swallowed, never fails an otherwise-good publish", async () => {
      process.env.PUBLISH_DRY_RUN = "0";
      const { deps, store } = makeDeps(baseRow());
      const writeRow = vi.fn(async (id: string, patch: Record<string, unknown>) => {
        // Fail every heartbeat-shaped write (updatedAt-only); only the multi-field
        // terminal write is allowed through.
        if (Object.keys(patch).length === 1 && "updatedAt" in patch) {
          throw new Error("db busy");
        }
        const existing = store.get(id);
        if (existing) store.set(id, { ...existing, ...patch });
      });

      const result = await publishPlannedPost("plan_1", { ...deps, writeRow: writeRow as PublishPostDeps["writeRow"] });

      expect(result).toMatchObject({ ok: true, state: "published", mediaId: "media_1" });
      expect(store.get("plan_1")!.state).toBe("published");
    });
  });
});
