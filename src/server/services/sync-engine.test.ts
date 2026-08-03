import { beforeAll, describe, expect, test } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { IgClient, IgMedia, IgProfile } from "../ig/client";
import type { EnsureAssetDeps } from "../ig/assets";

// In-memory DB + migrate, same pattern as db/schema.test.ts.
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // config.ts refuses to boot without this; the sidecar is never actually contacted in
  // these tests because every one of them injects a stub client.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
});

const noopSleep = async () => {};
/** The two enrichment deps a given test isn't the test FOR. `enrichViewCounts` consults
 *  both once per reel — `shouldStop` so a cancelled run stops spending live requests,
 *  `tick` so the pass keeps the job row's heartbeat alive — and the tests that care about
 *  either one pass their own counting version instead of these. */
const neverStop = async () => false;
const noopTick = async () => {};
const DAY_MS = 86_400_000;

function isoDaysAgo(days: number, from = Date.now()): string {
  return new Date(from - days * DAY_MS).toISOString();
}

function makeProfile(handle: string, over: Partial<IgProfile> = {}): IgProfile {
  return {
    handle,
    externalId: `ext-${handle}`,
    displayName: `Display ${handle}`,
    followerCount: 100_000,
    followingCount: 100,
    mediaCount: 500,
    bio: "bio",
    isVerified: false,
    isPrivate: false,
    avatarUrl: `https://cdn.example/${handle}/avatar.jpg`,
    raw: { username: handle },
    ...over,
  };
}

function makeMedia(id: string, daysAgo: number, over: Partial<IgMedia> = {}): IgMedia {
  return {
    externalId: id,
    shortcode: `sc-${id}`,
    mediaType: "video",
    productType: "clips",
    url: `https://www.instagram.com/reel/sc-${id}/`,
    caption: `caption ${id}`,
    takenAt: isoDaysAgo(daysAgo),
    durationSec: 30,
    viewCount: 10_000,
    likeCount: 100,
    commentCount: 10,
    thumbnailUrl: `https://cdn.example/${id}/thumb.jpg`,
    videoUrl: `https://cdn.example/${id}/video.mp4`,
    children: [],
    raw: { pk: id },
    ...over,
  };
}

type Page = { items: IgMedia[]; nextCursor: string | null; stopReason: "lookback" | "cap" | "exhausted" | null };

/**
 * Stub sidecar. `pages` is served in order, so the engine's cursor walk is exercised for
 * real — it must keep following nextCursor until a page says stop.
 */
/** Default `fetchMediaStats` count for a stub client that doesn't care about the exact
 *  number, only that it is a real, non-null, uniform figure to enrich every candidate
 *  with. Only read by tests that drive enrichment through a real `runSync()` rather than
 *  calling `__test.enrichViewCounts` directly. */
const STUB_STATS_DEFAULT_VIEW_COUNT = 500_000;

function stubClient(opts: {
  profile?: IgProfile;
  pages?: Page[];
  onProfileError?: Error;
  failDownloadsMatching?: RegExp;
  /** Keyed by external id. A pk absent from this map falls back to
   *  `STUB_STATS_DEFAULT_VIEW_COUNT`, so a test that doesn't care which reel got which
   *  count can omit this entirely. */
  stats?: Record<string, number | null>;
}): { client: IgClient; downloadCalls: string[] } {
  const downloadCalls: string[] = [];
  let pageIndex = 0;

  const client = {
    async health() {
      return { status: "ok", loggedIn: true, username: "stub", instagrapiVersion: "2.18.9", sessionLoaded: true };
    },
    async login() {
      return { status: "ok" as const };
    },
    async resolveChallenge() {
      return { status: "ok" as const };
    },
    async submitTwoFactor() {
      return { status: "ok" as const };
    },
    async logout() {
      return { status: "ok" };
    },
    async profile(handle: string) {
      if (opts.onProfileError) throw opts.onProfileError;
      return opts.profile ?? makeProfile(handle);
    },
    async medias() {
      const page = opts.pages?.[pageIndex] ?? { items: [], nextCursor: null, stopReason: "exhausted" as const };
      pageIndex += 1;
      return page;
    },
    async resolveMedia(pk: string) {
      return makeMedia(pk, 1);
    },
    async fetchMediaStats(pk: string) {
      const viewCount = opts.stats?.[pk] ?? STUB_STATS_DEFAULT_VIEW_COUNT;
      return { externalId: pk, mediaType: "video" as const, productType: "clips", viewCount, likeCount: 1, commentCount: 1 };
    },
    async download(input: { url: string; kind: "thumbnail" | "video" | "avatar" }) {
      downloadCalls.push(input.url);
      if (opts.failDownloadsMatching?.test(input.url)) throw new Error(`download failed for ${input.url}`);
      // sha256 derived from the URL, so identical URLs dedupe and distinct ones don't.
      const sha = Buffer.from(input.url).toString("hex").padEnd(64, "0").slice(0, 64);
      return {
        path: `${sha.slice(0, 2)}/${sha}.jpg`,
        bytes: 2048,
        contentType: input.kind === "video" ? "video/mp4" : "image/jpeg",
        sha256: sha,
        width: 1080,
        height: 1920,
        durationSec: null,
      };
    },
  } as unknown as IgClient;

  return { client, downloadCalls };
}

async function setupChannel(handle = "@creator"): Promise<{ channelId: string }> {
  const { db, newId, nowIso, tables } = await import("../db");
  const id = newId();
  await db.insert(tables.channels).values({
    id,
    platform: "instagram",
    handle,
    isVerified: false,
    isPrivate: false,
    trackedSince: nowIso(),
  });
  return { channelId: id };
}

/** A reel row shaped like one the sync would have written from a listing page: no view
 *  count, because the listing endpoint withholds play counts for media the burner does
 *  not own. */
async function seedReel(
  channelId: string,
  externalId: string,
  over: { daysAgo?: number; viewCount?: number | null; productType?: string | null; deletedAt?: string | null } = {}
): Promise<void> {
  const { db, newId, nowIso, tables } = await import("../db");
  await db.insert(tables.videos).values({
    id: newId(),
    channelId,
    platform: "instagram",
    externalId,
    url: `https://www.instagram.com/reel/${externalId}/`,
    mediaType: "video",
    productType: over.productType === undefined ? "clips" : over.productType,
    postedAt: isoDaysAgo(over.daysAgo ?? 1),
    viewCount: over.viewCount ?? null,
    deletedAt: over.deletedAt ?? null,
    firstSeenAt: nowIso(),
  });
}

/**
 * The running job row, read straight from the table the UI polls.
 *
 * Local to these tests on purpose. The engine used to export a `getRunningJob` for this,
 * which read like product API while having no product caller — the same shape as the dead
 * `getRunningSyncAction` it outlived. Observing the row is a test concern, so the helper
 * lives with the tests.
 */
async function runningJob(channelId: string | null = null) {
  const { db, tables } = await import("../db");
  const rows = await db
    .select()
    .from(tables.syncJobs)
    .where(
      channelId === null
        ? and(eq(tables.syncJobs.status, "running"), isNull(tables.syncJobs.channelId))
        : and(eq(tables.syncJobs.status, "running"), eq(tables.syncJobs.channelId, channelId))
    )
    .limit(1);
  return rows[0] ?? null;
}

describe("runSync — lookback window", () => {
  test("stores only posts inside the window and reports why it stopped", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@lookback");

    const inWindow = [makeMedia("a", 1), makeMedia("b", 10), makeMedia("c", 29)];
    const { client } = stubClient({ pages: [{ items: inWindow, nextCursor: null, stopReason: "lookback" }] });

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep, lookbackDays: 30 });

    expect(result.itemsSeen).toBe(3);
    expect(result.itemsCreated).toBe(3);
    expect(result.stopReason).toBe("lookback");

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(3);
    const oldest = rows.map((r) => r.postedAt).sort()[0];
    expect(new Date(oldest).getTime()).toBeGreaterThan(Date.now() - 30 * DAY_MS);
  });

  test("honours the per-run item cap", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@capped");

    const many = Array.from({ length: 10 }, (_, i) => makeMedia(`cap-${i}`, i));
    const { client } = stubClient({ pages: [{ items: many, nextCursor: "more", stopReason: null }] });

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep, maxItems: 4 });

    expect(result.itemsSeen).toBe(4);
    expect(result.stopReason).toBe("cap");
  });

  test("follows the cursor across pages until exhausted", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@paged");

    const { client } = stubClient({
      pages: [
        { items: [makeMedia("p1", 1), makeMedia("p2", 2)], nextCursor: "cursor-2", stopReason: null },
        { items: [makeMedia("p3", 3)], nextCursor: null, stopReason: null },
      ],
    });

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(result.itemsSeen).toBe(3);
    expect(result.stopReason).toBe("exhausted");
  });
});

