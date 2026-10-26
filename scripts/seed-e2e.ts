/**
 * Builds the fixture SQLite database the browse-e2e journeys (scripts/e2e/*.sh) run
 * against. Reuses the real migration + bootstrap mechanism (migrate.ts / bootstrap.ts)
 * rather than hand-rolling a second schema — the fixture must go stale exactly when a
 * real migration would, not silently drift from it.
 *
 * CROWSNEST_DB_PATH decides the target (scripts/e2e/run.sh sets it to data/e2e.db).
 * The file is deleted and rebuilt from scratch on every run, so the fixture is always
 * exactly this shape — no accumulation across runs, no leftover rows from a prior
 * journey's writes (a kept post, a saved plan) making the next run's assertions lie.
 *
 * Shape (per the browse-e2e lens setup rows in scripts/e2e/cases/
 * {feed,mine,ig-sync}.md and references/browse-e2e-qa.md):
 *   - One tracked channel, marked as Kai's own (`isOwn`), synced.
 *   - More than 24 scored videos, so the feed's default page size is exercised.
 *   - Exactly one scores at or above 5x -- the feed-e2e-01 journey picks the "5x+"
 *     filter and expects one unambiguous card, not a scoped pick among several.
 *   - One analyzed video (a `video_analyses` row).
 *   - One soft-removed video (`deletedAt` set).
 *   - One carousel post (`mediaType: "carousel"` plus `video_children` rows).
 *   - A junk Graph token in the `secrets` table: configured, but every check fails, so
 *     My reels renders stored rows under the connect panel. The e2e server answers
 *     graph.instagram.com offline (scripts/e2e/graph-offline.mjs).
 * The My reels journeys reset the own-channel rows per journey (scripts/e2e/mine-seed.ts).
 * mine-e2e-02 needs no further seeding: the calendar with no `planned_posts` and no
 * `own_posts` rows renders every day as "open", which is exactly the empty day the
 * journey plans against. ig-sync-e2e-01 needs no seeded video data at all -- it runs
 * against a handle that is NOT in this fixture, with the sidecar down.
 */
import { existsSync, unlinkSync } from "node:fs";

const dbPath = process.env.CROWSNEST_DB_PATH ?? "data/e2e.db";
process.env.CROWSNEST_DB_PATH = dbPath;

