import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const graph = vi.hoisted(() => ({
  createReelContainer: vi.fn<(container: { videoUrl: string; caption?: string; coverUrl?: string }) => Promise<{ containerId: string }>>(async () => ({ containerId: "container_1" })),
  pollReelContainer: vi.fn(async () => ({ status: "FINISHED" as const })),
  publishReel: vi.fn(async () => ({ mediaId: "media_1" })),
}));
const bucket = vi.hoisted(() => ({
  upload: vi.fn(async (localPath: string) => ({ publicUrl: `https://media.example.com/${localPath.split("/").at(-1)}`, objectKey: localPath })),
  delete: vi.fn(async () => {}),
}));
vi.mock("@/server/graph/client", async (original) => ({ ...(await original<object>()), ...graph, isGraphConfigured: () => true }));
vi.mock("@/server/publish/storage-provider", () => ({ getStorageProvider: () => bucket }));

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let gate2: typeof import("./gate2-drafts");
let attachPlanVideo: typeof import("@/server/media/video-file")["attachPlanVideo"];
let createPlannedPostAction: typeof import("@/server/actions/planned-post-actions")["createPlannedPostAction"];
let schedulePublishAction: typeof import("@/server/actions/planned-post-actions")["schedulePublishAction"];
let publishPlannedPost: typeof import("./publish-post")["publishPlannedPost"];

const dir = mkdtempSync(path.join(os.tmpdir(), "gate2-"));
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const inAMonth = () => new Date(Date.now() + 30 * 864e5).toLocaleDateString("sv-SE");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.MEDIA_ROOT = mkdtempSync(path.join(os.tmpdir(), "gate2-media-"));
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  process.env.PUBLISH_DRY_RUN = "0";
  ({ db, tables } = await import("@/server/db"));
  (await import("@/server/db/test-migrate")).migrate();
  gate2 = await import("./gate2-drafts");
  ({ attachPlanVideo } = await import("@/server/media/video-file"));
  ({ createPlannedPostAction, schedulePublishAction } = await import("@/server/actions/planned-post-actions"));
  ({ publishPlannedPost } = await import("./publish-post"));
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

/** A draft reel with an mp4 attached the way the cook hands it over: `<name>.mp4` beside `<name>-cover.png`. */
async function reel(name: string, fields: { caption?: string; keyword?: string; cover?: boolean } = {}): Promise<string> {
  const created = await createPlannedPostAction({ title: name });
  if (!created.ok) throw new Error(created.error);
  writeFileSync(path.join(dir, `${name}.mp4`), Buffer.concat([MP4, Buffer.from(name)]));
  if (fields.cover !== false) writeFileSync(path.join(dir, `${name}-cover.png`), `png ${name}`);
  expect(await attachPlanVideo(created.id, path.join(dir, `${name}.mp4`), { draftOnly: true })).toEqual({ ok: true });
  await db.update(tables.plannedPosts).set({ caption: fields.caption ?? `Comment ${name} for the guide`, keyword: fields.keyword ?? null }).where(eq(tables.plannedPosts.id, created.id));
  return created.id;
}

const planRow = async (id: string) => (await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)))[0];

