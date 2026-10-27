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

// Every seeded time counts back from the app's clock, so a lane with a fixed
// LEAD_STUDIO_CLOCK_START (the v2 baseline) gets the same rows on every run.
const NOW = process.env.LEAD_STUDIO_CLOCK_START ? new Date(process.env.LEAD_STUDIO_CLOCK_START) : new Date();

async function main(): Promise<void> {
  // Imported after CROWSNEST_DB_PATH is set and the stale file is gone -- `./index`
  // opens (and creates) the database file as a side effect of module load, same
  // ordering constraint migrate.ts documents on its own db/index import.
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db, newId, tables } = await import("../src/server/db/index");
  const { bootstrapSystemFilters } = await import("../src/server/db/bootstrap");

  migrate(db, { migrationsFolder: "./drizzle" });
  await bootstrapSystemFilters();

  const now = NOW.toISOString();
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

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
  await seedPlan(db, tables);
  await seedPlanVersions(db, tables);
  // Only a stopped clock gets fixed last pulls, so the baseline shots hold still.
  if (process.env.LEAD_STUDIO_CLOCK_FROZEN === "1") await seedPulls(db, tables);

  console.log(`seed-e2e: wrote ${dbPath}`);
  console.log(`seed-e2e: rival=${rivalId} (@e2e_fixture_rival, best 4.1x, one post tagged take, one untagged)`);
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
    { id: "own-reel-1", format: "Reel", productType: "REELS", age: 3, caption: "OWN01 reel: the agent stack", views: 12_400, reach: 9800, likes: 410, comments: 64, shares: 120, saved: 95 },
    { id: "own-reel-2", format: "Reel", productType: "REELS", age: 9, caption: "Second reel, no keyword", views: 5200, reach: 4100, likes: 150, comments: 21, shares: 33, saved: 40 },
    { id: "own-reel-3", format: "Reel", productType: "REELS", age: 20, caption: "Third reel", views: 3100, reach: 2500, likes: 90, comments: 7, shares: 11, saved: 9 },
    { id: "own-carousel-1", format: "Carousel", productType: "FEED", age: 5, caption: "A carousel", views: 900, reach: 800, likes: 40, comments: 3, shares: 2, saved: 14 },
  ];
  for (const p of posts) {
    await db.insert(tables.ownPosts).values({
      id: p.id, externalId: `e2e-${p.id}`, permalink: `${FIXTURE_ORIGIN}/e2e-own/${p.id}/`, mediaType: "VIDEO", productType: p.productType,
      format: p.format, caption: p.caption, postedAt: daysAgo(p.age), durationSec: 30, firstSeenAt: daysAgo(p.age), lastMeasuredAt: capture,
    });
    await db.insert(tables.ownPostInsights).values({
      id: `${p.id}-now`, ownPostId: p.id, capturedAt: capture, views: p.views, reach: p.reach, likes: p.likes, comments: p.comments, shares: p.shares, saved: p.saved,
      reposts: 2, followsFromPost: 18, profileVisits: 60, bioLinkTaps: 9, avgWatchTimeMs: 11_200, skipRate: 41.5,
    });
  }
  await db.insert(tables.ownPostInsights).values({ id: "own-reel-3-failed", ownPostId: "own-reel-3", capturedAt: daysAgo(0.01), fetchError: "HTTP 400: media gone" });
  await db.insert(tables.ownPostInsights).values({ id: "own-reel-1-early", ownPostId: "own-reel-1", capturedAt: daysAgo(2.5), views: 4300, reach: 3600 });
  const now = NOW.toISOString();
  await db.insert(tables.plannedPosts).values([
    { id: "own-plan-1", state: "published", title: "OWN01 reel", keyword: "OWN01", publishedOwnPostId: "own-reel-1", createdAt: now, updatedAt: now },
    // A keyword with DMs but no gift page visits yet, so the funnel's visits total is partial.
    { id: "own-plan-sales", state: "draft", title: "Sales reel: from 0 to 2 orders", keyword: "SALES", createdAt: now, updatedAt: now },
  ]);
  // No orders row: Purchases reads "no data yet", never 0.
  await db.insert(tables.reelFunnel).values([
    { id: "own-funnel-dm", keyword: "OWN01", source: "chatbotx", metric: "dms", value: 52, capturedAt: capture, agent: "seed-e2e", createdAt: now },
    { id: "own-funnel-visits", keyword: "OWN01", source: "umami", metric: "visits", value: 18, capturedAt: capture, agent: "seed-e2e", createdAt: now },
    { id: "sales-funnel-dm", keyword: "SALES", source: "chatbotx", metric: "dms", value: 30, capturedAt: capture, agent: "seed-e2e", createdAt: now },
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
  const now = NOW.toISOString();
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
  await db.insert(tables.videoAnalyses).values([
    {
      videoId: "e2e-rival-video-0", hookType: "result-first", formatTags: ["talking-head"], styleTags: ["screen-record"],
      whyItWorked: "Opens on the finished result, then shows the three steps.", summary: "Rival fixture analysis.", model: "fixture", source: "mcp", tag: "take", createdAt: now,
    },
    {
      videoId: "e2e-rival-video-3", hookType: "question", formatTags: ["carousel"], styleTags: [],
      whyItWorked: "Asks a question but never answers it.", summary: "Untagged rival fixture analysis.", model: "fixture", source: "legacy", createdAt: daysAgo(1),
    },
  ]);
  return id;
}

async function seedPlan(db: Db["db"], tables: Db["tables"]): Promise<void> {
  const at = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 19, 30);
  const date = at.toLocaleDateString("sv-SE");
  const stamp = NOW.toISOString();
  await db.insert(tables.scripts).values({ id: "plan-e2e-script", title: "PLAN01 script", content: "Open on the result, then 3 steps.", createdAt: stamp, updatedAt: stamp });
  const plan = { state: "scheduled", plannedDate: date, createdAt: stamp, updatedAt: stamp };
  await db.insert(tables.plannedPosts).values([
    { ...plan, id: "plan-e2e-draft", state: "draft", title: "PLAN01 draft" },
    { ...plan, id: "plan-e2e-full", title: "PLAN01 full script", plannedTime: "09:00", scriptId: "plan-e2e-script", caption: "Caption PLAN01", sourceVideoId: "e2e-rival-video-0" },
    { ...plan, id: "plan-e2e-armed", title: "PLAN01 armed on Instagram", plannedTime: "19:30", caption: "Caption armed", scheduledAt: at.toISOString(), idempotencyKey: `plan-e2e-armed:${at.toISOString()}` },
  ]);
  // Month view: long titles on other days, so each chip shows one line and its tooltip the rest.
  const day = (offset: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset).toLocaleDateString("sv-SE");
  const chips: [string, number, string, string][] = [
    ["plan-month-1", -20, "published", "Cursor deleted my repo: 3 git commands to get it back"],
    ["plan-month-2", -14, "published", "Hooks in one picture: run tests after every edit"],
    ["plan-month-3", -12, "failed", "Week 42 in numbers: 591k views, 4 orders"],
    ["plan-month-4", -12, "published", "Claude Code vs Cursor: which one to pick"],
    ["plan-month-5", -5, "draft", "3 MCP mistakes and how to fix them"],
    ["plan-month-6", 3, "draft", "Long prompt or short prompt: a real test"],
  ];
  await db.insert(tables.plannedPosts).values(chips.map(([id, offset, state, title]) => ({ id, state, title, plannedDate: day(offset), createdAt: stamp, updatedAt: stamp })));
}

