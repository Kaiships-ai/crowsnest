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
    state: "publishing",
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
    expect(deps.pollReelContainer).toHaveBeenCalledWith("container_1");
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
});
