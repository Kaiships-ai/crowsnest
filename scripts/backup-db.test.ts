import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { backupDatabase } from "./backup-db";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "backup-db-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function backupsIn(dbPath: string): string[] {
  const prefix = `${dbPath.split("/").pop()}.bak-`;
  return readdirSync(dir).filter((name) => name.startsWith(prefix));
}

test("checkpoints the WAL before copying, so the backup has writes still sitting in -wal", () => {
  const dbPath = join(dir, "crowsnest.db");

  // Simulate the running app: WAL mode, a connection left open, a write that has not
  // been checkpointed. If backupDatabase copied the file without checkpointing first,
  // this row would be missing from the backup -- the exact failure mode E1 is about.
  const writer = new Database(dbPath);
  writer.pragma("journal_mode = WAL");
  writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  writer.exec("INSERT INTO t (v) VALUES ('written-before-backup')");

  const backupPath = backupDatabase(dbPath);
  writer.close();

  expect(backupPath).toBeTruthy();
  const reader = new Database(backupPath as string, { fileMustExist: true, readonly: true });
  const row = reader.prepare("SELECT v FROM t WHERE id = 1").get() as { v: string } | undefined;
  reader.close();

  expect(row?.v).toBe("written-before-backup");
});

test("a fresh clone with no existing database is not a failure", () => {
  const dbPath = join(dir, "does-not-exist-yet.db");

  expect(() => backupDatabase(dbPath)).not.toThrow();
  expect(backupDatabase(dbPath)).toBeNull();
  expect(backupsIn(dbPath)).toEqual([]);
});

test(":memory: has nothing to back up", () => {
  expect(backupDatabase(":memory:")).toBeNull();
});

test("keeps only the newest KEEP_BACKUPS backups", () => {
  const dbPath = join(dir, "crowsnest.db");
  const seed = new Database(dbPath);
  seed.pragma("journal_mode = WAL");
  seed.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  seed.close();

  // Six backups is one more than the retention limit -- ages the fake ones apart so
  // mtime ordering is unambiguous, then runs a real backup as the seventh/newest.
  for (let i = 0; i < 6; i++) {
    const fake = `${dbPath}.bak-fake-${i}`;
    writeFileSync(fake, "not a real db, only mtime matters here");
    const ageSeconds = (10 - i) * 60;
    const then = new Date(Date.now() - ageSeconds * 1000);
    utimesSync(fake, then, then);
  }
  expect(backupsIn(dbPath)).toHaveLength(6);

  const newest = backupDatabase(dbPath);

  const remaining = backupsIn(dbPath);
  expect(remaining).toHaveLength(5);
  // The oldest two of the six fakes (i = 0, i = 1) must be the ones pruned.
  expect(remaining).not.toContain("crowsnest.db.bak-fake-0");
  expect(remaining).not.toContain("crowsnest.db.bak-fake-1");
  expect(existsSync(newest as string)).toBe(true);
});

test("does not run the migration when the backup step throws", () => {
  const dbPath = join(dir, "crowsnest.db");
  // A file that exists but is not a valid SQLite database: opening it for the
  // checkpoint throws, which is exactly the "backup failed" case migrate.ts must
  // treat as "do not migrate" (see migrate.test.ts for that gating behavior).
  writeFileSync(dbPath, "not a sqlite file");

  expect(() => backupDatabase(dbPath)).toThrow();
  expect(backupsIn(dbPath)).toEqual([]);
});
