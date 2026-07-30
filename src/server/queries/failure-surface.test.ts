import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";

// Same in-memory DB + migrate pattern as channels.test.ts / sync-actions.test.ts.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getFailureStrip: typeof import("./failure-surface")["getFailureStrip"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getFailureStrip } = await import("./failure-surface"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.syncJobs);
});

/** Fully-populated-enough job row; every field the query reads can be overridden. */
async function seedJob(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? newId();
  await db.insert(tables.syncJobs).values({
    id,
    channelId: null,
    lockKey: id,
    startedAt: nowIso(),
    status: "success",
    ...overrides,
  } as typeof tables.syncJobs.$inferInsert);
  return id;
}

/**
 * Writes raw text straight into `gaps`/`stats`, bypassing drizzle's JSON-mode encoder.
 * Mirrors the trick `sync-actions.test.ts` already uses for the same reason: it is the
 * only way to put a truly malformed (or deliberately pre-widened) blob in the column,
 * and it is what actually exercises the raw-text read path `getFailureStrip` uses.
 */
async function setRaw(jobId: string, column: "gaps" | "stats", raw: string) {
  if (column === "gaps") {
    await db.run(sql`update sync_jobs set gaps = ${raw} where id = ${jobId}`);
  } else {
    await db.run(sql`update sync_jobs set stats = ${raw} where id = ${jobId}`);
  }
}

async function setGaps(jobId: string, gaps: Record<string, unknown>[]) {
  await setRaw(jobId, "gaps", JSON.stringify(gaps));
}

async function setStats(jobId: string, stats: Record<string, unknown>) {
  await setRaw(jobId, "stats", JSON.stringify(stats));
}

describe("getFailureStrip — no history", () => {
  test("no sync_jobs row at all renders as none, not a fabricated failure", async () => {
    const strip = await getFailureStrip();
    expect(strip).toEqual({
      kind: "none",
      jobId: null,
      isRunning: false,
      finishedAt: null,
      stopReason: null,
      errorCode: null,
      errorMessage: null,
      cooldownRetryAfterSec: null,
      kept: null,
      gaps: [],
    });
  });
});

describe("getFailureStrip — running", () => {
  test("a running job hides behind kind 'running' rather than exposing its half-written counters", async () => {
    const jobId = await seedJob({ status: "running", itemsCreated: 3, errorCode: "IG_RATE_LIMITED" });

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("running");
    expect(strip.isRunning).toBe(true);
    expect(strip.jobId).toBe(jobId);
    // Nothing about the in-flight row's own counters or error leaks through — those
    // belong to sync-progress-panel, not this strip.
    expect(strip.errorCode).toBeNull();
    expect(strip.gaps).toEqual([]);
    expect(strip.kept).toBeNull();
  });
});

describe("getFailureStrip — clean success", () => {
  test("a success with no gaps is kind 'none', but still reports what the run kept", async () => {
    const jobId = await seedJob({ status: "success", itemsCreated: 5, itemsUpdated: 12, channelsTotal: 3 });
    await setStats(jobId, { channels: 3, videos: 17 });

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("none");
    expect(strip.errorCode).toBeNull();
    expect(strip.gaps).toEqual([]);
    expect(strip.kept).toEqual({ itemsCreated: 5, itemsUpdated: 12, channelsSynced: 3, channelsTotal: 3 });
  });
});

