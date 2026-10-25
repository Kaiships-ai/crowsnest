import { backupDatabase } from "../../../scripts/backup-db";

/**
 * CLI entry point (pnpm run db:migrate) that applies the committed ./drizzle
 * migrations to the dev database at CROWSNEST_DB_PATH (default data/crowsnest.db).
 * Same `migrate(db, { migrationsFolder })` mechanism used by test-migrate.ts.
 *
 * Backs up the database first (see scripts/backup-db.ts / E1 in
 * docs/product/v1-to-product-backlog.html). If the backup throws, migrations do
 * NOT run: a migration that proceeds after a failed backup is exactly the scenario
 * this exists to prevent. See documents/architecture/data.md (Database recovery runbook) for what to do if a
 * migration turns out to be the bad one.
 */
export async function main(): Promise<void> {
  const dbPath = process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db";

  try {
    backupDatabase(dbPath);
  } catch (err) {
    console.error(`db:migrate: backup of ${dbPath} failed, migration NOT run.`);
    console.error(err);
    process.exit(1);
    throw err; // unreachable when process.exit really terminates; a safety net for
    // the test that mocks process.exit and needs main() to stop here regardless.
  }

  // Imported after the backup runs. `./index` opens (and, on a fresh clone,
  // creates) the database file as a side effect of module load, so it must not
  // happen before backupDatabase() has already decided what there was to back up.
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("./index");

  // Goal 2: create_runs is dropped by a migration below (0022). drizzle-orm's
  // migrate() gives no per-statement hook to log from, so this is a one-off,
  // guarded pre-migration read: if the table is still there, log its row count
  // before the DROP TABLE removes it. No-op once the table is gone.
  const client = (db as { $client?: import("better-sqlite3").Database }).$client;
  const stillExists = client?.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='create_runs'",
  ).get();
  if (stillExists) {
    const { n } = client!.prepare("SELECT count(*) AS n FROM create_runs").get() as { n: number };
    console.log(`dropped ${n} create_runs rows`);
  }

  migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`Migrations applied to ${dbPath}`);
}

// CLI entry point guard (same pattern as bootstrap.ts / backup-db.ts): runs
// automatically for `pnpm run db:migrate`, not when a test imports main() directly.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  main();
}