describe("runSync — idempotence", () => {
  test("a second consecutive sync creates nothing and duplicates nothing", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@idem");

    const items = [makeMedia("i1", 1), makeMedia("i2", 2), makeMedia("i3", 3)];
    const pages = (): Page[] => [{ items, nextCursor: null, stopReason: "exhausted" }];

    const first = await runSync({ channelIds: [channelId], client: stubClient({ pages: pages() }).client, sleep: noopSleep });
    expect(first.itemsCreated).toBe(3);

    const second = await runSync({ channelIds: [channelId], client: stubClient({ pages: pages() }).client, sleep: noopSleep });

    // This is the goal's proof #9, asserted in code.
    expect(second.itemsCreated).toBe(0);
    expect(second.itemsUpdated).toBe(3);

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(3);
  });

  test("identical asset bytes dedupe to a single media_assets row", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@dedupe");

    const shared = "https://cdn.example/shared/thumb.jpg";
    const items = [makeMedia("d1", 1, { thumbnailUrl: shared }), makeMedia("d2", 2, { thumbnailUrl: shared })];
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "exhausted" }] });

    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    // Scoped to this channel on purpose: the in-memory DB is shared across tests in
    // this file, so a global asset count would fold in other tests' rows.
    const videos = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(videos).toHaveLength(2);
    expect(videos[0].thumbnailAssetId).toBe(videos[1].thumbnailAssetId);
    expect(videos[0].thumbnailAssetId).not.toBeNull();

    const distinct = new Set(videos.map((v) => v.thumbnailAssetId));
    expect(distinct.size).toBe(1);

    const asset = await db.select().from(tables.mediaAssets).where(eq(tables.mediaAssets.id, videos[0].thumbnailAssetId!));
    expect(asset).toHaveLength(1);
  });
});

describe("runSync — carousels", () => {
  test("a carousel becomes one video row plus ordered children, not N rows", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@carousel");

    const carousel = makeMedia("car-1", 2, {
      mediaType: "carousel",
      children: [
        { position: 0, externalId: "c0", mediaType: "photo", thumbnailUrl: "https://cdn.example/c0.jpg", videoUrl: null, raw: {} },
        { position: 1, externalId: "c1", mediaType: "video", thumbnailUrl: "https://cdn.example/c1.jpg", videoUrl: "https://cdn.example/c1.mp4", raw: {} },
        { position: 2, externalId: "c2", mediaType: "photo", thumbnailUrl: "https://cdn.example/c2.jpg", videoUrl: null, raw: {} },
      ],
    });

    const { client } = stubClient({ pages: [{ items: [carousel], nextCursor: null, stopReason: "exhausted" }] });
    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    const videos = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(videos).toHaveLength(1);
    expect(videos[0].mediaType).toBe("carousel");

    const children = await db.select().from(tables.videoChildren).where(eq(tables.videoChildren.videoId, videos[0].id));
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.position).sort()).toEqual([0, 1, 2]);
    expect(children.every((c) => c.thumbnailAssetId !== null)).toBe(true);
  });

  test("re-syncing a carousel updates children in place instead of duplicating them", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@carousel2");

    const build = () =>
      makeMedia("car-2", 2, {
        mediaType: "carousel",
        children: [
          { position: 0, externalId: "k0", mediaType: "photo", thumbnailUrl: "https://cdn.example/k0.jpg", videoUrl: null, raw: {} },
          { position: 1, externalId: "k1", mediaType: "photo", thumbnailUrl: "https://cdn.example/k1.jpg", videoUrl: null, raw: {} },
        ],
      });

    const once = (): Page[] => [{ items: [build()], nextCursor: null, stopReason: "exhausted" }];
    await runSync({ channelIds: [channelId], client: stubClient({ pages: once() }).client, sleep: noopSleep });
    await runSync({ channelIds: [channelId], client: stubClient({ pages: once() }).client, sleep: noopSleep });

    const videos = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    const children = await db.select().from(tables.videoChildren).where(eq(tables.videoChildren.videoId, videos[0].id));
    expect(children).toHaveLength(2);
  });
});

describe("runSync — soft delete", () => {
  test("marks in-window posts that vanished, and leaves out-of-window posts alone", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@deletions");

    // A post predating the window: it must NOT be soft-deleted merely because this run
    // never asked about it.
    const oldId = newId();
    await db.insert(tables.videos).values({
      id: oldId,
      channelId,
      platform: "instagram",
      externalId: "ancient",
      url: "https://www.instagram.com/reel/ancient/",
      mediaType: "video",
      postedAt: isoDaysAgo(400),
      viewCount: 5_000,
      firstSeenAt: nowIso(),
    });

    const first: Page[] = [{ items: [makeMedia("keep", 2), makeMedia("gone", 3)], nextCursor: null, stopReason: "lookback" }];
    await runSync({ channelIds: [channelId], client: stubClient({ pages: first }).client, sleep: noopSleep });

    const second: Page[] = [{ items: [makeMedia("keep", 2)], nextCursor: null, stopReason: "lookback" }];
    const result = await runSync({ channelIds: [channelId], client: stubClient({ pages: second }).client, sleep: noopSleep });

    expect(result.itemsDeleted).toBe(1);

    const gone = await db.select().from(tables.videos).where(eq(tables.videos.externalId, "gone"));
    expect(gone[0].deletedAt).not.toBeNull();

    const ancient = await db.select().from(tables.videos).where(eq(tables.videos.id, oldId));
    expect(ancient[0].deletedAt).toBeNull();

    // Soft-marked, never removed — transcripts and analyses hang off these rows.
    const all = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(all).toHaveLength(3);
  });

  test("does NOT soft-delete when the run stopped at the item cap", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@capped-delete");

    // Establish three in-window posts.
    const all = [makeMedia("cap-a", 1), makeMedia("cap-b", 2), makeMedia("cap-c", 3)];
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: all, nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    // Now run again with a cap of 1. Only "cap-a" comes back — but "cap-b"/"cap-c" are
    // still on Instagram, we just never asked about them. They must NOT be marked
    // deleted; that would be inventing a fact we never observed.
    const result = await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: all, nextCursor: "more", stopReason: null }] }).client,
      sleep: noopSleep,
      maxItems: 1,
    });

    expect(result.stopReason).toBe("cap");
    expect(result.itemsDeleted).toBe(0);

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
  });

  test("does NOT soft-delete when the page came back empty", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@emptyfetch");

    // Seed three in-window posts.
    const items = [makeMedia("e1", 1), makeMedia("e2", 2), makeMedia("e3", 3)];
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items, nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    // Now a run that returns nothing at all. This happened for real: pinned posts
    // stopped the lookback walk before any recent post was reached, and the empty
    // result soft-deleted 8 live posts.
    const result = await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    expect(result.itemsSeen).toBe(0);
    expect(result.itemsDeleted).toBe(0);

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
  });

  test("does NOT soft-delete when the channel errored partway through", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@errored-delete");

    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("err-a", 1)], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    // Profile fetch blows up on the next run: nothing was enumerated at all.
    await runSync({
      channelIds: [channelId],
      client: stubClient({ onProfileError: new Error("network died") }).client,
      sleep: noopSleep,
    });

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });

  test("a post that reappears is undeleted rather than duplicated", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@resurrect");

    // "absent" must still return SOMETHING, otherwise the run sees zero items and
    // correctly refuses to treat an empty fetch as deletions (see the empty-page test).
    const present = (): Page[] => [
      { items: [makeMedia("flaky", 2), makeMedia("stable", 3)], nextCursor: null, stopReason: "lookback" },
    ];
    const absent = (): Page[] => [{ items: [makeMedia("stable", 3)], nextCursor: null, stopReason: "lookback" }];

    await runSync({ channelIds: [channelId], client: stubClient({ pages: present() }).client, sleep: noopSleep });
    await runSync({ channelIds: [channelId], client: stubClient({ pages: absent() }).client, sleep: noopSleep });

    const afterDelete = (await db.select().from(tables.videos).where(eq(tables.videos.externalId, "flaky")))[0];
    expect(afterDelete.deletedAt).not.toBeNull();

    await runSync({ channelIds: [channelId], client: stubClient({ pages: present() }).client, sleep: noopSleep });

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.externalId, "flaky"));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });
});

describe("runSync — failure isolation", () => {
  test("a failed thumbnail download costs the asset, not the post", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@assetfail");

    const items = [makeMedia("ok-1", 1), makeMedia("bad-1", 2, { thumbnailUrl: "https://cdn.example/EXPLODE/thumb.jpg" })];
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "exhausted" }], failDownloadsMatching: /EXPLODE/ });

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(result.itemsSeen).toBe(2);
    expect(result.itemsFailed).toBe(0);
    expect(result.assetsFailed).toBe(1);

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows).toHaveLength(2);
    const bad = rows.find((r) => r.externalId === "bad-1")!;
    // Metadata survived; the asset is simply absent, which the UI renders honestly.
    expect(bad.caption).toBe("caption bad-1");
    expect(bad.thumbnailAssetId).toBeNull();
  });

  test("a channel whose profile fetch fails becomes a gap and records the error code", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@broken");

    const { client } = stubClient({ onProfileError: new IgError("IG_PRIVATE", "account is private") });
    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(result.gaps).toHaveLength(1);
    expect(result.channelsSynced).toBe(0);

    const rows = await db.select().from(tables.channels).where(eq(tables.channels.id, channelId));
    expect(rows[0].syncErrorCode).toBe("IG_PRIVATE");

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    // This asserted 'partial' until the status-honesty fix: the only channel in the run
    // failed, so nothing was partially anything.
    expect(job.status).toBe("failed");
  });

  test("one broken channel does not stop the others", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const good = await setupChannel("@good");
    const bad = await setupChannel("@bad");

    const { client } = stubClient({ pages: [{ items: [makeMedia("g1", 1)], nextCursor: null, stopReason: "exhausted" }] });
    let calls = 0;
    const wrapped = {
      ...client,
      async profile(handle: string) {
        calls += 1;
        if (handle === "@bad") throw new Error("boom");
        return makeProfile(handle);
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [good.channelId, bad.channelId], client: wrapped, sleep: noopSleep });

    expect(calls).toBe(2);
    expect(result.gaps).toHaveLength(1);
    expect(result.channelsSynced).toBe(1);
  });
});

