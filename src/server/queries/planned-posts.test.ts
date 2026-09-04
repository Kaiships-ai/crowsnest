import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getPlannedPosts: typeof import("./planned-posts")["getPlannedPosts"];
let getCalendarMonth: typeof import("./planned-posts")["getCalendarMonth"];
let scriptExists: typeof import("./planned-posts")["scriptExists"];
let getPlansCarryingScript: typeof import("./planned-posts")["getPlansCarryingScript"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // getPostsWithLatestInsights (own-channel.ts) pulls in graph/client.ts -> config.ts,
  // which validates the full env schema at import time.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getPlannedPosts, getCalendarMonth, scriptExists, getPlansCarryingScript } = await import("./planned-posts"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
  await db.delete(tables.scripts);
  await db.delete(tables.ownPostInsights);
  await db.delete(tables.ownPosts);
  await db.delete(tables.ownAccountSnapshots);
});

function dateOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function tsAt(minutesAgo: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minutesAgo)).toISOString();
}

async function seedScript(content = "HOOK: ...\nBUILD: ...\nCTA: ..."): Promise<string> {
  const id = newId();
  await db.insert(tables.scripts).values({ id, title: "A Script", content, status: "draft", createdAt: nowIso(), updatedAt: nowIso() });
  return id;
}

describe("getPlannedPosts", () => {
  test("empty planner returns an empty array", async () => {
    expect(await getPlannedPosts()).toEqual([]);
  });

  test("a scheduled plan whose date is in the past reads as missed, computed on read", async () => {
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "scheduled", title: "Blew this one", plannedDate: dateOffset(-5), createdAt: nowIso(), updatedAt: nowIso(),
    });

    const [row] = await getPlannedPosts();
    expect(row.state).toBe("missed");

    // The stored column itself is never rewritten to "missed" — only the read-time
    // state is. schema.ts's comment on plannedPosts.state is explicit that "missed" is
    // never one of the two values actually persisted.
    const [stored] = await db.select({ state: tables.plannedPosts.state }).from(tables.plannedPosts);
    expect(stored.state).toBe("scheduled");
  });

  test("a publishing plan surfaces as publishing, never re-derived to missed, even with a past plannedDate", async () => {
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "publishing", title: "Mid-publish", plannedDate: dateOffset(-5), createdAt: nowIso(), updatedAt: nowIso(),
    });
    const [row] = await getPlannedPosts();
    expect(row.state).toBe("publishing");
  });

  test("a failed plan surfaces as failed, never re-derived to missed, even with a past plannedDate", async () => {
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "failed", title: "Blew up", plannedDate: dateOffset(-5), lastError: "container timeout", errorClass: "timeout", attemptCount: 3, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const [row] = await getPlannedPosts();
    expect(row.state).toBe("failed");
    expect(row.lastError).toBe("container timeout");
    expect(row.errorClass).toBe("timeout");
    expect(row.attemptCount).toBe(3);
  });

  test("the new publish-lifecycle columns map through toRow", async () => {
    const assetId = newId();
    await db.insert(tables.mediaAssets).values({
      id: assetId, sha256: "a".repeat(64), kind: "video", contentType: "video/mp4", byteSize: 1024, storagePath: "videos/a.mp4", downloadedAt: nowIso(),
    });
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "scheduled", title: "Ready to go", videoAssetId: assetId, caption: "a caption", scheduledAt: "2026-03-15T09:00:00.000Z", publishedAt: null, dryRun: 1, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const [row] = await getPlannedPosts();
    expect(row.videoAssetId).toBe(assetId);
    expect(row.caption).toBe("a caption");
    expect(row.scheduledAt).toBe("2026-03-15T09:00:00.000Z");
    expect(row.dryRun).toBe(true);
    expect(row.publishedAt).toBeNull();
    expect(row.attemptCount).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.errorClass).toBeNull();
  });

  test("a scheduled plan whose date is in the future stays scheduled", async () => {
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "scheduled", title: "Upcoming", plannedDate: dateOffset(5), createdAt: nowIso(), updatedAt: nowIso(),
    });
    const [row] = await getPlannedPosts();
    expect(row.state).toBe("scheduled");
  });

  test("an undated draft stays draft regardless of range, and always appears", async () => {
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "draft", title: "Someday", plannedDate: null, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const rows = await getPlannedPosts({ from: "2099-01-01", to: "2099-01-31" });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("draft");
  });

  test("range filters out plans dated outside it, but never an undated draft", async () => {
    await db.insert(tables.plannedPosts).values([
      { id: newId(), state: "scheduled", title: "In range", plannedDate: "2026-03-15", createdAt: tsAt(0), updatedAt: tsAt(0) },
      { id: newId(), state: "scheduled", title: "Out of range", plannedDate: "2026-05-01", createdAt: tsAt(1), updatedAt: tsAt(1) },
      { id: newId(), state: "draft", title: "Undated", plannedDate: null, createdAt: tsAt(2), updatedAt: tsAt(2) },
    ]);

    const rows = await getPlannedPosts({ from: "2026-03-01", to: "2026-03-31" });
    expect(rows.map((r) => r.title).sort()).toEqual(["In range", "Undated"]);
  });

  test("a plan carrying a script denormalizes its title, content length, and full content", async () => {
    const scriptId = await seedScript("0123456789"); // 10 chars
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "draft", title: "With script", scriptId, createdAt: nowIso(), updatedAt: nowIso(),
    });

    const [row] = await getPlannedPosts();
    expect(row.scriptTitle).toBe("A Script");
    expect(row.scriptLengthChars).toBe(10);
    expect(row.scriptContent).toBe("0123456789");
  });

  test("a plan with no script has null scriptTitle/scriptLengthChars/scriptContent, not a crash", async () => {
    await db.insert(tables.plannedPosts).values({ id: newId(), state: "draft", title: "No script", createdAt: nowIso(), updatedAt: nowIso() });
    const [row] = await getPlannedPosts();
    expect(row.scriptTitle).toBeNull();
    expect(row.scriptLengthChars).toBeNull();
    expect(row.scriptContent).toBeNull();
  });

  test("reconciledOwnPostId is set when an own post exists on the plan's date and nothing has been marked published by hand", async () => {
    const ownPostId = newId();
    await db.insert(tables.ownPosts).values({
      id: ownPostId, externalId: `ext-${ownPostId}`, permalink: "https://instagram.com/p/x", mediaType: "VIDEO", format: "Reel",
      postedAt: `${dateOffset(-1)}T12:00:00.000Z`, firstSeenAt: nowIso(),
    });
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "scheduled", title: "Maybe went out", plannedDate: dateOffset(-1), createdAt: nowIso(), updatedAt: nowIso(),
    });

    const [row] = await getPlannedPosts();
    expect(row.reconciledOwnPostId).toBe(ownPostId);
    // Reconciliation is a hint, never a write — publishedOwnPostId stays null until a
    // human confirms it via markPlanPublishedAction.
    expect(row.publishedOwnPostId).toBeNull();
  });

  test("reconciledOwnPostId is null once a plan has already been marked published by hand", async () => {
    const ownPostId = newId();
    await db.insert(tables.ownPosts).values({
      id: ownPostId, externalId: `ext-${ownPostId}`, permalink: "https://instagram.com/p/y", mediaType: "VIDEO", format: "Reel",
      postedAt: `${dateOffset(-1)}T12:00:00.000Z`, firstSeenAt: nowIso(),
    });
    await db.insert(tables.plannedPosts).values({
      id: newId(), state: "scheduled", title: "Confirmed", plannedDate: dateOffset(-1), publishedOwnPostId: ownPostId, createdAt: nowIso(), updatedAt: nowIso(),
    });

    const [row] = await getPlannedPosts();
    expect(row.reconciledOwnPostId).toBeNull();
  });
});