describe("getFailureStrip — plain partial", () => {
  test("a partial run whose only gap is channel-specific (not connection-level) stays 'partial'", async () => {
    const jobId = await seedJob({ status: "partial", stopReason: "error", itemsCreated: 2, itemsUpdated: 1, channelsTotal: 2 });
    await setStats(jobId, { channels: 1, videos: 3 });
    await setGaps(jobId, [{ channelId: "c1", handle: "@deadacct", provider: "instagrapi", error: "account is private", code: "IG_PRIVATE" }]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("partial");
    expect(strip.errorCode).toBeNull();
    expect(strip.gaps).toEqual([{ channelId: "c1", handle: "@deadacct", error: "account is private", code: "IG_PRIVATE" }]);
    expect(strip.kept?.channelsSynced).toBe(1);
  });
});

describe("getFailureStrip — cooldown must never blame one channel", () => {
  test("a partial run where ONE channel's gap is IG_RATE_LIMITED is a cooldown, not a partial", async () => {
    // Two channels attempted, one succeeded, one hit a rate limit whose retry ladder
    // ran out. Per CONTEXT.md, Cooldown is account wide and applies to the Burner, not
    // to the one channel that happened to surface it — the strip must say so.
    const jobId = await seedJob({ status: "partial", stopReason: "error", channelsTotal: 2 });
    await setStats(jobId, { channels: 1, videos: 4 });
    await setGaps(jobId, [
      { channelId: "c2", handle: "@throttled", provider: "instagrapi", error: "please wait a few minutes", code: "IG_RATE_LIMITED", retryAfterSec: 42 },
    ]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("cooldown");
    expect(strip.errorCode).toBe("IG_RATE_LIMITED");
    expect(strip.cooldownRetryAfterSec).toBe(42);
    // The gap is still visible in full (a real screen needs to say which channel didn't
    // get covered) — what changes is the STRIP'S OWN verdict, not the gap list.
    expect(strip.gaps).toEqual([{ channelId: "c2", handle: "@throttled", error: "please wait a few minutes", code: "IG_RATE_LIMITED" }]);
  });

  test("a cooldown with no Instagram-supplied wait reports no countdown rather than guessing one", async () => {
    const jobId = await seedJob({ status: "partial" });
    await setGaps(jobId, [{ channelId: "c1", handle: "@a", provider: "instagrapi", error: "rate limited", code: "IG_RATE_LIMITED" }]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("cooldown");
    expect(strip.cooldownRetryAfterSec).toBeNull();
  });

  test("every channel failing on IG_RATE_LIMITED (job-level errorCode set) is still classified 'cooldown'", async () => {
    const jobId = await seedJob({ status: "failed", errorCode: "IG_RATE_LIMITED", errorMessage: "please wait a few minutes" });
    await setGaps(jobId, [
      { channelId: "c1", handle: "@a", provider: "instagrapi", error: "please wait a few minutes", code: "IG_RATE_LIMITED", retryAfterSec: 60 },
    ]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("cooldown");
    expect(strip.cooldownRetryAfterSec).toBe(60);
  });
});

describe("getFailureStrip — connection-level states outrank a plain partial", () => {
  test("one IG_SERVICE_DOWN gap among otherwise-unrelated gaps makes the whole strip 'service_down'", async () => {
    const jobId = await seedJob({ status: "partial" });
    await setGaps(jobId, [
      { channelId: "c1", handle: "@notfound", provider: "instagrapi", error: "gone", code: "IG_NOT_FOUND" },
      { channelId: "c2", handle: "@sidecar", provider: "instagrapi", error: "ECONNREFUSED", code: "IG_SERVICE_DOWN" },
    ]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("service_down");
    expect(strip.errorCode).toBe("IG_SERVICE_DOWN");
  });

  test("IG_AUTH_REQUIRED classifies as session_expired", async () => {
    const jobId = await seedJob({ status: "failed", errorCode: "IG_AUTH_REQUIRED", errorMessage: "session expired" });
    await setGaps(jobId, [{ channelId: "c1", handle: "@a", provider: "instagrapi", error: "session expired", code: "IG_AUTH_REQUIRED" }]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("session_expired");
    expect(strip.errorCode).toBe("IG_AUTH_REQUIRED");
  });

  test("IG_NETWORK classifies as offline", async () => {
    const jobId = await seedJob({ status: "partial" });
    await setGaps(jobId, [{ channelId: "c1", handle: "@a", provider: "instagrapi", error: "connection reset", code: "IG_NETWORK" }]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("offline");
  });

  test("a total failure on a channel-specific code (not connection-level) is 'failed', not 'partial'", async () => {
    const jobId = await seedJob({ status: "failed", errorCode: "IG_NOT_FOUND", errorMessage: "account no longer exists" });
    await setGaps(jobId, [{ channelId: "c1", handle: "@gone", provider: "instagrapi", error: "account no longer exists", code: "IG_NOT_FOUND" }]);

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("failed");
    expect(strip.errorCode).toBe("IG_NOT_FOUND");
  });
});

describe("getFailureStrip — malformed data degrades, never throws", () => {
  test("unparseable gaps JSON is treated as no gaps", async () => {
    const jobId = await seedJob({ status: "partial" });
    await setRaw(jobId, "gaps", "{not json");

    const strip = await getFailureStrip();

    expect(strip.gaps).toEqual([]);
    // No connection-level code survives an unparseable blob, so with no other gaps this
    // is a plain partial rather than a crash.
    expect(strip.kind).toBe("partial");
  });

  test("unparseable stats JSON reports channelsSynced as null, not zero", async () => {
    const jobId = await seedJob({ status: "success" });
    await setRaw(jobId, "stats", "{not json");

    const strip = await getFailureStrip();

    expect(strip.kept?.channelsSynced).toBeNull();
  });

  test("a gap missing channelId is dropped rather than rendered unnamed", async () => {
    const jobId = await seedJob({ status: "partial" });
    await setGaps(jobId, [{ handle: "@a", error: "x", code: "IG_PRIVATE" }]);

    const strip = await getFailureStrip();

    expect(strip.gaps).toEqual([]);
  });
});

describe("getFailureStrip — stopReason always passes through", () => {
  test("a cancelled-but-successful run still reports stopReason so the caller can say so", async () => {
    await seedJob({ status: "success", stopReason: "cancelled" });

    const strip = await getFailureStrip();

    expect(strip.kind).toBe("none");
    expect(strip.stopReason).toBe("cancelled");
  });
});
