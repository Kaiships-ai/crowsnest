import { migrate as applyMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index";

/**
 * Applies the committed ./drizzle migrations to the current `db` instance.
 * Used by tests against an in-memory database (CROWSNEST_DB_PATH=:memory:) so
 * the schema under test is created via the exact same migration mechanism
 * used for the real dev database (see `migrate.ts` / `pnpm run db:migrate`).
 */
export function migrate() {
  applyMigrations(db, { migrationsFolder: "./drizzle" });
}
