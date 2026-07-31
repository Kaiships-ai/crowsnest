import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Test-DB pattern (see src/server/queries/feed.test.ts / src/server/settings/index.test.ts):
// the db singleton binds CROWSNEST_DB_PATH at import, so env must be set in beforeAll
// BEFORE any dynamic import of "@/server/db" (or anything that imports it, including
// "@/server/logs/store" and this file's own "./logger") — a plain top-of-file static
// import runs before any code on the line above it, so it would silently hit the real
// data/crowsnest.db instead of an in-memory one.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let store: typeof import("@/server/logs/store");
let queryLogEvents: typeof import("@/server/logs/store")["queryLogEvents"];
let log: typeof import("./logger")["log"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  store = await import("@/server/logs/store");
  ({ queryLogEvents } = store);
  ({ log } = await import("./logger"));
});

describe("logger db sink", () => {
  // migrate() alone doesn't clear rows from a prior test in this same in-memory db
  // (module-level singleton, matches src/server/logs/store.test.ts and
  // src/server/settings/index.test.ts) — clear log_events explicitly so each test
  // starts from an empty table.
  beforeEach(() => {
    migrate();
    db.delete(tables.logEvents).run();
  });

  test("error is written as a row", () => {
    log.error("sync.failed", { jobId: "j9" });
    const rows = queryLogEvents({ levels: ["error"] });
    expect(rows.some((r) => r.event === "sync.failed" && r.source === "backend")).toBe(true);
  });

  test("debug is not written", () => {
    log.debug("noise", { a: 1 });
    expect(queryLogEvents({ levels: ["info", "warn", "error"], limit: 1000 })).toHaveLength(0);
  });

  test("a db failure does not throw out of log.error", () => {
    const spy = vi.spyOn(store, "insertLogEvent").mockImplementation(() => {
      throw new Error("db down");
    });
    expect(() => log.error("still.fine", {})).not.toThrow();
    spy.mockRestore();
  });
});