describe("Gate 2 publish", () => {
  test("nothing publishes without an approved draft: an armed reel with no draft fails as not_approved and never uploads", async () => {
    const id = await reel("unapproved", { keyword: "unapproved" });
    await db.update(tables.plannedPosts).set({ state: "publishing" }).where(eq(tables.plannedPosts.id, id));
    const result = await publishPlannedPost(id, { claimed: true });
    expect(result).toMatchObject({ ok: false, state: "failed", errorClass: "not_approved" });
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });

  test("approve publishes with the cover, and the journal shows who proposed and who approved", async () => {
    const id = await reel("agent-r11", { keyword: "agent-r11" });
    expect((await planRow(id)).coverAssetId).not.toBeNull();
    const drafted = await gate2.draftPublish(id, "now", "claude");
    if (!drafted.ok) throw new Error(drafted.error);
    expect(graph.createReelContainer).not.toHaveBeenCalled();

    expect(await gate2.approveGateDraft(drafted.draftId, "kai")).toEqual({ ok: true });
    expect(graph.createReelContainer).toHaveBeenCalledWith({
      videoUrl: expect.stringMatching(/\.mp4$/),
      caption: "Comment agent-r11 for the guide",
      coverUrl: expect.stringMatching(/\.png$/),
    });
    expect(graph.publishReel).toHaveBeenCalledWith("container_1");
    expect(bucket.delete).toHaveBeenCalledTimes(2);
    expect(await planRow(id)).toMatchObject({ state: "published", publishedMediaId: "media_1" });

    const journal = await db.select().from(tables.agentActions).where(eq(tables.agentActions.draftId, drafted.draftId)).orderBy(tables.agentActions.id);
    expect(journal.map((r) => [r.caller, r.result, r.gate])).toEqual([
      ["claude", "drafted", "gate2"],
      ["kai", "pending", "gate2"],
      ["kai", "ok", "gate2"],
    ]);
    const board = await gate2.getGate2Board();
    expect(board.decided[0]).toMatchObject({ id: drafted.draftId, status: "approved", caller: "claude", decidedBy: "kai" });
    expect(await gate2.approveGateDraft(drafted.draftId, "kai")).toMatchObject({ code: "DRAFT_NOT_PENDING" });
  });

  test("a missing keyword warns but does not block; a missing cover blocks", async () => {
    const noKey = await reel("nokey");
    const checks = (await gate2.getPublishChecks(noKey, "now")) as { checks: { id: string; status: string }[] };
    expect(checks.checks.map((c) => `${c.id}:${c.status}`)).toEqual(["video:ok", "caption:ok", "keyword:warn", "time:ok", "cover:ok"]);
    expect(await gate2.draftPublish(noKey, "now", "kai")).toMatchObject({ ok: true });

    const noCover = await reel("nocover", { keyword: "nocover", cover: false });
    expect(await gate2.draftPublish(noCover, "now", "kai")).toMatchObject({ ok: false, code: "PUBLISH_CHECKS_FAILED" });
  });

  test("a caption changed after the draft makes approve refuse, and the draft waits again with the reason", async () => {
    const id = await reel("stale", { keyword: "stale" });
    const drafted = await gate2.draftPublish(id, `${inAMonth()}T19:30`, "kai");
    if (!drafted.ok) throw new Error(drafted.error);
    await db.update(tables.plannedPosts).set({ caption: "Comment stale, edited" }).where(eq(tables.plannedPosts.id, id));
    expect(await gate2.approveGateDraft(drafted.draftId, "kai")).toMatchObject({ ok: false, code: "DRAFT_STALE" });
    const [draft] = await db.select().from(tables.gateDrafts).where(eq(tables.gateDrafts.id, drafted.draftId));
    expect(draft).toMatchObject({ status: "pending", decidedBy: null, lastError: expect.stringContaining("changed") });
    expect((await planRow(id)).state).toBe("draft");
  });

  test("reject marks the draft and journals it, and nothing is sent", async () => {
    const id = await reel("rejected", { keyword: "rejected" });
    const drafted = await gate2.draftPublish(id, "now", "kai");
    if (!drafted.ok) throw new Error(drafted.error);
    expect(await gate2.rejectGateDraft(drafted.draftId, "kai")).toEqual({ ok: true });
    const journal = await db.select().from(tables.agentActions).where(eq(tables.agentActions.draftId, drafted.draftId));
    expect(journal.map((r) => r.result)).toEqual(["drafted", "pending", "rejected"]);
    expect(graph.createReelContainer).not.toHaveBeenCalled();
  });
});

describe("schedulePublishAction plannedDate (#225)", () => {
  test("a 06:00 post under UTC+7 keeps its local day and time", async () => {
    vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
    const id = await reel("dawn", { keyword: "dawn" });
    const day = inAMonth();
    expect(await schedulePublishAction(id, `${day}T06:00`)).toEqual({ ok: true });
    expect(await planRow(id)).toMatchObject({ plannedDate: day, plannedTime: "06:00", scheduledAt: new Date(`${day}T06:00`).toISOString() });
  });
});