describe("runSync — concurrency lock", () => {
  test("a second sync of the same channel is refused by the database", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@locked");

    // A run already in flight, with a fresh heartbeat so it isn't reaped.
    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId,
      lockKey: channelId,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    const { client } = stubClient({ pages: [{ items: [], nextCursor: null, stopReason: "exhausted" }] });
    await expect(runSync({ channelIds: [channelId], client, sleep: noopSleep })).rejects.toBeInstanceOf(SyncAlreadyRunningError);
  });

  test("a second WHOLE-LIBRARY sync is also refused", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, LIBRARY_LOCK_KEY } = await import("./sync-engine");
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    migrate();

    // The lock was originally keyed on channel_id alone. SQLite treats NULLs as
    // DISTINCT in a unique index, so two library-wide runs (channel_id = NULL) both
    // acquired it — the exact scenario the lock exists to prevent. Hence lock_key.
    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId: null,
      lockKey: LIBRARY_LOCK_KEY,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    const { client } = stubClient({ pages: [{ items: [], nextCursor: null, stopReason: "exhausted" }] });
    await expect(runSync({ client, sleep: noopSleep })).rejects.toBeInstanceOf(SyncAlreadyRunningError);
  });

  test("a running LIBRARY sync refuses a per-channel sync it would overlap", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, LIBRARY_LOCK_KEY } = await import("./sync-engine");
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@overlapped");

    // The in-memory DB is shared across tests in this file, and the preceding lock test
    // deliberately leaves a held library lock behind. Clear running jobs so this test
    // exercises its own scenario rather than that leftover.
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));

    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId: null,
      lockKey: LIBRARY_LOCK_KEY,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    // These are DIFFERENT lock keys ('__library__' vs the channel id), so the unique index
    // happily allowed both — and the library run walks this channel too. Two runs on one
    // channel means each one's softDeleteMissing sees the other's unfetched posts as
    // deleted. This is the user path: "Sync now" in the sidebar, then "Sync now" on a
    // channel page, both buttons non-blocking.
    const { client } = stubClient({ pages: [{ items: [makeMedia("co-1", 1)], nextCursor: null, stopReason: "lookback" }] });
    await expect(runSync({ channelIds: [channelId], client, sleep: noopSleep })).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
  });

  test("a running per-channel sync refuses a library sync that would cover it", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    migrate();
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const { channelId } = await setupChannel("@covered");

    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId,
      lockKey: channelId,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    // The reverse order must lose too, otherwise the exclusion depends on who clicked first.
    const { client } = stubClient({ pages: [{ items: [], nextCursor: null, stopReason: "exhausted" }] });
    await expect(runSync({ client, sleep: noopSleep })).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
  });

  test("two per-channel syncs on DIFFERENT channels still run", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const held = await setupChannel("@held");
    const free = await setupChannel("@free");

    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId: held.channelId,
      lockKey: held.channelId,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    // Disjoint covered sets: legitimate, and the exclusion must not overreach into it.
    const { client } = stubClient({ pages: [{ items: [makeMedia("free-1", 1)], nextCursor: null, stopReason: "lookback" }] });
    const result = await runSync({ channelIds: [free.channelId], client, sleep: noopSleep });
    expect(result.itemsSeen).toBe(1);

    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
  });

  test("a stale running job is reaped so a crashed sync can't lock a channel forever", async () => {
    const { db, newId, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@stale");

    const longAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    const staleId = newId();
    await db.insert(tables.syncJobs).values({
      id: staleId,
      channelId,
      lockKey: channelId,
      startedAt: longAgo,
      heartbeatAt: longAgo,
      status: "running",
      lookbackDays: 30,
    });

    const { client } = stubClient({ pages: [{ items: [makeMedia("s1", 1)], nextCursor: null, stopReason: "exhausted" }] });
    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(result.itemsSeen).toBe(1);
    const reaped = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, staleId)))[0];
    expect(reaped.status).toBe("failed");
    expect(reaped.errorCode).toBe("SYNC_ABANDONED");
  });
});

describe("runSync — job bookkeeping", () => {
  test("writes a sync_jobs row with real counters", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@counters");

    const { client } = stubClient({ pages: [{ items: [makeMedia("c1", 1), makeMedia("c2", 2)], nextCursor: null, stopReason: "lookback" }] });
    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep, lookbackDays: 30 });

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("success");
    expect(job.itemsSeen).toBe(2);
    expect(job.itemsCreated).toBe(2);
    expect(job.lookbackDays).toBe(30);
    expect(job.stopReason).toBe("lookback");
    expect(job.finishedAt).not.toBeNull();
    expect(job.assetsDownloaded).toBeGreaterThan(0);
  });

  test("a withheld metric never erases one we already have", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@metrics");

    // First run: Instagram discloses a real view count.
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("m1", 1, { viewCount: 2_272_877 })], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    // Second run: Instagram withholds it (null). Happens constantly for other
    // creators' reels — it returns 0, which the client maps to null.
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("m1", 1, { viewCount: null, likeCount: null })], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    const row = (await db.select().from(tables.videos).where(eq(tables.videos.externalId, "m1")))[0];
    expect(row.viewCount).toBe(2_272_877);
    expect(row.likeCount).toBe(100);
  });

  test("stores the raw provider payload for drift forensics", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@raw");

    const { client } = stubClient({ pages: [{ items: [makeMedia("r1", 1)], nextCursor: null, stopReason: "exhausted" }] });
    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    const row = (await db.select().from(tables.videos).where(eq(tables.videos.externalId, "r1")))[0];
    expect(row.rawPayload).toEqual({ pk: "r1" });
    expect(row.rawFetchedAt).not.toBeNull();
  });

  test("no Instagram CDN URL is ever persisted", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@nourls");

    const items = [
      makeMedia("u1", 1, {
        thumbnailUrl: "https://scontent-lhr8-1.cdninstagram.com/v/t51/thumb.jpg",
        videoUrl: "https://scontent-lhr8-1.cdninstagram.com/v/t50/video.mp4",
        raw: { pk: "u1" },
      }),
    ];
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "exhausted" }] });
    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(JSON.stringify(rows)).not.toContain("cdninstagram.com");

    const assets = await db.select().from(tables.mediaAssets);
    expect(JSON.stringify(assets)).not.toContain("cdninstagram.com");
  });

  test("soft-deleted posts drop out of the live set used for outlier maths", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@scores");

    const items = Array.from({ length: 5 }, (_, i) => makeMedia(`s${i}`, i + 1, { viewCount: 1_000 }));
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items, nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: items.slice(1), nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    const deleted = (await db.select().from(tables.videos).where(eq(tables.videos.externalId, "s0")))[0];
    expect(deleted.deletedAt).not.toBeNull();

    const live = await db
      .select()
      .from(tables.videos)
      .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)));
    expect(live).toHaveLength(4);
  });
});

describe("runSync — live progress", () => {
  test("the job row carries real counters and phase BETWEEN pages, not only at the end", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@progress");

    const pages: Page[] = [
      { items: [makeMedia("pg1", 1), makeMedia("pg2", 2)], nextCursor: "cursor-2", stopReason: null },
      { items: [makeMedia("pg3", 3)], nextCursor: null, stopReason: null },
    ];
    const { client: base } = stubClient({ pages });

    // Snapshot taken while the run is still in flight: this is exactly what a polling UI
    // would read, and before the engine flushed progress it read zeros.
    let midRun: typeof tables.syncJobs.$inferSelect | null = null;
    let call = 0;
    const client = {
      ...base,
      async medias(input: { handle: string; sinceIso: string; maxItems: number; cursor?: string }) {
        call += 1;
        if (call === 2) midRun = await runningJob(channelId);
        return base.medias(input);
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(midRun).not.toBeNull();
    const snapshot = midRun as unknown as typeof tables.syncJobs.$inferSelect;
    expect(snapshot.itemsSeen).toBe(2);
    expect(snapshot.itemsCreated).toBe(2);
    expect(snapshot.phase).toBe("fetching");
    expect(snapshot.currentChannelHandle).toBe("@progress");
    expect(snapshot.channelsTotal).toBe(1);
    expect(snapshot.channelsDone).toBe(0);
    expect(snapshot.heartbeatAt).not.toBeNull();

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.channelsDone).toBe(1);
    expect(job.channelsTotal).toBe(1);
    expect(job.phase).toBe("finalizing");
    expect(job.itemsSeen).toBe(3);
  });

  test("counters accumulate across channels rather than resetting per channel", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    // Earlier tests in this file deliberately leave a held library lock behind, and this
    // one takes the library lock itself (two channel ids = not a per-channel run).
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const first = await setupChannel("@multi-a");
    const second = await setupChannel("@multi-b");

    const { client: base } = stubClient({});
    const seen: number[] = [];
    let mediaIndex = 0;
    const client = {
      ...base,
      async profile(handle: string) {
        // A whole-library run has channelId NULL on the job row.
        const running = await runningJob(null);
        if (running) seen.push(running.itemsSeen);
        return makeProfile(handle);
      },
      async medias() {
        mediaIndex += 1;
        return { items: [makeMedia(`multi-${mediaIndex}`, 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [first.channelId, second.channelId], client, sleep: noopSleep });

    expect(result.itemsSeen).toBe(2);
    // Second channel started with the first channel's item already banked.
    expect(seen).toEqual([0, 1]);
  });
});

describe("runSync — onJobStarted", () => {
  test("hands back the real job id before any network call", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@started");

    const events: string[] = [];
    let announced: string | null = null;
    const { client: base } = stubClient({ pages: [{ items: [makeMedia("st1", 1)], nextCursor: null, stopReason: "lookback" }] });
    const client = {
      ...base,
      async profile(handle: string) {
        events.push("profile");
        return makeProfile(handle);
      },
    } as unknown as IgClient;

    const result = await runSync({
      channelIds: [channelId],
      client,
      sleep: noopSleep,
      onJobStarted: (id) => {
        announced = id;
        events.push("started");
      },
    });

    // The whole point is a caller that never awaits the run: the id must arrive before
    // the first (potentially slow) fetch, and it must name a row that really exists.
    expect(events).toEqual(["started", "profile"]);
    expect(announced).toBe(result.jobId);
    const rows = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, announced!));
    expect(rows).toHaveLength(1);
  });

  test("is not fired by a run that lost the lock", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@contended");

    await db.insert(tables.syncJobs).values({
      id: newId(),
      channelId,
      lockKey: channelId,
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
      lookbackDays: 30,
    });

    let fired = 0;
    const { client } = stubClient({});
    await expect(
      runSync({ channelIds: [channelId], client, sleep: noopSleep, onJobStarted: () => void (fired += 1) })
    ).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    // A fired callback must mean "you own this job". Firing on a lost race would hand the
    // caller an id it cannot cancel and would never see progress on.
    expect(fired).toBe(0);

    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
  });

  test("a listener that throws cannot kill a run that already holds the lock", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@badlistener");

    const { client } = stubClient({ pages: [{ items: [makeMedia("bl1", 1)], nextCursor: null, stopReason: "lookback" }] });
    const result = await runSync({
      channelIds: [channelId],
      client,
      sleep: noopSleep,
      onJobStarted: () => {
        throw new Error("listener exploded");
      },
    });

    expect(result.itemsSeen).toBe(1);
  });
});

