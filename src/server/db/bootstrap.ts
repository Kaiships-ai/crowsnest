import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, newId, nowIso, tables } from "./index";

/**
 * Inserts the application's built-in filter presets.
 *
 * This is NOT seed data. `db:seed` generated fabricated channels, videos and view counts
 * to make the UI look populated, and it has been deleted. These two rows are product
 * configuration — the presets the feed's filter bar offers out of the box — and a fresh
 * install needs them to behave the same as an existing one.
 *
 * Idempotent: re-running never duplicates a preset.
 */

const SYSTEM_FILTERS: { name: string; criteria: Record<string, unknown> }[] = [
  { name: "Balanced", criteria: { minScore: 5, sinceDays: 30 } },
  { name: "High Conviction", criteria: { minScore: 10, sinceDays: 14, minViews: 500_000 } },
];

export async function bootstrapSystemFilters(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const filter of SYSTEM_FILTERS) {
    // Keyed on name AND is_system. On name alone, a user who saves their own filter
    // called "Balanced" permanently blocks the preset of that name from ever being
    // installed — on their machine the product silently ships with one fewer preset,
    // and no amount of re-running this fixes it.
    const found = await db
      .select({ id: tables.savedFilters.id })
      .from(tables.savedFilters)
      .where(and(eq(tables.savedFilters.name, filter.name), eq(tables.savedFilters.isSystem, true)))
      .limit(1);
    if (found[0]) {
      existing += 1;
      continue;
    }
    await db.insert(tables.savedFilters).values({
      id: newId(),
      name: filter.name,
      criteria: filter.criteria,
      isSystem: true,
    });
    created += 1;
  }

  return { created, existing };
}

/**
 * Loads the curated creator seed lists (data/seeds/*.json) into creator_seeds.
 *
 * Idempotent: keyed on (platform, handle), matching the table's unique index.
 * Filenames are fixed, not globbed, so load order stays deterministic.
 */
const SEED_NICHES = ["fitness", "finance", "tech", "business"] as const;

export async function bootstrapCreatorSeeds(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const niche of SEED_NICHES) {
    const file = JSON.parse(readFileSync(join(process.cwd(), "data/seeds", `${niche}.json`), "utf8"));
    for (const c of file.creators as { handle: string; why: string; source?: string }[]) {
      const handle = c.handle.trim().replace(/^@/, "");
      const found = await db
        .select({ id: tables.creatorSeeds.id })
        .from(tables.creatorSeeds)
        .where(and(eq(tables.creatorSeeds.platform, "instagram"), eq(tables.creatorSeeds.handle, handle)))
        .limit(1);
      if (found[0]) {
        existing += 1;
        continue;
      }
      await db.insert(tables.creatorSeeds).values({
        id: newId(),
        platform: "instagram",
        handle,
        niche: file.niche,
        why: c.why,
        source: c.source ?? null,
        createdAt: nowIso(),
      });
      created += 1;
    }
  }

  return { created, existing };
}

// CLI entry point: `pnpm run db:bootstrap`
if (process.argv[1] && process.argv[1].endsWith("bootstrap.ts")) {
  Promise.all([bootstrapSystemFilters(), bootstrapCreatorSeeds()])
    .then(([filters, seeds]) => {
      console.log(`System filters: ${filters.created} created, ${filters.existing} already present.`);
      console.log(`Creator seeds: ${seeds.created} created, ${seeds.existing} already present.`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