/** Gate 1: this week's live plan v1 and Claude's proposal v2, which edits, adds and removes reels. */
async function seedPlanVersions(db: Db["db"], tables: Db["tables"]): Promise<void> {
  const monday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - ((NOW.getDay() + 6) % 7));
  const day = (offset: number) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset).toLocaleDateString("sv-SE");
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const week = Math.ceil((Math.round((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  const periodKey = `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
  const ago = (days: number, hour: number, minute: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour, minute).toISOString();
  const live = [
    { key: "git-r12", title: "Cursor deleted my repo", date: day(0), keyword: "GITR12" },
    { key: "mcp5", title: "5 MCP servers worth installing", date: day(1), keyword: "MCP5" },
    { key: "hooks", title: "Hooks in one picture", date: day(2), keyword: "HOOKS" },
    { key: "wk", title: `Week ${week} in numbers`, date: day(6), keyword: `WK${week}` },
  ];
  const proposed = [
    live[0],
    { ...live[2], keyword: "HOOKS14", note: "a new key counts the repost on its own" },
    { key: "sale2", title: "Sales reel: 0 to 2 orders", date: day(3), keyword: "SALE2", note: "22 days without a sales reel" },
    { key: "mcp3", title: "3 MCP mistakes", date: day(4), keyword: "MCP3", note: "replaces the dropped MCP reel; mistakes get the most comments" },
    live[3],
  ];
  await db.insert(tables.planVersions).values([
    { id: "plan-v1", period: "week", periodKey, version: 1, status: "live", reels: live, agent: "claude", approvedAt: ago(6, 7, 12), approvedBy: "kai", createdAt: ago(7, 6, 40), updatedAt: ago(6, 7, 12) },
    { id: "plan-v2", period: "week", periodKey, version: 2, status: "proposed", reels: proposed, agent: "claude", createdAt: ago(0, 6, 40), updatedAt: ago(0, 6, 40) },
  ]);
}

/** The last pulls: the Graph pull failed, so Instagram numbers say so where they show. */
async function seedPulls(db: Db["db"], tables: Db["tables"]): Promise<void> {
  const at = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), NOW.getHours() - 1).toISOString();
  await db.insert(tables.connectorStatus).values([
    { connectorId: "instagram-graph", pullState: "error", pullMessage: "The last pull failed, so the older numbers stay. Re-check the key.", pullDetail: "HTTP 400: Invalid OAuth access token", pulledAt: at, updatedAt: at },
    { connectorId: "ig-sidecar", pullState: "ready", pulledAt: at, updatedAt: at },
  ]);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