describe("runSync — retry", () => {
  test("recovers from a transient network failure and counts the retry", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@flaky-net");

    let attempts = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async medias() {
        attempts += 1;
        if (attempts === 1) throw new IgError("IG_NETWORK", "connection reset by peer");
        return { items: [makeMedia("retry-1", 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    // The backoff sleep is the only moment the "retrying" phase is observable, and the
    // whole point of that phase is that a recovering sync must not read as a hang.
    const duringBackoff: { phase: string | null; retries: number }[] = [];
    const sleep = async () => {
      const running = await runningJob(channelId);
      if (running) duringBackoff.push({ phase: running.phase, retries: running.retries });
    };

    const result = await runSync({ channelIds: [channelId], client, sleep });

    expect(attempts).toBe(2);
    expect(result.itemsSeen).toBe(1);
    expect(result.gaps).toHaveLength(0);
    expect(duringBackoff).toContainEqual({ phase: "retrying", retries: 1 });

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("success");
    expect(job.retries).toBe(1);
  });

  test("a non-retryable error fails fast — no backoff, no second attempt", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@private-acct");

    let calls = 0;
    let slept = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        calls += 1;
        throw new IgError("IG_PRIVATE", "account is private");
      },
    } as unknown as IgClient;

    const result = await runSync({
      channelIds: [channelId],
      client,
      sleep: async () => {
        slept += 1;
      },
    });

    expect(calls).toBe(1);
    expect(slept).toBe(0);
    // The widened gap shape: the UI can name the channel and branch on the code without
    // a second query.
    expect(result.gaps).toEqual([
      { channelId, handle: "@private-acct", provider: "instagrapi", error: "account is private", code: "IG_PRIVATE" },
    ]);

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.retries).toBe(0);
  });

  test("retries are bounded — a permanently broken upstream becomes a gap, not an infinite loop", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    const { config } = await import("../config");
    migrate();
    const { channelId } = await setupChannel("@always-down");

    let calls = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        calls += 1;
        throw new IgError("IG_NETWORK", "connection reset");
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(calls).toBe(config.SYNC_MAX_RETRIES + 1);
    expect(result.gaps[0]).toMatchObject({ handle: "@always-down", code: "IG_NETWORK" });

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.retries).toBe(config.SYNC_MAX_RETRIES);
    // Sole channel, and it never came back: 'failed', not a partial success.
    expect(job.status).toBe("failed");
  });

  test("a dead local sidecar gets one quick retry, not the whole ladder", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    const { config } = await import("../config");
    migrate();
    const { channelId } = await setupChannel("@sidecar-down");

    let calls = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        calls += 1;
        throw new IgError("IG_SERVICE_DOWN", "sidecar is not running");
      },
    } as unknown as IgClient;

    const delays: number[] = [];
    const result = await runSync({ channelIds: [channelId], client, sleep: async (ms: number) => void delays.push(ms) });

    // A refused connection to our OWN localhost process is not a transient upstream: the
    // service is starting or it isn't. One retry covers a restart; making every channel
    // wait out a doubling ladder just delays the "run `npm run ig:service`" message.
    expect(calls).toBe(2);
    // Backoff is slept in slices so a cancel can interrupt it, so assert the total waited
    // rather than the number of sleep calls.
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(config.SYNC_RETRY_BASE_MS);
    expect(result.gaps[0]).toMatchObject({ code: "IG_SERVICE_DOWN" });
  });

  test("bounds the total time it will spend guessing at a backoff", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    const { config } = await import("../config");
    migrate();
    const { channelId } = await setupChannel("@budget");

    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        throw new IgError("IG_NETWORK", "connection reset");
      },
    } as unknown as IgClient;

    const delays: number[] = [];
    await runSync({ channelIds: [channelId], client, sleep: async (ms: number) => void delays.push(ms) });

    // Doubling without a ceiling is how a retry loop recreates the very "wait ages to be
    // told it failed" problem it was added to fix. Asserted on total time waited, since
    // the backoff is slept in cancel-checkable slices rather than one call per retry.
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(config.SYNC_RETRY_BASE_MS * config.SYNC_MAX_RETRIES);

    const { db, tables } = await import("../db");
    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.channelId, channelId)))[0];
    expect(job.retries).toBe(config.SYNC_MAX_RETRIES);
  });

  test("honours Instagram's own backoff hint instead of guessing a shorter one", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@throttled");

    let attempts = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async medias() {
        attempts += 1;
        if (attempts === 1) {
          throw new IgError("IG_RATE_LIMITED", "please wait a few minutes", { detail: { retry_after_sec: 42 } });
        }
        return { items: [makeMedia("rl-1", 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    const delays: number[] = [];
    await runSync({ channelIds: [channelId], client, sleep: async (ms: number) => void delays.push(ms) });

    // The hinted wait is honoured in full (and is exempt from the guessing budget); it is
    // spent in cancel-checkable slices, so the assertion is on the total.
    expect(delays.reduce((a, b) => a + b, 0)).toBe(42_000);
  });
});

describe("runSync — co-operative cancel", () => {
  test("cancel observed MID-walk keeps committed work and does NOT soft-delete", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@cancelme");

    // Establish a post that the cancelled run will NOT return. A cancelled run has not
    // enumerated the whole window, so treating its absence as a deletion would bury a
    // live post — the same fabrication the cap/empty-page guards exist to prevent.
    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("survivor", 5)], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    const pages: Page[] = [
      { items: [makeMedia("cx1", 1), makeMedia("cx2", 2)], nextCursor: "cursor-2", stopReason: null },
      { items: [makeMedia("cx3", 3)], nextCursor: null, stopReason: null },
    ];
    const { client: base } = stubClient({ pages });
    let call = 0;
    const client = {
      ...base,
      async medias(input: { handle: string; sinceIso: string; maxItems: number; cursor?: string }) {
        call += 1;
        if (call === 1) {
          const running = await runningJob(channelId);
          // The in-flight fetch is allowed to finish; cancel is not a kill.
          expect(await requestCancel(running!.id)).toBe(true);
        }
        return base.medias(input);
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(call).toBe(1);
    expect(result.stopReason).toBe("cancelled");
    expect(result.itemsSeen).toBe(2);
    expect(result.itemsDeleted).toBe(0);

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("partial");
    expect(job.stopReason).toBe("cancelled");
    expect(job.finishedAt).not.toBeNull();

    // Page 1's work is committed, page 3 was never fetched, and nothing was buried.
    const rows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(rows.map((r) => r.externalId).sort()).toEqual(["cx1", "cx2", "survivor"]);
    expect(rows.every((r) => r.deletedAt === null)).toBe(true);
  });

  test("stops before starting the next channel", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    migrate();
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const first = await setupChannel("@cancel-a");
    const second = await setupChannel("@cancel-b");

    const handles: string[] = [];
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile(handle: string) {
        handles.push(handle);
        const running = await runningJob(null);
        await requestCancel(running!.id);
        return makeProfile(handle);
      },
      async medias() {
        return { items: [makeMedia("cb-1", 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [first.channelId, second.channelId], client, sleep: noopSleep });

    // Channel order comes from the id index, not from insertion order — what matters is
    // that exactly ONE channel was touched and the other was never contacted.
    expect(handles).toHaveLength(1);
    expect(["@cancel-a", "@cancel-b"]).toContain(handles[0]);
    expect(result.channelsSynced).toBe(1);
    expect(result.stopReason).toBe("cancelled");

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("partial");
    expect(job.channelsDone).toBe(1);
  });

  test("a cancel that lands after the work is done is recorded, but the run still succeeded", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@late-cancel");

    await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("lc1", 1), makeMedia("lc2", 2)], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    const { client: base } = stubClient({});
    const client = {
      ...base,
      async medias() {
        const running = await runningJob(channelId);
        await requestCancel(running!.id);
        // The window IS fully enumerated here, so the soft-delete guard must still fire.
        return { items: [makeMedia("lc1", 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(result.stopReason).toBe("cancelled");
    expect(result.itemsDeleted).toBe(1);

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("success");
    expect(job.stopReason).toBe("cancelled");
  });

  test("cancel during a retry backoff stops the ladder instead of waiting it out", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    const { config } = await import("../config");
    migrate();
    const { channelId } = await setupChannel("@cancel-backoff");

    let calls = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        calls += 1;
        throw new IgError("IG_NETWORK", "connection reset by peer");
      },
    } as unknown as IgClient;

    // Observed live: the flag flipped instantly, and the row sat on `running | retrying`
    // for 45+ seconds because the retry ladder never looked at it.
    const slices: number[] = [];
    const sleep = async (ms: number) => {
      slices.push(ms);
      if (slices.length === 1) {
        const running = await runningJob(channelId);
        await requestCancel(running!.id);
      }
    };

    const result = await runSync({ channelIds: [channelId], client, sleep });

    // One retry was scheduled and then abandoned mid-wait: the remaining budget belongs to
    // a run the user has not stopped, and every extra attempt is another authenticated
    // request at Instagram for work nobody wants.
    expect(calls).toBe(1);
    expect(result.stopReason).toBe("cancelled");

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.retries).toBe(1);
    expect(job.retries).toBeLessThan(config.SYNC_MAX_RETRIES);
    expect(job.stopReason).toBe("cancelled");
    // Cut short, not slept through.
    expect(slices.reduce((a, b) => a + b, 0)).toBeLessThan(config.SYNC_RETRY_BASE_MS);
  });

  test("a cancel already pending does not schedule a retry at all", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    const { channelId } = await setupChannel("@cancel-before-retry");

    let calls = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        calls += 1;
        // Cancel lands while the request is in flight; it is allowed to finish, but the
        // retry that would follow must never be scheduled.
        const running = await runningJob(channelId);
        await requestCancel(running!.id);
        throw new IgError("IG_NETWORK", "connection reset by peer");
      },
    } as unknown as IgClient;

    let slept = 0;
    const result = await runSync({ channelIds: [channelId], client, sleep: async () => void (slept += 1) });

    expect(calls).toBe(1);
    expect(slept).toBe(0);
    expect(result.stopReason).toBe("cancelled");

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.retries).toBe(0);
    expect(job.stopReason).toBe("cancelled");
  });

  test("cancel lands during a slow in-flight request instead of waiting it out", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@slowrequest");

    // The live shape of the bug: attempts ~65 s apart, nearly all of it inside ONE
    // request. Cancel arrived 13 s in and was not noticed until that request failed.
    // Here the request never resolves within the test's patience at all.
    const SLOW_MS = 5_000;
    let profileStarted = 0;
    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile(handle: string) {
        profileStarted += 1;
        await new Promise((r) => setTimeout(r, SLOW_MS));
        return makeProfile(handle);
      },
    } as unknown as IgClient;

    const started = Date.now();
    const run = runSync({ channelIds: [channelId], client, sleep: noopSleep });

    // Cancel while the request is still outstanding.
    await new Promise((r) => setTimeout(r, 100));
    const running = await runningJob(channelId);
    expect(await requestCancel(running!.id)).toBe(true);

    const result = await run;
    const elapsed = Date.now() - started;

    expect(profileStarted).toBe(1);
    // Cancel is observed on the poll tick, not after the request gives up.
    expect(elapsed).toBeLessThan(SLOW_MS);
    expect(result.stopReason).toBe("cancelled");
    // The channel was not broken — we stopped asking. It must not be marked as a gap.
    expect(result.gaps).toHaveLength(0);

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.stopReason).toBe("cancelled");
    expect(job.status).toBe("partial");

    const channel = (await db.select().from(tables.channels).where(eq(tables.channels.id, channelId)))[0];
    expect(channel.syncErrorCode).toBeNull();
  }, 20_000);

  test("cancelling a job that isn't running is a no-op, not an error", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync, requestCancel } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@already-done");

    const result = await runSync({
      channelIds: [channelId],
      client: stubClient({ pages: [{ items: [makeMedia("ad1", 1)], nextCursor: null, stopReason: "lookback" }] }).client,
      sleep: noopSleep,
    });

    expect(await requestCancel(result.jobId)).toBe(false);
    expect(await requestCancel("no-such-job")).toBe(false);
  });
});

