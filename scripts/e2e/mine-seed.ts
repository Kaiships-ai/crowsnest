/**
 * Resets the own-channel rows of the e2e fixture db to one named variant, for one
 * My reels journey (scripts/e2e/mine-e2e-1x.sh / 2x.sh). Leaves channels, videos, and
 * planned_posts alone. Usage: npx tsx scripts/e2e/mine-seed.ts <reels|reach-zero|no-reels|audience-refused>
 */
const variant = process.argv[2] ?? "reels";
process.env.CROWSNEST_DB_PATH ??= "data/e2e.db";

async function main(): Promise<void> {
  const { db, tables } = await import("../../src/server/db/index");
  const { eq } = await import("drizzle-orm");
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns]) await db.delete(t);
  await db.delete(tables.appSettings).where(eq(tables.appSettings.key, "own_audience_fetch_error"));

  const H = 3_600_000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  await db.insert(tables.ownAccountSnapshots).values({ id: "snap-1", capturedAt: iso(now - H), externalId: "e2e-acct", username: "e2e_fixture_creator", followerCount: 42000, followsCount: 120, mediaCount: 4 });

  const post = (id: string, productType: string, postedMs: number) =>
    db.insert(tables.ownPosts).values({ id, externalId: `x-${id}`, permalink: `https://www.instagram.com/reel/${id}/`, mediaType: "VIDEO", productType, format: productType === "REELS" ? "Reel" : "Carousel", caption: `Fixture ${id}`, postedAt: iso(postedMs), firstSeenAt: iso(postedMs), thumbnailUrl: null });
  const snap = (ownPostId: string, postedMs: number, hour: number, v: Partial<typeof tables.ownPostInsights.$inferInsert>) =>
    db.insert(tables.ownPostInsights).values({ id: `${ownPostId}-h${hour}`, ownPostId, capturedAt: iso(postedMs + hour * H + 5 * 60_000), ...v });
  const full = { views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 42.1 };

  if (variant === "no-reels") {
    await post("c1", "FEED", now - 3 * 24 * H);
    await snap("c1", now - 3 * 24 * H, 1, { reach: 500 });
  } else if (variant === "reach-zero") {
    await post("rz", "REELS", now - 6 * H);
    await snap("rz", now - 6 * H, 5, { ...full, reach: 0 });
  } else {
    // reels, audience-refused: A newest (hours 1, 2, 5), B and C (hours 1, 2), one carousel.
    const A = now - 6 * H, B = now - 3 * 24 * H, C = now - 5 * 24 * H;
    await post("reelA", "REELS", A);
    await post("reelB", "REELS", B);
    await post("reelC", "REELS", C);
    await post("carousel", "FEED", now - 2 * 24 * H);
    await snap("reelA", A, 1, { ...full, views: 20000 });
    await snap("reelA", A, 2, { ...full, views: 60000 });
    await snap("reelA", A, 5, full);
    for (const [id, ms, v] of [["reelB", B, 10000], ["reelC", C, 14000]] as const) {
      await snap(id, ms, 1, { ...full, views: v });
      await snap(id, ms, 2, { ...full, views: v * 2 });
    }
    await snap("carousel", now - 2 * 24 * H, 1, { reach: 800 });
    const at = iso(now - H);
    const row = (id: string, metric: string, dimension: string, key: string, value: number) => ({ id, capturedAt: at, metric, dimension, key, value, timeframe: null });
    await db.insert(tables.ownAccountBreakdowns).values([
      row("b1", "views", "follower_type", "FOLLOWER", 30000), row("b2", "views", "follower_type", "NON_FOLLOWER", 90000),
      ...(variant === "audience-refused" ? [] : [
        row("b3", "engaged_audience_demographics", "age", "25-34", 400), row("b4", "engaged_audience_demographics", "country", "US", 500),
        row("b5", "engaged_audience_demographics", "gender", "F", 600),
      ]),
    ]);
    if (variant === "audience-refused") {
      await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "HTTP 400: not enough engagement" });
    }
  }
  console.log(`mine-seed: ${variant}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