// Fresh file every run -- same reasoning as backupDatabase's WAL checkpoint, but
// simpler: this is a throwaway fixture, not a database anyone restores from, so
// deleting beats reconciling old rows against the shape below.
if (dbPath !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

// Seeded posts link here so opening one from a board never calls Instagram.
const FIXTURE_ORIGIN = "https://example.com";

async function main(): Promise<void> {
  // Imported after CROWSNEST_DB_PATH is set and the stale file is gone -- `./index`
  // opens (and creates) the database file as a side effect of module load, same
  // ordering constraint migrate.ts documents on its own db/index import.
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, newId, nowIso, tables } = await import("../src/server/db/index");
  const { bootstrapSystemFilters } = await import("../src/server/db/bootstrap");

  migrate(db, { migrationsFolder: "./drizzle" });
  await bootstrapSystemFilters();

  const now = nowIso();
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: "@e2e_fixture_creator",
    externalId: "e2e-fixture-1",
    displayName: "E2E Fixture Creator",
    followerCount: 42_000,
    followingCount: 120,
    mediaCount: 400,
    isVerified: false,
    isPrivate: false,
    trackedSince: daysAgo(60),
    lastSyncedAt: now,
    isOwn: true,
  });

  // Junk Graph token (mine journeys): configured, but every live check fails, so My reels
  // renders stored rows under the connect panel. A secrets row wins over .env.local, so a
  // real token on the machine cannot leak into the fixture run.
  for (const [name, value] of [["IG_GRAPH_TOKEN", "e2e-junk-graph-token"], ["IG_GRAPH_USER_ID", "0"]] as const) {
    await db.insert(tables.secrets).values({ name, value, updatedAt: now });
  }

  const TOTAL_VIDEOS = 30; // > 24, so the feed's default page size is exercised.
  let outlierVideoId = "";
  let analyzedVideoId = "";
  let carouselVideoId = "";

  for (let i = 0; i < TOTAL_VIDEOS; i++) {
    const videoId = newId();
    // Every video scores under 5 except one -- the feed-e2e-01 journey filters to
    // "5x+" and expects to click the one card that clears it, not pick one out of
    // several via a selector this component's markup doesn't carry.
    const isOutlier = i === 0;
    const isCarousel = i === 1;
    const isAnalyzed = i === 2;
    const isRemoved = i === 3;

    if (isOutlier) outlierVideoId = videoId;
    if (isCarousel) carouselVideoId = videoId;
    if (isAnalyzed) analyzedVideoId = videoId;

    const score = isOutlier ? 6.4 : 0.3 + (i % 5) * 0.4; // stays well under 5
    const postedAt = daysAgo(1 + i);

    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: `e2e-media-${i}`,
      shortcode: `e2emedia${i}`,
      mediaType: isCarousel ? "carousel" : "video",
      productType: "clips",
      url: `https://www.instagram.com/reel/e2emedia${i}/`,
      caption: `Fixture post ${i}`,
      postedAt,
      durationSec: 20,
      viewCount: 10_000 + i * 500,
      likeCount: 100 + i,
      commentCount: 5 + i,
      shareCount: 2,
      outlierScore: score,
      deletedAt: isRemoved ? now : null,
      firstSeenAt: postedAt,
      lastRefreshedAt: now,
    });

    if (isCarousel) {
      for (let pos = 0; pos < 2; pos++) {
        await db.insert(tables.videoChildren).values({
          id: newId(),
          videoId,
          position: pos,
          externalId: `e2e-media-${i}-child-${pos}`,
          mediaType: "photo",
        });
      }
    }

    if (isAnalyzed) {
      await db.insert(tables.videoAnalyses).values({
        videoId,
        hookType: "curiosity-gap",
        formatTags: ["talking-head"],
        styleTags: ["fast-cut"],
        whyItWorked: "Fixture analysis for browse-e2e journeys.",
        summary: "Fixture analysis summary.",
        model: "fixture",
        createdAt: now,
      });
    }
  }

  await seedOwnChannel(db, tables, daysAgo);
  const rivalId = await seedRival(db, tables, newId, daysAgo);

  console.log(`seed-e2e: wrote ${dbPath}`);
  console.log(`seed-e2e: rival=${rivalId} (@e2e_fixture_rival, best 4.1x, one analyzed post)`);
  console.log(`seed-e2e: channel=${channelId} (@e2e_fixture_creator, isOwn)`);
  console.log(`seed-e2e: outlierVideoId=${outlierVideoId} (score 6.4x)`);
  console.log(`seed-e2e: analyzedVideoId=${analyzedVideoId}`);
  console.log(`seed-e2e: carouselVideoId=${carouselVideoId}`);
}

type Db = typeof import("../src/server/db/index");