describe("runSync — stale-lock safety (audit F3)", () => {
  test("a long page still heartbeats, so the reaper can't declare a live run dead", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@slowpage");

    // One item can burn IG_DOWNLOAD_TIMEOUT_MS on the video and again on the thumbnail, so
    // a single page can be silent for tens of minutes. Flushing per page is not a
    // wall-clock guarantee; this drives that exact pathology with a clock that only moves
    // when a download happens.
    let clockMs = Date.now();
    const observed: number[] = [];
    const assetDeps: EnsureAssetDeps = {
      client: {
        async download(input: { url: string; kind: "thumbnail" | "video" | "avatar" }) {
          clockMs += 40_000;
          const running = await runningJob(channelId);
          if (running) observed.push(running.itemsSeen);
          const sha = Buffer.from(input.url).toString("hex").padEnd(64, "0").slice(0, 64);
          return { path: `${sha.slice(0, 2)}/${sha}.jpg`, bytes: 2048, contentType: "image/jpeg", sha256: sha, width: 10, height: 10, durationSec: null };
        },
      },
    };

    const items = [makeMedia("sp1", 1), makeMedia("sp2", 2), makeMedia("sp3", 3)];
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "lookback" }] });

    await runSync({
      channelIds: [channelId],
      client,
      sleep: noopSleep,
      now: () => new Date(clockMs),
      assetDeps,
    });

    // Progress advanced WHILE the page was still being processed.
    expect(observed.at(-1)).toBeGreaterThan(0);
  });

  test("a fast page does not write progress per item", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@fastpage");

    // Same shape as the test above, but the clock stands still: the mid-loop flush is
    // governed by elapsed time, not by item count, so nothing extra may be written.
    const frozen = new Date();
    const observed: number[] = [];
    const assetDeps: EnsureAssetDeps = {
      client: {
        async download(input: { url: string; kind: "thumbnail" | "video" | "avatar" }) {
          const running = await runningJob(channelId);
          if (running) observed.push(running.itemsSeen);
          const sha = Buffer.from(input.url).toString("hex").padEnd(64, "0").slice(0, 64);
          return { path: `${sha.slice(0, 2)}/${sha}.jpg`, bytes: 2048, contentType: "image/jpeg", sha256: sha, width: 10, height: 10, durationSec: null };
        },
      },
    };

    const items = [makeMedia("fp1", 1), makeMedia("fp2", 2), makeMedia("fp3", 3)];
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "lookback" }] });

    await runSync({
      channelIds: [channelId],
      client,
      sleep: noopSleep,
      now: () => frozen,
      assetDeps,
    });

    expect(observed.every((n) => n === 0)).toBe(true);
  });

  test("a slow in-flight request keeps the heartbeat fresh", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@slowbeat");

    // Measured live: `heartbeat_age_s = 55` on a run that was alive and healthily
    // retrying, because nothing flushed while a single request was outstanding. At 90 s
    // the UI declares a working sync dead. The clock here runs 200x so a ~1 s request
    // crosses the flush threshold without a 30 s test.
    const realStart = Date.now();
    const now = () => new Date(realStart + (Date.now() - realStart) * 200);

    let beatDuringCall: string | null = null;
    let phaseDuringCall: string | null = null;
    const { client: base } = stubClient({ pages: [{ items: [makeMedia("hb1", 1)], nextCursor: null, stopReason: "lookback" }] });
    const client = {
      ...base,
      async profile(handle: string) {
        const before = (await runningJob(channelId))!.heartbeatAt;
        await new Promise((r) => setTimeout(r, 1_200));
        const during = await runningJob(channelId);
        beatDuringCall = during!.heartbeatAt === before ? null : during!.heartbeatAt;
        phaseDuringCall = during!.phase;
        return makeProfile(handle);
      },
    } as unknown as IgClient;

    await runSync({ channelIds: [channelId], client, sleep: noopSleep, now });

    expect(beatDuringCall).not.toBeNull();
    expect(phaseDuringCall).toBe("profile");
  }, 20_000);

  test("a run that was reaped mid-flight cannot resurrect its own job row", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();
    const { channelId } = await setupChannel("@reaped");

    const pages: Page[] = [
      { items: [makeMedia("rp1", 1)], nextCursor: "cursor-2", stopReason: null },
      { items: [makeMedia("rp2", 2)], nextCursor: null, stopReason: null },
    ];
    const { client: base } = stubClient({ pages });
    let call = 0;
    let reapedId = "";
    const client = {
      ...base,
      async medias(input: { handle: string; sinceIso: string; maxItems: number; cursor?: string }) {
        call += 1;
        if (call === 2) {
          // Exactly what reapStaleLocks does to a job it believes is dead. The lock is
          // released the moment this lands, so a second sync could already be running.
          const running = await runningJob(channelId);
          reapedId = running!.id;
          await db
            .update(tables.syncJobs)
            .set({ status: "failed", finishedAt: new Date().toISOString(), errorCode: "SYNC_ABANDONED", errorMessage: "Job had no heartbeat; assumed crashed" })
            .where(eq(tables.syncJobs.id, reapedId));
        }
        return base.medias(input);
      },
    } as unknown as IgClient;

    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, reapedId)))[0];
    // The reap verdict stands — overwriting it back to 'success' erased the only evidence
    // that two syncs may have been racing on this channel.
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("SYNC_ABANDONED");
    // ...but the work really happened, so the numbers are still recorded.
    expect(job.itemsSeen).toBe(2);
    expect(job.finishedAt).not.toBeNull();
  });

  test("a run the UI would call stalled is not yet reaped", async () => {
    const { db, newId, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { SYNC_STALL_SECONDS } = await import("./sync-types");
    migrate();
    const { channelId } = await setupChannel("@quiet");

    // "The UI shows a stalled warning" and "we declare the process dead and let a second
    // sync loose on the same channel" must not be the same threshold.
    const quietId = newId();
    await db.insert(tables.syncJobs).values({
      id: quietId,
      channelId,
      lockKey: channelId,
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      heartbeatAt: new Date(Date.now() - (SYNC_STALL_SECONDS + 60) * 1000).toISOString(),
      status: "running",
      lookbackDays: 30,
    });

    const { client } = stubClient({ pages: [{ items: [], nextCursor: null, stopReason: "exhausted" }] });
    const { SyncAlreadyRunningError } = await import("../ig/errors");
    await expect(runSync({ channelIds: [channelId], client, sleep: noopSleep })).rejects.toBeInstanceOf(SyncAlreadyRunningError);

    const still = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, quietId)))[0];
    expect(still.status).toBe("running");

    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.id, quietId));
  });
});

