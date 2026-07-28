import { beforeAll, expect, test } from "vitest";

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  await import("./bootstrap");
});

async function reset() {
  const { db, tables } = await import("./index");
  const { migrate } = await import("./test-migrate");
  migrate();
  await db.delete(tables.savedFilters);
}

test("installs both presets on a fresh database", async () => {
  const { bootstrapSystemFilters } = await import("./bootstrap");
  await reset();

  expect(await bootstrapSystemFilters()).toEqual({ created: 2, existing: 0 });
});

test("re-running never duplicates a preset", async () => {
  const { db, tables } = await import("./index");
  const { bootstrapSystemFilters } = await import("./bootstrap");
  await reset();

  await bootstrapSystemFilters();
  expect(await bootstrapSystemFilters()).toEqual({ created: 0, existing: 2 });
  expect(await db.select().from(tables.savedFilters)).toHaveLength(2);
});

test("a user's own filter sharing a preset's name does not block the preset", async () => {
  const { db, newId, tables } = await import("./index");
  const { bootstrapSystemFilters } = await import("./bootstrap");
  const { and, eq } = await import("drizzle-orm");
  await reset();

  // The exact collision: someone saves their own "Balanced" before bootstrap runs.
  // Deduping on name alone treated that as "the preset is already installed", so the
  // real preset was never created — permanently, on that machine, with re-running
  // powerless to fix it.
  await db.insert(tables.savedFilters).values({
    id: newId(),
    name: "Balanced",
    criteria: { minScore: 99 },
    isSystem: false,
  });

  expect(await bootstrapSystemFilters()).toEqual({ created: 2, existing: 0 });

  const balanced = await db.select().from(tables.savedFilters).where(eq(tables.savedFilters.name, "Balanced"));
  expect(balanced).toHaveLength(2);

  // The user's filter is untouched — bootstrap installs alongside it, never over it.
  const [preset] = await db
    .select()
    .from(tables.savedFilters)
    .where(and(eq(tables.savedFilters.name, "Balanced"), eq(tables.savedFilters.isSystem, true)));
  expect(preset.criteria).toEqual({ minScore: 5, sinceDays: 30 });

  const [own] = await db
    .select()
    .from(tables.savedFilters)
    .where(and(eq(tables.savedFilters.name, "Balanced"), eq(tables.savedFilters.isSystem, false)));
  expect(own.criteria).toEqual({ minScore: 99 });
});
