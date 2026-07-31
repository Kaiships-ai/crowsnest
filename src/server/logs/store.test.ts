import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let insertLogEvent: typeof import("./store")["insertLogEvent"];
let queryLogEvents: typeof import("./store")["queryLogEvents"];
let redactLogFields: typeof import("./store")["redactLogFields"];
let RETENTION_MAX: typeof import("./store")["RETENTION_MAX"];

beforeAll(async () => {
  // Must be set before @/server/db (and anything importing it, including
  // ./store) is ever loaded — that module reads CROWSNEST_DB_PATH at import
  // time and defaults to the real "data/crowsnest.db" when unset. A static
  // top-level import here would run against the real dev database instead
  // of an in-memory one. Same pattern as src/server/settings/index.test.ts.
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";

  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ insertLogEvent, queryLogEvents, redactLogFields, RETENTION_MAX } = await import("./store"));
});

function make(overrides: Partial<Parameters<typeof insertLogEvent>[0]> = {}) {
  return {
    ts: "2026-07-31T10:00:00.000Z",
    level: "error" as const,
    source: "backend" as const,
    event: "sync.failed",
    fields: { jobId: "j1" },
    ...overrides,
  };
}

describe("log store", () => {
  // migrate() alone doesn't clear rows from a prior test in this same in-memory db
  // (module-level singleton, matches the repo's other beforeEach(migrate + delete)
  // patterns, e.g. src/server/settings/index.test.ts) — clear log_events explicitly
  // so each test starts from an empty table.
  beforeEach(() => {
    migrate();
    db.delete(tables.logEvents).run();
  });

  test("insert then query returns the row with parsed fields", () => {
    insertLogEvent(make());
    const rows = queryLogEvents({ levels: ["error"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("sync.failed");
    expect(rows[0].fields).toEqual({ jobId: "j1" });
  });

  test("problems-only default excludes info", () => {
    insertLogEvent(make({ level: "info", event: "sync.started" }));
    insertLogEvent(make({ level: "error", event: "sync.failed" }));
    const rows = queryLogEvents();
    expect(rows.map((r) => r.event)).toEqual(["sync.failed"]);
  });

  test("source filter", () => {
    insertLogEvent(make({ source: "backend" }));
    insertLogEvent(make({ source: "sidecar" }));
    expect(queryLogEvents({ levels: ["error"], source: "sidecar" })).toHaveLength(1);
  });

  test("free text search matches event and fields", () => {
    insertLogEvent(make({ event: "ig.session.expired", fields: { handle: "@kai" } }));
    expect(queryLogEvents({ levels: ["error"], search: "kai" })).toHaveLength(1);
    expect(queryLogEvents({ levels: ["error"], search: "expired" })).toHaveLength(1);
    expect(queryLogEvents({ levels: ["error"], search: "nope" })).toHaveLength(0);
  });

  test("redactLogFields masks a password", () => {
    expect(redactLogFields({ password: "hunter2", ok: 1 })).toEqual({ password_redacted: true, ok: 1 });
  });

  test("redactLogFields matches keys case-insensitively", () => {
    expect(redactLogFields({ Authorization: "Bearer x", Cookie: "a=b", ok: 1 })).toEqual({
      Authorization_redacted: true,
      Cookie_redacted: true,
      ok: 1,
    });
  });

  test("redactLogFields masks a secret nested one level deep", () => {
    expect(redactLogFields({ req: { headers: { cookie: "a=b" }, ok: 1 } })).toEqual({
      req: { headers: { cookie_redacted: true }, ok: 1 },
    });
  });

  test("redactLogFields masks a secret nested two levels deep", () => {
    expect(redactLogFields({ a: { b: { c: { token: "x", keep: 1 } } } })).toEqual({
      a: { b: { c: { token_redacted: true, keep: 1 } } },
    });
  });

  test("redactLogFields masks a secret inside an array of objects", () => {
    expect(redactLogFields({ list: [{ token: "x" }, { ok: 1 }] })).toEqual({
      list: [{ token_redacted: true }, { ok: 1 }],
    });
  });

  test("redactLogFields masks the newly added sidecar-aligned keys", () => {
    expect(redactLogFields({ verification_code: "123456", ok: 1 })).toEqual({
      verification_code_redacted: true,
      ok: 1,
    });
  });

  test("insert redacts before storing", () => {
    insertLogEvent(make({ fields: { token: "abc", jobId: "j1" } }));
    expect(queryLogEvents({ levels: ["error"] })[0].fields).toEqual({ token_redacted: true, jobId: "j1" });
  });

  test("retention keeps the newest RETENTION_MAX rows", () => {
    for (let i = 0; i < RETENTION_MAX + 5; i++) {
      insertLogEvent(make({ level: "info", event: `e${i}` }));
    }
    const rows = queryLogEvents({ levels: ["info"], limit: RETENTION_MAX + 100 });
    expect(rows.length).toBe(RETENTION_MAX);
    // newest first, so e{max+4} present, e0..e4 pruned
    expect(rows[0].event).toBe(`e${RETENTION_MAX + 4}`);
    expect(rows.some((r) => r.event === "e0")).toBe(false);
  });
});