describe("runSync — status honesty (audit F11)", () => {
  test("every channel failing is 'failed', not 'partial'", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const a = await setupChannel("@allfail-a");
    const b = await setupChannel("@allfail-b");

    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile() {
        throw new IgError("IG_AUTH_REQUIRED", "session expired");
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [a.channelId, b.channelId], client, sleep: noopSleep });

    expect(result.channelsSynced).toBe(0);
    expect(result.gaps).toHaveLength(2);

    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    // 'partial' told the user part of their library refreshed. Nothing refreshed.
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("IG_AUTH_REQUIRED");
    expect(job.errorMessage).toBe("session expired");
  });

  test("one survivor among failures is still 'partial'", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    const { IgError } = await import("../ig/errors");
    migrate();
    await db.delete(tables.syncJobs).where(eq(tables.syncJobs.status, "running"));
    const good = await setupChannel("@survivor-good");
    const bad = await setupChannel("@survivor-bad");

    const { client: base } = stubClient({});
    const client = {
      ...base,
      async profile(handle: string) {
        if (handle === "@survivor-bad") throw new IgError("IG_NOT_FOUND", "gone");
        return makeProfile(handle);
      },
      async medias() {
        return { items: [makeMedia("sv-1", 1)], nextCursor: null, stopReason: "lookback" as const };
      },
    } as unknown as IgClient;

    const result = await runSync({ channelIds: [good.channelId, bad.channelId], client, sleep: noopSleep });

    expect(result.channelsSynced).toBe(1);
    const job = (await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId)))[0];
    expect(job.status).toBe("partial");
    expect(job.errorCode).toBeNull();
  });
});

