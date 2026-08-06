import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let insertLogEvent: typeof import("@/server/logs/store")["insertLogEvent"];
let listRuns: typeof import("./runs")["listRuns"];
let getRun: typeof import("./runs")["getRun"];

beforeAll(async () => {
  // Must be set before @/server/db (and anything importing it) is ever loaded — that
  // module reads CROWSNEST_DB_PATH at import time and defaults to the real
  // "data/crowsnest.db" when unset. Same pattern as src/server/logs/store.test.ts.
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";

  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ insertLogEvent } = await import("@/server/logs/store"));
  ({ listRuns, getRun } = await import("./runs"));
});

beforeEach(() => {
  migrate();
  db.delete(tables.logEvents).run();
  db.delete(tables.remixRuns).run();
  db.delete(tables.remixSessions).run();
  db.delete(tables.videos).run();
  db.delete(tables.channels).run();
  db.delete(tables.syncJobs).run();
});

function seedSyncJob(overrides: Partial<typeof tables.syncJobs.$inferInsert> = {}): string {
  const id = overrides.id ?? newId();
  db.insert(tables.syncJobs)
    .values({
      id,
      channelId: null,
      lockKey: "__library__",
      startedAt: "2026-08-01T10:00:00.000Z",
      finishedAt: "2026-08-01T10:05:00.000Z",
      status: "success",
      itemsSeen: 10,
      itemsCreated: 3,
      itemsUpdated: 2,
      itemsFailed: 0,
      ...overrides,
    })
    .run();
  return id;
}

/** channels -> videos -> remix_sessions, the minimal chain remix_runs.session_id
 *  requires under foreign_keys=ON. Matches seedRemixSession in
 *  src/server/actions/planned-post-actions.test.ts. */
