import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let createSavedViewAction: typeof import("./saved-view-actions")["createSavedViewAction"];
let renameSavedViewAction: typeof import("./saved-view-actions")["renameSavedViewAction"];
let deleteSavedViewAction: typeof import("./saved-view-actions")["deleteSavedViewAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ createSavedViewAction, renameSavedViewAction, deleteSavedViewAction } = await import("./saved-view-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.savedFilters);
});

/** Mirrors what bootstrap.ts actually inserts, not a call to bootstrapSystemFilters —
 *  these tests only need the two rows to exist and be marked isSystem, not the
 *  idempotent-install behavior that function's own test already covers. */
async function seedSystemFilter(name: string): Promise<string> {
  const id = newId();
  await db.insert(tables.savedFilters).values({ id, name, criteria: { minScore: 5 }, isSystem: true });
  return id;
}

async function seedUserFilter(name = "My view"): Promise<string> {
  const id = newId();
  await db.insert(tables.savedFilters).values({ id, name, criteria: { minScore: 3 }, isSystem: false });
  return id;
}

describe("createSavedViewAction", () => {
  test("writes a new, non-system row with the given name and criteria", async () => {
    const result = await createSavedViewAction({ name: "My saved view", criteria: { minScore: 8, sinceDays: 7 } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const [row] = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.id, result.id));
    expect(row.name).toBe("My saved view");
    expect(row.criteria).toEqual({ minScore: 8, sinceDays: 7 });
    expect(row.isSystem).toBe(false);
  });

  test("refuses a blank name rather than saving an unlabeled view", async () => {
    const result = await createSavedViewAction({ name: "   ", criteria: {} });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_NAME_REQUIRED" });

    const rows = await db.select().from(tables.savedFilters);
    expect(rows).toHaveLength(0);
  });

  test("never produces a third system row — created views are always isSystem: false", async () => {
    await seedSystemFilter("Balanced");
    await seedSystemFilter("High Conviction");

    await createSavedViewAction({ name: "Balanced", criteria: { minScore: 1 } });

    const systemRows = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.isSystem, true));
    expect(systemRows).toHaveLength(2);
  });
});

describe("renameSavedViewAction", () => {
  test("renames a user-created view", async () => {
    const id = await seedUserFilter("Old name");

    const result = await renameSavedViewAction(id, "New name");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.id, id));
    expect(row.name).toBe("New name");
  });

  test("refuses to rename a system preset", async () => {
    const id = await seedSystemFilter("Balanced");

    const result = await renameSavedViewAction(id, "Renamed");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_IS_SYSTEM" });

    const [row] = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.id, id));
    expect(row.name).toBe("Balanced");
  });

  test("fails cleanly for a view that doesn't exist", async () => {
    const result = await renameSavedViewAction("does-not-exist", "New name");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_NOT_FOUND" });
  });

  test("refuses a blank new name", async () => {
    const id = await seedUserFilter();
    const result = await renameSavedViewAction(id, "  ");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_NAME_REQUIRED" });
  });
});

describe("deleteSavedViewAction", () => {
  test("deletes a user-created view", async () => {
    const id = await seedUserFilter();

    const result = await deleteSavedViewAction(id);
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.id, id));
    expect(rows).toHaveLength(0);
  });

  test("refuses to delete a system preset, leaving it in place", async () => {
    const id = await seedSystemFilter("High Conviction");

    const result = await deleteSavedViewAction(id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_IS_SYSTEM" });

    const rows = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.id, id));
    expect(rows).toHaveLength(1);
  });

  test("fails cleanly for a view that doesn't exist", async () => {
    const result = await deleteSavedViewAction("does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_VIEW_NOT_FOUND" });
  });
});
