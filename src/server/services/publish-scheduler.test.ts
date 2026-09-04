import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Self-check for the publish scheduler (implementation plan Phase C, task C1). Most
 * behaviour is proven against injected fakes (a fake clock's `now`, a fake `publish`,
 * fake db-shaped selects/claims) — no network, no real db. The one exception is the
 * double-publish race: that is proven against a REAL better-sqlite3 db (same pattern as
 * planned-posts.test.ts) because the atomic claim's guarantee lives entirely in what
 * SQLite's `UPDATE ... WHERE state='scheduled'` actually returns, which a fake cannot
 * stand in for without just re-asserting the implementation.
 */

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let runDuePublishes: typeof import("./publish-scheduler")["runDuePublishes"];
let startPublishScheduler: typeof import("./publish-scheduler")["startPublishScheduler"];
let defaultBackoffMs: typeof import("./publish-scheduler")["defaultBackoffMs"];
let DEFAULT_MAX_ATTEMPTS: typeof import("./publish-scheduler")["DEFAULT_MAX_ATTEMPTS"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ runDuePublishes, startPublishScheduler, defaultBackoffMs, DEFAULT_MAX_ATTEMPTS } = await import("./publish-scheduler"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
});

function iso(offsetMs: number, base = Date.UTC(2026, 0, 1)): string {
  return new Date(base + offsetMs).toISOString();
}

async function seedPlan(overrides: Partial<typeof tables.plannedPosts.$inferInsert> = {}): Promise<string> {
  const id = newId();
  await db.insert(tables.plannedPosts).values({
    id,
    state: "draft",
    title: "A plan",
    createdAt: iso(0),
    updatedAt: iso(0),
    attemptCount: 0,
    dryRun: 0,
    ...overrides,
  });
  return id;
}

// ---------------------------------------------------------------- fake-deps tests

describe("runDuePublishes (fake deps)", () => {
  test("a due scheduled row is claimed and published exactly once", async () => {
    const publish = vi.fn(async () => ({ ok: true, state: "published" as const }));
    const result = await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: vi.fn(async () => [{ id: "p1" }]),
      claim: vi.fn(async () => true),
      publish,
      selectRetryableFailed: vi.fn(async () => []),
      rearmForRetry: vi.fn(),
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith("p1");
    expect(result).toEqual({ claimed: 1, published: 1, failed: 0 });
  });

  test("a not-yet-due row is never selected, so it is never claimed or published", async () => {
    const selectDueScheduled = vi.fn(async () => []); // the query itself excludes scheduledAt > now
    const claim = vi.fn(async () => true);
    const publish = vi.fn(async () => ({ ok: true, state: "published" as const }));

    const result = await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled,
      claim,
      publish,
      selectRetryableFailed: vi.fn(async () => []),
      rearmForRetry: vi.fn(),
    });

    expect(claim).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0 });
  });

  test("a claim that returns false (already taken by another tick) is skipped, not published", async () => {
    const publish = vi.fn(async () => ({ ok: true, state: "published" as const }));
    const result = await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: vi.fn(async () => [{ id: "p1" }]),
      claim: vi.fn(async () => false),
      publish,
      selectRetryableFailed: vi.fn(async () => []),
      rearmForRetry: vi.fn(),
    });

    expect(publish).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0 });
  });

  test("a failed row under MAX_ATTEMPTS is re-armed to scheduled with a backed-off scheduledAt", async () => {
    const rearmForRetry = vi.fn(async (_id: string, _scheduledAt: string) => {});
    const now = new Date(iso(0));

    await runDuePublishes(now, {
      selectDueScheduled: vi.fn(async () => []),
      claim: vi.fn(),
      publish: vi.fn(),
      selectRetryableFailed: vi.fn(async (maxAttempts: number) => {
        expect(maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
        return [{ id: "failed_1", attemptCount: 1 }];
      }),
      rearmForRetry,
    });

    expect(rearmForRetry).toHaveBeenCalledTimes(1);
    const [id, scheduledAt] = rearmForRetry.mock.calls[0];
    expect(id).toBe("failed_1");
    expect(new Date(scheduledAt).getTime() - now.getTime()).toBe(defaultBackoffMs(1));
  });

  test("a row at MAX_ATTEMPTS is not selected for retry (stays failed, terminal)", async () => {
    // The default selectRetryableFailed's own WHERE clause is what enforces this against
    // the real db (proven below); here we prove the tick honours whatever the selector
    // returns, i.e. a selector that correctly excludes maxed-out rows yields no re-arm.
    const rearmForRetry = vi.fn(async () => {});
    await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: vi.fn(async () => []),
      claim: vi.fn(),
      publish: vi.fn(),
      selectRetryableFailed: vi.fn(async () => []), // maxed-out row correctly excluded
      rearmForRetry,
    });
    expect(rearmForRetry).not.toHaveBeenCalled();
  });

  test("a publish that throws does not kill the tick; other rows still process", async () => {
    const publish = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("boom");
      return { ok: true, state: "published" as const };
    });

    const result = await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: vi.fn(async () => [{ id: "bad" }, { id: "good" }]),
      claim: vi.fn(async () => true),
      publish,
      selectRetryableFailed: vi.fn(async () => []),
      rearmForRetry: vi.fn(),
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ claimed: 2, published: 1, failed: 1 });
  });

  test("a failing candidate select does not throw out of the tick; resolves with zeros", async () => {
    const result = await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(result).toEqual({ claimed: 0, published: 0, failed: 0 });
  });
});