function seedRemixSession(): string {
  const channelId = newId();
  db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@remix-src-${channelId}`, trackedSince: nowIso() }).run();
  const videoId = newId();
  db.insert(tables.videos)
    .values({ id: videoId, channelId, platform: "instagram", externalId: `ext-${videoId}`, url: "https://example.com/post", postedAt: nowIso(), firstSeenAt: nowIso() })
    .run();
  const sessionId = newId();
  db.insert(tables.remixSessions).values({ id: sessionId, sourceVideoId: videoId, stage: "prompt", createdAt: nowIso(), updatedAt: nowIso() }).run();
  return sessionId;
}

function seedRemixRun(overrides: Partial<typeof tables.remixRuns.$inferInsert> = {}): string {
  const id = overrides.id ?? newId();
  const sessionId = overrides.sessionId ?? seedRemixSession();
  db.insert(tables.remixRuns)
    .values({
      id,
      sessionId,
      stage: "hook",
      outcome: "success",
      startedAt: "2026-08-01T09:00:00.000Z",
      finishedAt: "2026-08-01T09:00:03.000Z",
      elapsedMs: 3000,
      detail: "5 hooks generated",
      ...overrides,
    })
    .run();
  return id;
}

describe("listRuns", () => {
  test("returns an empty array on a fresh db", () => {
    expect(listRuns()).toEqual([]);
  });

  test("lists a sync_jobs row as a Run", () => {
    const id = seedSyncJob();
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: id,
      type: "sync",
      title: "Library sync",
      status: "success",
      sub: "3 new, 2 updated",
      itemsCreated: 3,
      itemsUpdated: 2,
    });
  });

  test("a per-channel sync job titles itself from the denormalized channel handle", () => {
    seedSyncJob({ lockKey: "chan_1", channelId: null, currentChannelHandle: "@kai" });
    const [run] = listRuns();
    expect(run.title).toBe("@kai");
  });

  test("a failed sync job's sub is the error message", () => {
    seedSyncJob({ status: "failed", errorMessage: "IG_RATE_LIMITED" });
    const [run] = listRuns();
    expect(run.status).toBe("failed");
    expect(run.sub).toBe("IG_RATE_LIMITED");
  });

  test("lists a remix_runs row as a Run, mapping outcome to status", () => {
    const id = seedRemixRun({ outcome: "error", detail: "generation failed", errorMessage: "boom" });
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: id,
      type: "remix",
      title: "Remix: hook stage",
      status: "failed",
      sub: "generation failed",
      durationMs: 3000,
      channelsDone: null,
      channelsTotal: null,
    });
  });

  test("unifies sync and remix runs sorted newest first", () => {
    const older = seedSyncJob({ startedAt: "2026-08-01T08:00:00.000Z", finishedAt: "2026-08-01T08:05:00.000Z" });
    const newer = seedRemixRun({ startedAt: "2026-08-01T12:00:00.000Z", finishedAt: "2026-08-01T12:00:03.000Z" });
    const runs = listRuns();
    expect(runs.map((r) => r.runId)).toEqual([newer, older]);
  });

  test("respects the limit argument", () => {
    seedSyncJob();
    seedSyncJob();
    seedSyncJob();
    expect(listRuns(2)).toHaveLength(2);
  });

  test("a running run's duration is measured against now, not a null finishedAt", () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    seedSyncJob({ status: "running", finishedAt: null, startedAt });
    const [run] = listRuns();
    expect(run.finishedAt).toBeNull();
    expect(run.durationMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe("getRun", () => {
  test("returns null for an id that matches neither table", () => {
    expect(getRun("nope")).toBeNull();
  });

  test("finds a sync job by id and attaches its log events", () => {
    const id = seedSyncJob();
    insertLogEvent({ ts: "2026-08-01T10:01:00.000Z", level: "info", source: "backend", event: "sync.started", fields: {}, runId: id });
    insertLogEvent({ ts: "2026-08-01T10:02:00.000Z", level: "info", source: "backend", event: "unrelated", fields: {} });

    const detail = getRun(id);
    expect(detail).not.toBeNull();
    expect(detail!.runId).toBe(id);
    expect(detail!.events).toHaveLength(1);
    expect(detail!.events[0].event).toBe("sync.started");
  });

  test("finds a remix run by id with an empty events array when none are attached", () => {
    const id = seedRemixRun();
    const detail = getRun(id);
    expect(detail).not.toBeNull();
    expect(detail!.type).toBe("remix");
    expect(detail!.events).toEqual([]);
  });

  test("attaches events bridged from fields.jobId, not just an explicit runId", () => {
    const id = seedSyncJob();
    insertLogEvent({ ts: "2026-08-01T10:01:00.000Z", level: "error", source: "backend", event: "sync.failed", fields: { jobId: id } });

    const detail = getRun(id);
    expect(detail!.events).toHaveLength(1);
    expect(detail!.events[0].event).toBe("sync.failed");
  });
});

describe("getRun — itemsEnriched (M5-U1)", () => {
  // "A run reports how many it enriched." Read off the sync.enrich.finished events the
  // pass already emits, which carry a run_id now, so there is no new column and no
  // migration. One event per channel, so a library sync sums across them.
  function enrichEvent(runId: string, enriched: number, over: Record<string, unknown> = {}) {
    insertLogEvent({
      ts: "2026-08-01T10:02:00.000Z",
      level: "info",
      source: "backend",
      event: "sync.enrich.finished",
      fields: { channelId: "c1", handle: "@x", candidates: enriched, enriched, skipped: 0, withheld: 0, stopped: false, ...over },
      runId,
    });
  }

  test("sums the enriched counts across a run's channels", () => {
    const id = seedSyncJob();
    enrichEvent(id, 12);
    enrichEvent(id, 5, { channelId: "c2" });

    expect(getRun(id)!.itemsEnriched).toBe(17);
  });

  test("is null when the pass never ran, and 0 when it ran and wrote nothing", () => {
    // The distinction this codebase keeps everywhere else: a missing measurement is not a
    // measured zero. No event means the knob was off or the run was cancelled before the
    // pass; an event with enriched 0 means it asked and Instagram withheld every count.
    const off = seedSyncJob();
    expect(getRun(off)!.itemsEnriched).toBeNull();

    const ranEmpty = seedSyncJob();
    enrichEvent(ranEmpty, 0, { withheld: 4, candidates: 4 });
    expect(getRun(ranEmpty)!.itemsEnriched).toBe(0);
  });

  test("ignores another run's enrichment events", () => {
    const mine = seedSyncJob();
    const theirs = seedSyncJob();
    enrichEvent(theirs, 9);

    expect(getRun(mine)!.itemsEnriched).toBeNull();
    expect(getRun(theirs)!.itemsEnriched).toBe(9);
  });

  test("a remix run never reports an enriched count", () => {
    const id = seedRemixRun();
    expect(getRun(id)!.itemsEnriched).toBeNull();
  });
});