describe("isUniqueViolation (audit F9)", () => {
  test("recognises the driver's error code even when the message says nothing useful", async () => {
    const { isUniqueViolation } = await import("./sync-engine");

    // The old check was a regex over the message alone, so any drizzle wrapping, driver
    // swap, or renamed constraint turned "a sync is already running" into an unhandled
    // 500 on a perfectly ordinary second click.
    const coded = Object.assign(new Error("constraint failed"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
    expect(isUniqueViolation(coded)).toBe(true);

    const codedPrimaryKey = Object.assign(new Error("whatever the driver decides to say"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
    expect(isUniqueViolation(codedPrimaryKey)).toBe(true);
  });

  test("still recognises the plain message form, and nothing else", async () => {
    const { isUniqueViolation } = await import("./sync-engine");

    expect(isUniqueViolation(new Error("UNIQUE constraint failed: sync_jobs.lock_key"))).toBe(true);
    expect(isUniqueViolation(new Error("database is locked"))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("nope"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
  });
});

describe("normalizeHandle", () => {
  test("accepts bare, @-prefixed and URL forms", async () => {
    const { normalizeHandle } = await import("./sync-engine");
    expect(normalizeHandle("kallaway")).toBe("@kallaway");
    expect(normalizeHandle("@kallaway")).toBe("@kallaway");
    expect(normalizeHandle("  @kallaway  ")).toBe("@kallaway");
    // The live DB grew a row literally named "@https://www.instagram.com/hormozi/"
    // because the old normalizer just prefixed an "@". It must extract the handle.
    expect(normalizeHandle("https://www.instagram.com/hormozi/")).toBe("@hormozi");
    expect(normalizeHandle("instagram.com/hormozi")).toBe("@hormozi");
  });

  test("rejects junk instead of creating a garbage channel row", async () => {
    const { normalizeHandle } = await import("./sync-engine");
    expect(() => normalizeHandle("")).toThrow();
    expect(() => normalizeHandle("@")).toThrow();
    expect(() => normalizeHandle("has spaces")).toThrow();
    expect(() => normalizeHandle("https://example.com/notinstagram")).toThrow();
  });
});

describe("addChannel — re-adding a removed handle", () => {
  test("revives the soft-deleted row and refreshes it, instead of silently returning a deleted one", async () => {
    const { db, tables, nowIso } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { addChannel } = await import("./sync-engine");
    migrate();
    const handle = "@revive_me";

    const { client: c1 } = stubClient({ profile: makeProfile(handle, { followerCount: 111 }) });
    const first = await addChannel({ handle }, { client: c1 });

    // Soft-delete it the way removeChannel does.
    await db.update(tables.channels).set({ deletedAt: nowIso() }).where(eq(tables.channels.id, first.channelId));

    const { client: c2 } = stubClient({ profile: makeProfile(handle, { followerCount: 222 }) });
    const second = await addChannel({ handle }, { client: c2 });

    // Same row (the unique (platform, handle) index forbids a duplicate), now un-deleted
    // and refreshed from the second profile fetch — this is what makes it reappear in the
    // channels list instead of staying an invisible deleted row.
    expect(second.channelId).toBe(first.channelId);
    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, first.channelId));
    expect(row.deletedAt).toBeNull();
    expect(row.followerCount).toBe(222);
  });

  test("a live, already-tracked handle stays idempotent with no duplicate row", async () => {
    const { db, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { addChannel } = await import("./sync-engine");
    migrate();
    const handle = "@already_here";

    const { client } = stubClient({ profile: makeProfile(handle) });
    const first = await addChannel({ handle }, { client });
    const second = await addChannel({ handle }, { client });

    expect(second.channelId).toBe(first.channelId);
    const rows = await db.select().from(tables.channels).where(eq(tables.channels.handle, handle));
    expect(rows.length).toBe(1);
  });
});

describe("view count enrichment — candidates", () => {
  test("the newest live reels, with deleted and non-reel rows excluded", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@probe");

    // Prefixed to stay clear of the plain "gone" externalId the soft-delete describe
    // block above already inserts — external_id is unique per platform across the whole
    // file's shared in-memory database, not scoped to this test's channel.
    await seedReel(channelId, "enrich-old", { daysAgo: 30 });
    await seedReel(channelId, "enrich-new", { daysAgo: 2 });
    await seedReel(channelId, "enrich-gone", { daysAgo: 1, deletedAt: "2026-08-02T10:47:25.371Z" });
    await seedReel(channelId, "enrich-photo", { daysAgo: 1, productType: "feed" });

    const { __test } = await import("./sync-engine");
    const rows = await __test.enrichmentCandidates(channelId, 10);

    // A soft-deleted row raises MediaNotFound if asked about, correctly: a prior sync
    // already saw it removed from Instagram. Exactly one of 299 dev rows is in that
    // state, and the first spike probe picked it first try and read the error as a block.
    expect(rows.map((r) => r.externalId)).toEqual(["enrich-new", "enrich-old"]);
  });

  test("the limit caps how many reels a sync will ask about", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    // Not "@capped": that handle is already taken by the MAX_ITEMS_PER_SYNC
    // cap-enforcement test above, and every test in this file shares one persistent
    // in-memory database (migrate() only applies schema, it does not clear rows), so a
    // repeat handle trips the (platform, handle) unique index.
    const { channelId } = await setupChannel("@capped-enrich");

    // Prefixed for the same reason as above: plain "a"/"b" externalIds are already taken
    // (the lookback-window describe block near the top of this file).
    await seedReel(channelId, "enrich-a", { daysAgo: 1 });
    await seedReel(channelId, "enrich-b", { daysAgo: 2 });

    const { __test } = await import("./sync-engine");
    expect(await __test.enrichmentCandidates(channelId, 1)).toHaveLength(1);
    expect(await __test.enrichmentCandidates(channelId, 0)).toHaveLength(0);
  });

  test("a reel that already has a count is still a candidate, because play counts grow", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@already-counted");
    await seedReel(channelId, "enrich-has-count", { viewCount: 500 });

    const { __test } = await import("./sync-engine");
    const rows = await __test.enrichmentCandidates(channelId, 10);
    expect(rows.map((r) => r.externalId)).toContain("enrich-has-count");
  });
});

describe("view count enrichment — the pass", () => {
  /** The stats shape `igClient.fetchMediaStats` resolves to. Numbers are a real
   *  measurement: @jun_yuh reel 3953894690809843161. */
  function stats(externalId: string, viewCount: number | null) {
    return { externalId, mediaType: "video" as const, productType: "clips", viewCount, likeCount: 77_918, commentCount: 389 };
  }

  async function viewCountOf(externalId: string): Promise<number | null> {
    const { db, tables } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ viewCount: tables.videos.viewCount })
      .from(tables.videos)
      .where(eq(tables.videos.externalId, externalId))
      .limit(1);
    return rows[0].viewCount;
  }

  test("writes the play count the listing endpoint withheld", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@enrich");
    await seedReel(channelId, "3953894690809843161", { viewCount: null });

    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, 1_212_937) },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    expect(result.enriched).toBe(1);
    expect(await viewCountOf("3953894690809843161")).toBe(1_212_937);
  });

  test("a null count never erases a number we already have", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@keep");
    await seedReel(channelId, "kept", { viewCount: 2_270_000 });

    // fetchMediaStats already maps a zero to null, so this is what a withheld count looks
    // like by the time it reaches here. Writing it would repeat the bug that once turned
    // a genuine 2.27M-view reel into 0 and zeroed every outlier score.
    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, null) },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    expect(result.enriched).toBe(0);
    expect(await viewCountOf("kept")).toBe(2_270_000);

    // Counted as `withheld`, which is neither `enriched` nor `skipped`. Without its own
    // counter a channel whose every candidate came back withheld logs 0/0/false — byte
    // for byte what "there was nothing to do" logs — and the one thing this feature is
    // for, telling a real zero from an absent number, would be unreadable in the log.
    expect(result.withheld).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.candidates).toBe(1);
  });

  test("a deleted media is skipped and the pass continues", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@partly-gone");
    // "gone"/"live" are already taken by the soft-delete describe block earlier in this
    // file — external_id is unique per platform across the whole file's shared in-memory
    // database, not scoped to this test's channel.
    await seedReel(channelId, "enrich-deleted", { daysAgo: 1 });
    await seedReel(channelId, "enrich-live", { daysAgo: 2 });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async (pk: string) => {
          if (pk === "enrich-deleted") throw new IgError("IG_NOT_FOUND", "Media not found or unavailable");
          return stats(pk, 94_988);
        },
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // IG_NOT_FOUND on one reel means that one post is gone, not that the account is
    // blocked. The first spike probe aborted on exactly this and read it as a possible
    // ban, which cost a whole confirmation run.
    expect(result.skipped).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.stopped).toBe(false);
  });

  test("a stale sidecar stops the pass instead of looking like deleted posts", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@stale-sidecar");
    await seedReel(channelId, "enrich-stale-a", { daysAgo: 1 });
    await seedReel(channelId, "enrich-stale-b", { daysAgo: 2 });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async () => {
          calls += 1;
          // What a sidecar older than this endpoint actually returns. Both this and a
          // deleted post are HTTP 404, so the code is the only thing telling them apart.
          throw new IgError("IG_ROUTE_NOT_FOUND", "Not Found");
        },
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // Stop on the FIRST one. Skipping would spend the whole budget re-learning that the
    // endpoint still does not exist, and would report the run as missing media. That is
    // not hypothetical: a live pass did exactly that against a sidecar started two days
    // before its route was added, and blamed a blocked account.
    expect(calls).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.skipped).toBe(0);
    expect(result.enriched).toBe(0);
  });

  test("any other error stops the pass without failing the sync", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@limited");
    await seedReel(channelId, "first", { daysAgo: 1 });
    await seedReel(channelId, "second", { daysAgo: 2 });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async () => {
          calls += 1;
          throw new IgError("IG_RATE_LIMITED", "Please wait a few minutes");
        },
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // Rate limiting is the signal to back off entirely, and it must not throw: the page
    // walk already did the sync's real work, and losing a whole channel over a view count
    // is the trade this file refuses everywhere else.
    expect(calls).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.enriched).toBe(0);
  });

  test("requests are paced apart", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@paced");
    // "a"/"b" are already taken by the lookback-window describe block near the top of
    // this file (same shared in-memory database).
    await seedReel(channelId, "enrich-paced-a", { daysAgo: 1 });
    await seedReel(channelId, "enrich-paced-b", { daysAgo: 2 });

    const { __test } = await import("./sync-engine");
    const sleeps: number[] = [];
    await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => stats(pk, 10) },
      sleep: async (ms: number) => { sleeps.push(ms); },
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // One gap between two reels, none before the first.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  test("an unbroken run of missing medias ends the pass instead of burning the budget", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@all-missing");
    for (const n of [1, 2, 3, 4, 5]) await seedReel(channelId, `enrich-missing-${n}`, { daysAgo: n });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async () => {
          calls += 1;
          throw new IgError("IG_NOT_FOUND", "Media not found or unavailable");
        },
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // A channel does not lose three of its newest reels between two syncs. An unbroken
    // run of MediaNotFound reads as an action-blocked burner, and spending the other 195
    // requests of a full budget to confirm that costs an account already in trouble a lot
    // and teaches nothing.
    expect(calls).toBe(3);
    expect(result.skipped).toBe(3);
    expect(result.stopped).toBe(true);
  });

  test("a single answered reel resets the missing-media run", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@gaps-not-a-wall");
    for (const n of [1, 2, 3, 4, 5]) await seedReel(channelId, `enrich-gap-${n}`, { daysAgo: n });

    const { IgError } = await import("../ig/errors");
    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async (pk: string) => {
          calls += 1;
          // Newest first, so this answers 1, 2 missing; 3 present; 4, 5 missing.
          if (pk === "enrich-gap-3") return stats(pk, 88_100);
          throw new IgError("IG_NOT_FOUND", "Media not found or unavailable");
        },
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // The ceiling is on CONSECUTIVE misses. Two deletions, a live reel, two more
    // deletions is an ordinary channel, and stopping it would be the ceiling deciding
    // something it has no evidence for.
    expect(calls).toBe(5);
    expect(result.skipped).toBe(4);
    expect(result.enriched).toBe(1);
    expect(result.stopped).toBe(false);
  });

  test("a cancel mid-pass returns, and no further reel is asked about", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@stop-midway");
    await seedReel(channelId, "enrich-stop-1", { daysAgo: 1 });
    await seedReel(channelId, "enrich-stop-2", { daysAgo: 2 });
    await seedReel(channelId, "enrich-stop-3", { daysAgo: 3 });

    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => { calls += 1; return stats(pk, 41_000); } },
      sleep: noopSleep,
      limit: 5,
      shouldStop: async () => calls >= 1,
      tick: noopTick,
    });

    // Returned, not thrown. The cancel path elsewhere in this engine raises
    // SyncCancelledError, and routing this check through it would break the one promise
    // this function makes to syncOneChannel: whatever happens, it does not throw.
    expect(calls).toBe(1);
    expect(result.enriched).toBe(1);
    expect(result.stopped).toBe(true);
  });

  test("the pass heartbeats once per reel", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@heartbeat");
    await seedReel(channelId, "enrich-beat-1", { daysAgo: 1 });
    await seedReel(channelId, "enrich-beat-2", { daysAgo: 2 });
    await seedReel(channelId, "enrich-beat-3", { daysAgo: 3 });

    const { __test } = await import("./sync-engine");
    // Order matters as much as the count, so both are recorded in one sequence. A tick
    // moved to the BOTTOM of the loop body still ticks three times while leaving the run
    // silent across every request it was added to cover.
    const order: string[] = [];
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async (pk: string) => { order.push("fetch"); return stats(pk, 12_400); } },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: async () => { order.push("tick"); },
    });

    // The real tick is tracker.flushIfDue. Without one the pass is a silent stretch
    // between two flushes: at a live request per reel it clears SYNC_STALL_SECONDS around
    // 60 reels (the UI calls a working run dead) and LOCK_STALE_MS at a full budget, after
    // which a second run may steal the lock and soft-delete posts it never reached. This
    // repo has already lost 8 live @kallaway posts to exactly that.
    expect(order).toEqual(["tick", "fetch", "tick", "fetch", "tick", "fetch"]);
    expect(result.candidates).toBe(3);
  });
});