describe("startPublishScheduler reentrancy guard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("a tick still in flight causes the next interval fire to be skipped", async () => {
    let resolveSelect!: (rows: { id: string }[]) => void;
    const selectDueScheduled = vi.fn(
      () =>
        new Promise<{ id: string }[]>((resolve) => {
          resolveSelect = resolve;
        })
    );

    const stop = startPublishScheduler({
      intervalMs: 1000,
      selectDueScheduled,
      claim: vi.fn(async () => true),
      publish: vi.fn(async () => ({ ok: true, state: "published" as const })),
      selectRetryableFailed: vi.fn(async () => []),
      rearmForRetry: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(selectDueScheduled).toHaveBeenCalledTimes(1); // first tick started, still pending

    await vi.advanceTimersByTimeAsync(1000);
    expect(selectDueScheduled).toHaveBeenCalledTimes(1); // second fire skipped: guard held

    resolveSelect([]);
    await vi.advanceTimersByTimeAsync(0); // let the in-flight tick actually finish

    await vi.advanceTimersByTimeAsync(1000);
    expect(selectDueScheduled).toHaveBeenCalledTimes(2); // guard released, next tick ran

    stop();
  });
});

// ---------------------------------------------------------------- real-db proof

describe("the atomic claim (real db)", () => {
  test("no double publish: two ticks racing the same due row — the claim UPDATE returns 1 row for the first caller and 0 for the second, so publish runs exactly once", async () => {
    const id = await seedPlan({ state: "scheduled", scheduledAt: iso(-1000), videoAssetId: null });

    const publish = vi.fn(async () => ({ ok: true, state: "published" as const }));
    const now = new Date(iso(0));

    // Simulate two overlapping ticks by running two full runDuePublishes calls against
    // the SAME real db, both against the same due row, with the real default claim
    // (undefined override = the module's defaultClaim, i.e. the real
    // `UPDATE ... WHERE state='scheduled'`). Running them sequentially still proves the
    // guarantee: the second tick's claim must see the row already moved to
    // "publishing" and get changes=0, exactly as it would on a genuinely concurrent
    // second tick.
    const [r1, r2] = await Promise.all([
      runDuePublishes(now, { publish, selectRetryableFailed: async () => [], rearmForRetry: async () => {} }),
      runDuePublishes(now, { publish, selectRetryableFailed: async () => [], rearmForRetry: async () => {} }),
    ]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(id);
    expect(r1.claimed + r2.claimed).toBe(1);
  });

  test("selectDueScheduled excludes a not-yet-due row and includes a due one, oldest first", async () => {
    const future = await seedPlan({ state: "scheduled", scheduledAt: iso(60_000) });
    const dueOld = await seedPlan({ state: "scheduled", scheduledAt: iso(-60_000) });
    const dueNew = await seedPlan({ state: "scheduled", scheduledAt: iso(-1_000) });

    const publish = vi.fn(async (_id: string) => ({ ok: true, state: "published" as const }));
    const result = await runDuePublishes(new Date(iso(0)), {
      publish,
      selectRetryableFailed: async () => [],
      rearmForRetry: async () => {},
    });

    expect(result.claimed).toBe(2);
    const calledIds = publish.mock.calls.map((c) => c[0]);
    expect(calledIds).toEqual([dueOld, dueNew]); // oldest scheduledAt first
    expect(calledIds).not.toContain(future);
  });

  test("real selectRetryableFailed excludes a row already at MAX_ATTEMPTS", async () => {
    const retryable = await seedPlan({ state: "failed", attemptCount: DEFAULT_MAX_ATTEMPTS - 1, errorClass: "rate_limit" });
    const maxedOut = await seedPlan({ state: "failed", attemptCount: DEFAULT_MAX_ATTEMPTS, errorClass: "rate_limit" });

    const rearmForRetry = vi.fn(async (_id: string) => {});
    await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: async () => [],
      claim: async () => false,
      publish: vi.fn(),
      rearmForRetry,
    });

    expect(rearmForRetry).toHaveBeenCalledTimes(1);
    expect(rearmForRetry.mock.calls[0][0]).toBe(retryable);
    expect(rearmForRetry.mock.calls.map((c) => c[0])).not.toContain(maxedOut);
  });

  test("real rearmForRetry flips the row back to scheduled with the backed-off scheduledAt", async () => {
    const id = await seedPlan({ state: "failed", attemptCount: 1, errorClass: "rate_limit" });
    const now = new Date(iso(0));

    await runDuePublishes(now, {
      selectDueScheduled: async () => [],
      claim: async () => false,
      publish: vi.fn(),
    });

    const [reloaded] = await db.select().from(tables.plannedPosts);
    expect(reloaded.id).toBe(id);
    expect(reloaded.state).toBe("scheduled");
    expect(new Date(reloaded.scheduledAt!).getTime() - now.getTime()).toBe(defaultBackoffMs(1));
  });

  test("real selectRetryableFailed excludes a permanent failure (non-retryable errorClass)", async () => {
    const permanent = await seedPlan({ state: "failed", attemptCount: 1, errorClass: "no_video" });

    const rearmForRetry = vi.fn(async (_id: string) => {});
    await runDuePublishes(new Date(iso(0)), {
      selectDueScheduled: async () => [],
      claim: async () => false,
      publish: vi.fn(),
      rearmForRetry,
    });

    expect(rearmForRetry).not.toHaveBeenCalled();
    const [row] = await db.select().from(tables.plannedPosts);
    expect(row.id).toBe(permanent);
    expect(row.state).toBe("failed"); // stays terminal, no backoff budget burned
  });
});
