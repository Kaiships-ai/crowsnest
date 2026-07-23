import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./index";

/**
 * CLI entry point (npm run db:migrate) that applies the committed ./drizzle
 * migrations to the dev database at CROWSNEST_DB_PATH (default data/crowsnest.db).
 * Same `migrate(db, { migrationsFolder })` mechanism used by test-migrate.ts.
 */
migrate(db, { migrationsFolder: "./drizzle" });
console.log(`Migrations applied to ${process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db"}`);
