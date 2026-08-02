import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let insertNotification: typeof import("./store")["insertNotification"];
let listNotifications: typeof import("./store")["listNotifications"];
let unreadCount: typeof import("./store")["unreadCount"];
let markRead: typeof import("./store")["markRead"];
let markAllRead: typeof import("./store")["markAllRead"];

beforeAll(async () => {
  // Must be set before @/server/db (and anything importing it, including
  // ./store) is ever loaded — that module reads CROWSNEST_DB_PATH at import
  // time and defaults to the real "data/crowsnest.db" when unset. A static
  // top-level import here would run against the real dev database instead
  // of an in-memory one. Same pattern as src/server/logs/store.test.ts.
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";

  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ insertNotification, listNotifications, unreadCount, markRead, markAllRead } = await import("./store"));
});

describe("notifications store", () => {
  beforeEach(() => {
    migrate();
    db.delete(tables.notifications).run();
  });

  test("inserts, counts unread, and marks read", () => {
    insertNotification({ kind: "run_failed", runId: "job_x", title: "Sync failed", body: "boom" });
    expect(unreadCount()).toBe(1);
    const [n] = listNotifications();
    markRead(n.id);
    expect(unreadCount()).toBe(0);
  });

  test("markAllRead clears every unread row", () => {
    insertNotification({ kind: "run_failed", runId: "job_x", title: "Sync failed", body: "boom" });
    insertNotification({ kind: "run_finished", runId: "job_y", title: "Sync finished", body: "ok" });
    expect(unreadCount()).toBe(2);
    markAllRead();
    expect(unreadCount()).toBe(0);
  });

  test("listNotifications orders newest first and respects limit", () => {
    insertNotification({ kind: "run_failed", title: "one", body: "b1" });
    insertNotification({ kind: "run_finished", title: "two", body: "b2" });
    insertNotification({ kind: "sla_breach", title: "three", body: "b3" });
    const rows = listNotifications(2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).toEqual(["three", "two"]);
  });

  test("runId defaults to null when not provided", () => {
    insertNotification({ kind: "run_failed", title: "no run", body: "b" });
    const [n] = listNotifications();
    expect(n.runId).toBeNull();
    expect(n.readAt).toBeNull();
  });
});