describe("getCalendarMonth", () => {
  test("no plans and no measurement yet: empty published, empty plans, measuredAt null", async () => {
    const month = await getCalendarMonth("2026-06");
    expect(month.published).toEqual([]);
    expect(month.plans).toEqual([]);
    expect(month.measuredAt).toBeNull();
  });

  test("published cells come from own_posts within the month, with reach from the latest insights row", async () => {
    await db.insert(tables.ownAccountSnapshots).values({ id: newId(), capturedAt: tsAt(0), externalId: "acct", username: "kai" });
    const ownPostId = newId();
    await db.insert(tables.ownPosts).values({
      id: ownPostId, externalId: `ext-${ownPostId}`, permalink: "https://instagram.com/p/z", mediaType: "VIDEO", format: "Reel",
      caption: "a real post", postedAt: "2026-06-10T12:00:00.000Z", firstSeenAt: tsAt(0),
    });
    await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: tsAt(0), reach: 4200 });

    const month = await getCalendarMonth("2026-06");
    expect(month.published).toEqual([{ ownPostId, date: "2026-06-10", reach: 4200, title: "a real post" }]);
    expect(month.measuredAt).not.toBeNull();
  });

  test("dead air is a run of 3+ elapsed days with nothing published, and never extends into the future", async () => {
    // A month entirely in the past relative to "today" — every elapsed day qualifies,
    // giving one dead-air run spanning the whole month.
    const month = await getCalendarMonth("2020-02");
    expect(month.deadAir).toHaveLength(1);
    expect(month.deadAir[0].days).toBe(29); // 2020 is a leap year
  });
});

describe("scriptExists / getPlansCarryingScript", () => {
  test("scriptExists is true only for a real script id", async () => {
    const scriptId = await seedScript();
    expect(await scriptExists(scriptId)).toBe(true);
    expect(await scriptExists("does-not-exist")).toBe(false);
  });

  test("getPlansCarryingScript names every plan referencing a script", async () => {
    const scriptId = await seedScript();
    const otherScript = await seedScript();
    await db.insert(tables.plannedPosts).values([
      { id: newId(), state: "draft", title: "Carries it", scriptId, createdAt: tsAt(0), updatedAt: tsAt(0) },
      { id: newId(), state: "draft", title: "Carries a different one", scriptId: otherScript, createdAt: tsAt(1), updatedAt: tsAt(1) },
    ]);

    const plans = await getPlansCarryingScript(scriptId);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("Carries it");
  });
});
