import { and, eq } from "drizzle-orm";
import { db, newId, tables } from "./index";

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

// CLI entry point: `npm run db:bootstrap`
if (process.argv[1] && process.argv[1].endsWith("bootstrap.ts")) {
  bootstrapSystemFilters()
    .then((r) => {
      console.log(`System filters: ${r.created} created, ${r.existing} already present.`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