async function seedOwnChannel(db: Db["db"], tables: Db["tables"], daysAgo: (n: number) => string): Promise<void> {
  const capture = daysAgo(0.05);
  await db.insert(tables.ownAccountSnapshots).values([
    { id: "own-snap-1", capturedAt: daysAgo(40), externalId: "e2e-own", username: "e2e_own", followerCount: 3100, followsCount: 80, mediaCount: 40 },
    { id: "own-snap-2", capturedAt: daysAgo(10), externalId: "e2e-own", username: "e2e_own", followerCount: 3180, followsCount: 80, mediaCount: 42 },
    { id: "own-snap-3", capturedAt: capture, externalId: "e2e-own", username: "e2e_own", followerCount: 3245, followsCount: 81, mediaCount: 44 },
  ]);
  const posts = [
    { id: "own-reel-1", format: "Reel", productType: "REELS", age: 3, caption: "OWN01 reel: the agent stack", views: 12_400, reach: 9800, likes: 410 },
    { id: "own-reel-2", format: "Reel", productType: "REELS", age: 9, caption: "Second reel, no keyword", views: 5200, reach: 4100, likes: 150 },
    { id: "own-reel-3", format: "Reel", productType: "REELS", age: 20, caption: "Third reel", views: 3100, reach: 2500, likes: 90 },
    { id: "own-carousel-1", format: "Carousel", productType: "FEED", age: 5, caption: "A carousel", views: 900, reach: 800, likes: 40 },
  ];
  for (const p of posts) {
    await db.insert(tables.ownPosts).values({
      id: p.id, externalId: `e2e-${p.id}`, permalink: `${FIXTURE_ORIGIN}/e2e-own/${p.id}/`, mediaType: "VIDEO", productType: p.productType,
      format: p.format, caption: p.caption, postedAt: daysAgo(p.age), durationSec: 30, firstSeenAt: daysAgo(p.age), lastMeasuredAt: capture,
    });
    await db.insert(tables.ownPostInsights).values({
      id: `${p.id}-now`, ownPostId: p.id, capturedAt: capture, views: p.views, reach: p.reach, likes: p.likes, comments: 12, shares: 30, saved: 25,
      reposts: 2, followsFromPost: 18, profileVisits: 60, bioLinkTaps: 9, avgWatchTimeMs: 11_200, skipRate: 41.5,
    });
  }
  await db.insert(tables.ownPostInsights).values({ id: "own-reel-1-early", ownPostId: "own-reel-1", capturedAt: daysAgo(2.5), views: 4300, reach: 3600 });
  const now = new Date().toISOString();
  await db.insert(tables.plannedPosts).values({ id: "own-plan-1", state: "published", title: "OWN01 reel", keyword: "OWN01", publishedOwnPostId: "own-reel-1", createdAt: now, updatedAt: now });
  await db.insert(tables.reelFunnel).values([
    { id: "own-funnel-dm", keyword: "OWN01", source: "chatbotx", metric: "dms", value: 52, capturedAt: capture, agent: "seed-e2e", createdAt: now },
    { id: "own-funnel-visits", keyword: "OWN01", source: "umami", metric: "visits", value: 18, capturedAt: capture, agent: "seed-e2e", createdAt: now },
    { id: "own-funnel-orders", keyword: "OWN01", source: "polar", metric: "orders", value: 3, capturedAt: capture, agent: "seed-e2e", createdAt: now },
  ]);
  const breakdown = (metric: string, dimension: string, key: string, value: number) => ({ id: `own-bd-${dimension}-${key}`, capturedAt: capture, metric, dimension, key, value, timeframe: null });
  await db.insert(tables.ownAccountBreakdowns).values([
    breakdown("views", "follower_type", "NON_FOLLOWER", 870), breakdown("views", "follower_type", "FOLLOWER", 130),
    breakdown("engaged_audience_demographics", "gender", "M", 82), breakdown("engaged_audience_demographics", "gender", "F", 18),
    breakdown("engaged_audience_demographics", "age", "25-34", 55), breakdown("engaged_audience_demographics", "age", "18-24", 30),
    breakdown("engaged_audience_demographics", "country", "VN", 70), breakdown("engaged_audience_demographics", "country", "US", 12),
  ]);
}

async function seedRival(db: Db["db"], tables: Db["tables"], newId: Db["newId"], daysAgo: (n: number) => string): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(tables.channels).values({
    id, platform: "instagram", handle: "@e2e_fixture_rival", externalId: "e2e-rival-1", displayName: "E2E Fixture Rival", followerCount: 18_000,
    trackedSince: daysAgo(60), lastSyncedAt: now, isOwn: false,
  });
  const scores = [4.1, 2.6, 1.0, 0.8, 0.6];
  for (const [i, score] of scores.entries()) {
    const videoId = `e2e-rival-video-${i}`;
    await db.insert(tables.videos).values({
      id: videoId, channelId: id, platform: "instagram", externalId: `e2e-rival-media-${i}`, mediaType: "video", productType: "clips",
      url: `${FIXTURE_ORIGIN}/e2e-rival/${i}/`, caption: `Rival post ${i}`, postedAt: daysAgo(2 + i), durationSec: 25, viewCount: Math.round(8000 * score),
      likeCount: 300, commentCount: 40, shareCount: 10, outlierScore: score, firstSeenAt: daysAgo(2 + i), lastRefreshedAt: now,
    });
  }
  await db.insert(tables.videoAnalyses).values({
    videoId: "e2e-rival-video-0", hookType: "result-first", formatTags: ["talking-head"], styleTags: ["screen-record"],
    whyItWorked: "Opens on the finished result, then shows the three steps.", summary: "Rival fixture analysis.", model: "fixture", source: "mcp", createdAt: now,
  });
  return id;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
