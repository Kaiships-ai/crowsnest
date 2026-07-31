import { expect, test, vi } from "vitest";

/**
 * The one behavior E1 exists for: if the pre-migration backup fails, the migration
 * must NOT run. A migration that proceeds after a failed backup is exactly the
 * scenario the backup step is supposed to prevent (three forward-only migrations
 * went onto the live database on 2026-07-31 with no snapshot -- see E1 in
 * docs/product/v1-to-product-backlog.html).
 *
 * `backupDatabase` and the drizzle migrator are both mocked, so this never touches
 * a real database file -- it only asserts the ordering and gating in migrate.ts's
 * main().
 */

const backup = vi.hoisted(() => ({ backupDatabase: vi.fn() }));
const migrator = vi.hoisted(() => ({ migrate: vi.fn() }));

vi.mock("../../../scripts/backup-db", () => backup);
vi.mock("drizzle-orm/better-sqlite3/migrator", () => migrator);
vi.mock("./index", () => ({ db: {} }));

import { main } from "./migrate";

test("a failed backup blocks the migration from running", async () => {
  backup.backupDatabase.mockImplementation(() => {
    throw new Error("disk full");
  });
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit(1)");
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(main()).rejects.toThrow();

  expect(migrator.migrate).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("backup"));
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("NOT run"));

  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

test("a successful backup lets the migration run", async () => {
  backup.backupDatabase.mockImplementation(() => "data/crowsnest.db.bak-123");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  await main();

  expect(migrator.migrate).toHaveBeenCalledTimes(1);
  expect(migrator.migrate).toHaveBeenCalledWith({}, { migrationsFolder: "./drizzle" });

  logSpy.mockRestore();
});
