import { beforeAll, beforeEach, describe, expect, test } from "vitest";

// Test-DB pattern (see src/server/queries/feed.test.ts) — the db singleton binds
// CROWSNEST_DB_PATH at import, so env must be set in beforeAll BEFORE any dynamic
// import of "@/server/db" (or anything that imports it), otherwise this suite would
// silently hit the real data/crowsnest.db.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let resolveFeedNav: typeof import("./resolve-feed-nav")["resolveFeedNav"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ resolveFeedNav } = await import("./resolve-feed-nav"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.videos);
  await db.delete(tables.channels);
  await db.delete(tables.savedFilters);
});

async function seedChannel(): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: `@resolve-feed-nav-test-${channelId}`,
    trackedSince: nowIso(),
  });
  return channelId;
}

async function seedVideo(
  channelId: string,
  opts: { outlierScore?: number | null; postedAt?: string } = {}
): Promise<string> {
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `resolve-feed-nav-${videoId}`,
    url: "https://example.com/v",
    postedAt: opts.postedAt ?? nowIso(),
    outlierScore: opts.outlierScore ?? null,
    firstSeenAt: nowIso(),
  });
  return videoId;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("resolveFeedNav", () => {
  test("a filtered searchParams scopes the index label and adjacency to the filtered set, not the library", async () => {
    const channelId = await seedChannel();
    // Three posts matching minScore=5, two that don't — the unfiltered library is 5.
    const low = await seedVideo(channelId, { outlierScore: 10 });
    const mid = await seedVideo(channelId, { outlierScore: 8 });
    const high = await seedVideo(channelId, { outlierScore: 6 });
    await seedVideo(channelId, { outlierScore: 2 });
    await seedVideo(channelId, { outlierScore: 1 });

    const nav = await resolveFeedNav(mid, { minScore: "5" }, undefined);

    // Sorted by score desc by default: low(10), mid(8), high(6) — mid is 2nd of 3.
    expect(nav.indexLabel).toBe("2 of 3");
    expect(nav.prevHref).toContain(low);
    expect(nav.nextHref).toContain(high);
    expect(nav.prevHref).toContain("minScore=5");
    expect(nav.nextHref).toContain("minScore=5");
  });

  test("a post outside the filtered set resolves to no index label and no adjacency", async () => {
    const channelId = await seedChannel();
    const excluded = await seedVideo(channelId, { outlierScore: 1 });
    await seedVideo(channelId, { outlierScore: 10 });

    const nav = await resolveFeedNav(excluded, { minScore: "5" }, undefined);

    expect(nav.indexLabel).toBeNull();
    expect(nav.prevHref).toBeNull();
    expect(nav.nextHref).toBeNull();
  });

  test("a bare searchParams applies the Balanced default, same as feed/page.tsx", async () => {
    const channelId = await seedChannel();
    const balancedCriteria = { minScore: 5, sinceDays: 30 };
    // Matches Balanced (minScore >= 5).
    const inBand = await seedVideo(channelId, { outlierScore: 7 });
    // Below Balanced's minScore — excluded from the resolved slice.
    await seedVideo(channelId, { outlierScore: 2 });

    const nav = await resolveFeedNav(inBand, {}, balancedCriteria);

    // Only the one Balanced-matching post exists in the resolved slice — "1 of 1", not
    // "1 of 2" (which would mean Balanced never applied and the full library leaked
    // through, the pre-fix bug).
    expect(nav.indexLabel).toBe("1 of 1");
  });

  test("purely cosmetic params (density, view, limit) are dropped from the forwarded hrefs", async () => {
    const channelId = await seedChannel();
    const a = await seedVideo(channelId, { outlierScore: 10 });
    const b = await seedVideo(channelId, { outlierScore: 5 });

    const nav = await resolveFeedNav(a, { minScore: "1", density: "compact", view: "list" }, undefined);

    expect(nav.nextHref).toBe(`/feed/${b}?minScore=1`);
    expect(nav.backHref).toBe("/feed?minScore=1");
  });

  // Whole-branch review finding I1: `sort` was being dropped from the forwarded hrefs
  // (it isn't in FILTER_PARAM_KEYS) even though resolveFeedNav's own order-by reads it,
  // so a `sort=recent` feed's detail page silently walked score-order neighbours.
  test("I1: sort is forwarded, and a sort=recent visit walks recency order, not score order", async () => {
    const channelId = await seedChannel();
    // Score order (desc) would be: high, mid, low. Recent order (postedAt desc, most
    // recent first) is the reverse: low, mid, high.
    const high = await seedVideo(channelId, { outlierScore: 30, postedAt: isoDaysAgo(10) });
    const mid = await seedVideo(channelId, { outlierScore: 20, postedAt: isoDaysAgo(5) });
    const low = await seedVideo(channelId, { outlierScore: 10, postedAt: isoDaysAgo(1) });

    const nav = await resolveFeedNav(mid, { minScore: "1", sort: "recent" }, undefined);

    // Recent order: low (1 day ago), mid (5 days ago), high (10 days ago) — mid is 2nd
    // of 3, prev is the more-recent `low`, next is the older `high`.
    expect(nav.indexLabel).toBe("2 of 3");
    expect(nav.prevHref).toContain(low);
    expect(nav.nextHref).toContain(high);
    expect(nav.nextHref).toContain("sort=recent");
    expect(nav.backHref).toBe(`/feed?minScore=1&sort=recent`);
  });

  // Whole-branch review finding I2: a paramless visit resolves against Balanced, but
  // plenty of bare-URL entry points (sidebar last-viewed, dashboard/channel grids,
  // Vault cards, the Vault empty-state "top outlier" link) can land on a post Balanced
  // would exclude. That used to render dead nav (no label, no prev/next) for a post
  // that's real and has real neighbours — just not inside Balanced.
  test("I2: a paramless visit whose target falls outside Balanced falls back to the unfiltered order", async () => {
    const channelId = await seedChannel();
    const balancedCriteria = { minScore: 5, sinceDays: 30 };
    // Below Balanced's minScore threshold — Balanced alone would exclude both of these.
    const outOfBand = await seedVideo(channelId, { outlierScore: 2 });
    await seedVideo(channelId, { outlierScore: 1 });

    const nav = await resolveFeedNav(outOfBand, {}, balancedCriteria);

    // Falls back to the unfiltered order (both posts exist there), rather than the
    // pre-fix "not in Balanced -> no label, no adjacency at all" for a real post.
    expect(nav.indexLabel).toBe("1 of 2");
  });

  test("I2: a visit with a real filter query never falls back, even if the target doesn't match it", async () => {
    const channelId = await seedChannel();
    const excluded = await seedVideo(channelId, { outlierScore: 1 });
    await seedVideo(channelId, { outlierScore: 10 });

    // Same case as the "post outside the filtered set" test above, restated to make
    // the I2 boundary explicit: a REAL filter param present means "doesn't match" is
    // an honest fact, not an implicit default to fall back out of.
    const nav = await resolveFeedNav(excluded, { minScore: "5" }, undefined);

    expect(nav.indexLabel).toBeNull();
  });
});
