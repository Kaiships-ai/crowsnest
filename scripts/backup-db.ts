import Database from "better-sqlite3";
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Backs up the SQLite database before `db:migrate` touches it. See E1 in
 * docs/product/v1-to-product-backlog.html: three forward-only migrations went onto
 * the live database on 2026-07-31 with no snapshot taken first, and one of them
 * (`0002_drop_cdn_url_columns.sql`) already permanently drops columns, so the next
 * bad migration would have nothing to restore from.
 *
 * Mirrors, in code, exactly what agents did by hand that day: checkpoint the WAL,
 * then copy the file to `<dbPath>.bak-<epochSeconds>` (see the `.bak-*` files
 * already sitting in data/). A backup taken without checkpointing first would miss
 * whatever writes are still sitting in `<dbPath>-wal`, which is worse than no
 * backup at all: it looks complete and is not.
 *
 * Throws on any failure (cannot open the database, checkpoint, or copy the file).
 * Callers MUST treat a thrown error as "do not migrate" -- see migrate.ts, where a
 * failed backup aborts before any migration runs.
 */

// How many backups to keep per database. This runs on a laptop that Kai operates by
// hand, not a fleet with off-box retention, so an unbounded pile of `.bak-<epoch>`
// files next to data/crowsnest.db is its own problem (disk, clutter, "which of these
// do I even want"). 5 covers "walk it back a couple of migrations" with room to
// spare, without turning into a cleanup chore anyone has to think about.
const KEEP_BACKUPS = 5;

export function backupDatabase(dbPath: string): string | null {
  if (dbPath === ":memory:") {
    // Nothing on disk to back up. migrate.ts's CLI entry point always runs against
    // a real file, but guard this explicitly rather than let copyFileSync below
    // throw a confusing ENOENT for a path that was never meant to have one.
    return null;
  }

  if (!existsSync(dbPath)) {
    // Fresh clone, first `db:migrate` ever: there is nothing to back up yet, and
    // that is fine. Not a failure.
    console.log(`db:backup: no existing database at ${dbPath}, nothing to back up.`);
    return null;
  }

  // Checkpoint in TRUNCATE mode: folds everything in `<dbPath>-wal` into the main
  // file and empties the WAL, so the plain file copy below is self-contained. Uses
  // its own connection (separate from the app's) purely to run this one pragma.
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    sqlite.close();
  }

  const epochSeconds = Math.floor(Date.now() / 1000);
  const backupPath = `${dbPath}.bak-${epochSeconds}`;
  copyFileSync(dbPath, backupPath);
  console.log(`db:backup: backed up ${dbPath} -> ${backupPath}`);
  console.log("db:backup: if a migration turns out bad, see documents/architecture/data.md (Database recovery runbook) to restore from this file.");

  pruneOldBackups(dbPath);

  return backupPath;
}

function pruneOldBackups(dbPath: string): void {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.bak-`;
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(dir, name));

  if (backups.length <= KEEP_BACKUPS) return;

  // Oldest-first by mtime, not by parsing the epoch out of the filename: some of
  // today's hand-made backups are named `crowsnest.db.bak-precleanup-<epoch>`, and
  // mtime sorts all of them correctly without caring about the suffix.
  const byAge = backups
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);

  for (const { path } of byAge.slice(0, byAge.length - KEEP_BACKUPS)) {
    unlinkSync(path);
    console.log(`db:backup: pruned old backup ${path}`);
  }
}

// CLI entry point (ad-hoc / manual use). `db:migrate` calls backupDatabase()
// directly rather than shelling out to this.
if (process.argv[1] && process.argv[1].endsWith("backup-db.ts")) {
  const dbPath = process.env.CROWSNEST_DB_PATH ?? "data/crowsnest.db";
  try {
    backupDatabase(dbPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
