# Database recovery

Read this if a migration went bad and the app or the data looks wrong. This is the cross-cutting
reference other documents link to for one question: how to get back to a good database after a
migration did the wrong thing. It is a procedure, not a feature, so it has no in-app surface;
everything here runs from a terminal in the repo.

## The one fact that matters first

There is no down migration. Drizzle only generates forward migrations for this project
(`npm run db:generate` never writes a "down" file, and there is no rollback command in
`drizzle-orm/better-sqlite3/migrator`). If a migration did the wrong thing, you cannot undo it in
place. The only way back is restoring a file from before the migration ran.

Do not go looking for a `db:migrate:down` command. It does not exist and building one is not
planned. Restoring from backup is the recovery procedure, not a fallback while a real one gets
built.

## Step 1: stop

Do not run `db:migrate` again. Do not run it against a different database path hoping it fixes
itself. If the app is running, stop it (`kai stop`, or stop the dev server) so nothing else
writes to `data/crowsnest.db` while you sort this out.

## Step 2: find the backup from before the bad migration

Every `npm run db:migrate` backs the database up first. `src/server/db/migrate.ts` calls
`backupDatabase()` from `scripts/backup-db.ts` before it applies anything, and if that backup
throws, the migration does **not** run (it prints `db:migrate: backup of <path> failed,
migration NOT run.` and exits non-zero). The backup checkpoints the WAL and copies the file to:

```
data/crowsnest.db.bak-<epoch seconds>
```

List them, newest first:

```
ls -t data/crowsnest.db.bak-*
```

Only the newest 5 are kept (`KEEP_BACKUPS` in `scripts/backup-db.ts`), so if the bad migration
ran more than 5 migrations ago, the backup you want may already be gone. Check the timestamps
against when you ran the migration; `date -r <epoch>` turns a filename's epoch seconds back into
a readable date.

If the backup step itself failed on the run you care about, the migration did not run either —
nothing to restore. Check your terminal output.

## Step 3: restore it

With the app stopped:

```
cp data/crowsnest.db.bak-<the one you picked> data/crowsnest.db
rm -f data/crowsnest.db-wal data/crowsnest.db-shm
```

The `-wal` and `-shm` files belong to the database file they were paired with. If you skip
removing them, SQLite may replay stale WAL entries from before the restore against the copy you
just placed, which puts you back where you started.

Restart the app and confirm the data looks right before doing anything else.

## Step 4: decide what to do about the migration

The restored database is back on an earlier schema version. Options, in order of how much you
want to avoid touching `drizzle/`:

- **The migration was simply wrong** (bad column, bad constraint). Fix the schema in
  `src/server/db/schema.ts` and generate a new forward migration with `npm run db:generate` that
  corrects it. Do not edit or delete the bad migration file once it has shipped; write a new one
  that undoes its effect.
- **The migration was right but something else broke.** The schema does not need to change. Fix
  the other thing, then run `npm run db:migrate` again once you are confident, which re-applies
  the same migration to the restored database.

## A buyer's machine

On an installed Kit the database lives under the buyer's state directory (`~/.kai/state`,
symlinked to the current install — see [packaging-and-release](packaging-and-release.md)), not in
the repo `data/`. The `.bak-<epoch>` files sit next to it there. The procedure is identical; only
the path differs. A buyer will not normally run migrations by hand — `kai update` runs them as
part of an upgrade — so the backup a buyer relies on is the one that upgrade took automatically
before it migrated.

## Why this exists

Three migrations went onto the live database on 2026-07-31 with no backup taken first.
`drizzle/0002_drop_cdn_url_columns.sql` had already shown that a bad migration on this project is
not a theoretical risk: it drops columns with `ALTER TABLE ... DROP COLUMN`, and that data is
gone from any database that runs it, permanently. `db:migrate` backing itself up first, and this
doc, close that gap.
