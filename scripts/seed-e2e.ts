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
 * Shape (per the browse-e2e lens setup rows in documents/architect/core-components/
 * {feed,mine,ig-sync}/04-test-cases.md and references/browse-e2e-qa.md):
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
    // Own channel: mine-e2e-02 needs `/mine` to open straight on the dashboard/connect
    // panel and calendar, never the "This is me" picker.
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

  console.log(`seed-e2e: wrote ${dbPath}`);
  console.log(`seed-e2e: channel=${channelId} (@e2e_fixture_creator, isOwn)`);
  console.log(`seed-e2e: outlierVideoId=${outlierVideoId} (score 6.4x)`);
  console.log(`seed-e2e: analyzedVideoId=${analyzedVideoId}`);
  console.log(`seed-e2e: carouselVideoId=${carouselVideoId}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