describe("view count enrichment — ordering and default", () => {
  test("scores are computed from the enriched numbers, not the withheld zeros", async () => {
    // The whole point of running before the recompute. If enrichment ran after scoring, a
    // sync would show the number in the feed but score it as though the count were
    // missing, and the score would only correct itself on the following sync.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@ordered");

    // scoreMinUsablePosts defaults to 5 (src/server/settings/index.ts DEFAULTS), so a
    // single freshly-enriched reel can never clear the floor on its own regardless of its
    // view count — asserting a bare 371_200 here would be wrong before the floor is met.
    // Four reels carry that same known count already; the fifth is left null, so the
    // floor sits exactly one enriched reel away from being cleared, which is what proves
    // the ordering rather than just the write.
    await seedReel(channelId, "enrich-order-1", { viewCount: 371_200, daysAgo: 2 });
    await seedReel(channelId, "enrich-order-2", { viewCount: 371_200, daysAgo: 3 });
    await seedReel(channelId, "enrich-order-3", { viewCount: 371_200, daysAgo: 4 });
    await seedReel(channelId, "enrich-order-4", { viewCount: 371_200, daysAgo: 5 });
    await seedReel(channelId, "enrich-order-5", { viewCount: null, daysAgo: 1 });

    const { __test, recomputeChannelScores } = await import("./sync-engine");

    // Below the floor before enrichment: only 4 of the 5 posts carry a usable count.
    expect(await recomputeChannelScores(channelId)).toBeNull();

    await __test.enrichViewCounts(channelId, {
      client: {
        fetchMediaStats: async (pk: string) => ({
          externalId: pk, mediaType: "video" as const, productType: "clips",
          viewCount: 371_200, likeCount: 1, commentCount: 1,
        }),
      },
      sleep: noopSleep,
      limit: 5,
      shouldStop: neverStop,
      tick: noopTick,
    });

    // recomputeChannelScores returns the channel baseline, computed from view counts. With
    // the fifth reel's count enriched, all 5 posts clear scoreMinUsablePosts and the
    // median is exactly the (identical) enriched number.
    expect(await recomputeChannelScores(channelId)).toBe(371_200);
  });

  test("the shipped default for the knob is 0", async () => {
    // Asserted on the config object itself, not on a limit a test happened to pass in.
    // Off by default is a ban-risk decision — every reel this knob enables is one more
    // authenticated request per sync from a burner account — and it was the one part of
    // this feature nothing tested: the limit-0 test below passes just as happily with a
    // default of 25.
    const { config } = await import("../config");
    expect(config.VIEW_COUNT_ENRICH_PER_CHANNEL).toBe(0);
  });

  test("a real runSync with the knob left alone asks Instagram about no reel at all", async () => {
    // The companion to the assertion above, and the one that covers the shipped BEHAVIOUR
    // rather than the shipped number: nothing here touches config, so this is what a user
    // who never set the knob actually gets from a real sync — not one live single-media
    // request. It deliberately does not claim to isolate the call site's
    // `VIEW_COUNT_ENRICH_PER_CHANNEL > 0` guard: delete that guard and the pass still asks
    // about nothing, because `enrichmentCandidates` short-circuits on `limit <= 0`. Two
    // layers, one property, and the property is the part that matters.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@default-off");

    const items = [1, 2].map((n) => makeMedia(`enrich-default-off-${n}`, n, { viewCount: null }));
    const { client: base } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "exhausted" }] });
    let statsCalls = 0;
    const client = {
      ...base,
      async fetchMediaStats(pk: string) {
        statsCalls += 1;
        return base.fetchMediaStats(pk);
      },
    } as unknown as IgClient;

    const { runSync } = await import("./sync-engine");
    await runSync({ channelIds: [channelId], client, sleep: noopSleep });

    expect(statsCalls).toBe(0);
  });

  test("a limit of 0 asks about nothing", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@off");
    await seedReel(channelId, "enrich-off-1");

    const { __test } = await import("./sync-engine");
    let calls = 0;
    const result = await __test.enrichViewCounts(channelId, {
      client: { fetchMediaStats: async () => { calls += 1; throw new Error("must not be called"); } },
      sleep: noopSleep,
      limit: 0,
      shouldStop: neverStop,
      tick: noopTick,
    });

    expect(calls).toBe(0);
    expect(result.enriched).toBe(0);
  });

  test("a real runSync writes enriched scores on its own first pass, not the next one", async () => {
    // Unlike the two tests above, this one does not call __test.enrichViewCounts or
    // recomputeChannelScores directly — it drives runSync() end to end with the knob on,
    // so the assertion can only pass if syncOneChannel's own call site really runs
    // enrichment before its own call to recomputeChannelScores. Moving the call site to
    // after the recompute, or deleting it, makes this test fail: the scores below would
    // still be null on this, the channel's very first sync.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@wired-enrich");

    // Five reels to clear scoreMinUsablePosts (5, established in the ordering test
    // above). No view count on any of them, exactly how the listing endpoint really
    // delivers a reel the burner account does not own.
    const items = [1, 2, 3, 4, 5].map((n) => makeMedia(`enrich-wired-${n}`, n, { viewCount: null }));
    const { client } = stubClient({ pages: [{ items, nextCursor: null, stopReason: "exhausted" }] });

    // config is a plain singleton object (src/server/config.ts), read live by
    // syncOneChannel on every call rather than captured at import time, so mutating the
    // property here reaches the real call site. Restored in `finally` because this test
    // file shares one module registry (and this one config instance) across every test.
    const { config } = await import("../config");
    const previousLimit = config.VIEW_COUNT_ENRICH_PER_CHANNEL;
    config.VIEW_COUNT_ENRICH_PER_CHANNEL = 5;
    try {
      const { runSync } = await import("./sync-engine");
      await runSync({ channelIds: [channelId], client, sleep: noopSleep });
    } finally {
      config.VIEW_COUNT_ENRICH_PER_CHANNEL = previousLimit;
    }

    const { db, tables } = await import("../db");
    const rows = await db
      .select({ viewCount: tables.videos.viewCount, outlierScore: tables.videos.outlierScore })
      .from(tables.videos)
      .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)));

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.viewCount).toBe(STUB_STATS_DEFAULT_VIEW_COUNT);
      // If enrichment ran after recomputeChannelScores (or not at all), every view count
      // recomputeChannelScores saw would still be null, so every outlier score would be
      // null too, on this, the channel's only sync so far.
      expect(row.outlierScore).not.toBeNull();
    }
  });

  test("a cancelled run spends nothing on enrichment", async () => {
    // Same harness as the test above (knob on, real runSync), pointed at the opposite
    // claim. The user clicks Stop during the first page; the walk breaks with stopReason
    // "cancelled", and runSync only re-checks cancel BETWEEN channels, so the enrichment
    // call site is the last thing standing between a stopped run and a full pass of
    // authenticated single-media requests from the burner.
    //
    // This covers the two cancel mechanisms JOINTLY, not one each: the call-site gate and
    // the per-reel `shouldStop` both hold this number at zero on their own, so deleting
    // either one alone leaves it green. That is the point — zero requests after Stop is
    // the user-facing promise, and it survives losing either half. The halves are pinned
    // separately elsewhere: `shouldStop` by "a cancel mid-pass returns" above, and the
    // call site's own live check by the test below, which reads the log instead of the
    // request count precisely because the request count cannot tell them apart.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@cancel-enrich");

    const pages: Page[] = [
      { items: [makeMedia("enrich-cancel-1", 1), makeMedia("enrich-cancel-2", 2)], nextCursor: "cursor-2", stopReason: null },
      { items: [makeMedia("enrich-cancel-3", 3)], nextCursor: null, stopReason: null },
    ];
    const { client: base } = stubClient({ pages });
    const { runSync, requestCancel } = await import("./sync-engine");

    let statsCalls = 0;
    const client = {
      ...base,
      async medias(input: { handle: string; sinceIso: string; maxItems: number; cursor?: string }) {
        const running = await runningJob(channelId);
        await requestCancel(running!.id);
        return base.medias(input);
      },
      async fetchMediaStats(pk: string) {
        statsCalls += 1;
        return base.fetchMediaStats(pk);
      },
    } as unknown as IgClient;

    const { config } = await import("../config");
    const previousLimit = config.VIEW_COUNT_ENRICH_PER_CHANNEL;
    config.VIEW_COUNT_ENRICH_PER_CHANNEL = 5;
    let result: Awaited<ReturnType<typeof runSync>>;
    try {
      result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });
    } finally {
      config.VIEW_COUNT_ENRICH_PER_CHANNEL = previousLimit;
    }

    expect(result.stopReason).toBe("cancelled");
    // Two reels were stored by the first page, so there were real candidates to ask
    // about. Ungated this is 2 — and at the configured maximum it is 200.
    expect(statsCalls).toBe(0);
  });

  test("a cancel that lands after the walk finished still skips the pass entirely", async () => {
    // The call site's LIVE cancel check, isolated. Here the walk ends normally
    // (stopReason "lookback", the window was fully enumerated, the soft-delete even
    // fires), so the `stopReason !== "cancelled"` half of the gate cannot help: the only
    // thing that knows the user pressed Stop is `tracker.isCancelRequested()`.
    //
    // Asserted on the LOG, not on the request count, because the per-reel `shouldStop`
    // also holds the request count at zero and would mask a deleted gate. The call site
    // logs `sync.enrich.finished` whenever it runs the pass at all, so the absence of that
    // line for this channel is the proof that the pass was never entered.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@late-cancel-enrich");

    const { client: base } = stubClient({});
    const { runSync, requestCancel } = await import("./sync-engine");
    let statsCalls = 0;
    const client = {
      ...base,
      async medias() {
        const running = await runningJob(channelId);
        await requestCancel(running!.id);
        return { items: [makeMedia("enrich-late-1", 1), makeMedia("enrich-late-2", 2)], nextCursor: null, stopReason: "lookback" as const };
      },
      async fetchMediaStats(pk: string) {
        statsCalls += 1;
        return base.fetchMediaStats(pk);
      },
    } as unknown as IgClient;

    const { config } = await import("../config");
    const previousLimit = config.VIEW_COUNT_ENRICH_PER_CHANNEL;
    config.VIEW_COUNT_ENRICH_PER_CHANNEL = 5;
    try {
      await runSync({ channelIds: [channelId], client, sleep: noopSleep });
    } finally {
      config.VIEW_COUNT_ENRICH_PER_CHANNEL = previousLimit;
    }

    const { db, tables } = await import("../db");
    const finished = await db
      .select({ fields: tables.logEvents.fields })
      .from(tables.logEvents)
      .where(eq(tables.logEvents.event, "sync.enrich.finished"));

    // Other tests in this file run the pass for real, so the filter is on this channel.
    expect(finished.filter((r) => r.fields.includes(channelId))).toEqual([]);
    expect(statsCalls).toBe(0);
  });
});
