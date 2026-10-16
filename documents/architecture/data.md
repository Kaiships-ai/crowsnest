# Data

Everything crowsnest knows lives in one SQLite file (`data/crowsnest.db` in development; under `~/.kai/state` on an installed Kit) plus a content-addressed media directory. This page covers what the tables are for, what survives a reload, how multi-account sync is modeled, and how to recover from a bad migration. Column-level detail is in `src/server/db/schema.ts`; this page does not copy it.

## Data it holds

The schema is `src/server/db/schema.ts`. Tables by purpose:

| Purpose | Tables |
| --- | --- |
| Tracked content | `channels`, `fleets`, `fleet_channels`, `videos`, `video_children`, `channel_snapshots`, `video_snapshots`, `media_assets` |
| Study | `transcripts`, `video_analyses` (hook, structure, tags, why-it-worked note, frame-pass `layout`), `frame_pass_jobs` |
| Reuse and ideas | `vault_items`, `saved_posts`, `saved_filters`, `idea`, `persona`, `creator_seeds` |
| Remix | `remix_sessions` (one per source video), `remix_runs` (append-only attempt log), `scripts` |
| Plan and publish | `planned_posts` |
| Own channel (Graph) | `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`, `own_account_breakdowns` |
| Agent output | `content_artifacts`, `reel_funnel` (append-only funnel snapshots per reel keyword) |
| Accounts | `ig_accounts` |
| Jobs and observability | `sync_jobs`, `log_events`, `notifications` |
| Configuration | `app_settings`, `secrets` |

The pipeline is a chain of separate rows linked by id: a video becomes the source of a remix session, the session produces a script, the script is carried by a planned post. Deleting a later row never deletes an earlier one.

Files outside the database:

- `data/media/<sha256[0:2]>/<sha256>.<ext>` holds thumbnails, avatars and downloaded video, served through `/api/media/[assetId]`. Instagram CDN URLs expire, so they are never stored.
- `data/crowsnest.db.bak-<epoch seconds>` are the migration backups (below).
- `data/sidecar.pid` tracks a sidecar the app started.

## Boundaries

- Owns: `src/server/db/` (schema, bootstrap, migrate), `drizzle/` (generated migrations), `src/server/settings/`, `src/server/secrets/`, `scripts/backup-db.ts`.
- Called by: every server action, query, service, scheduler and MCP tool. Pages read through `src/server/queries/`; writes go through `src/server/actions/` and `src/server/services/`.
- Calls: nothing off-box. Persistence never depends on an external service.

## Invariants

- **Ids are text uuids and timestamps are ISO 8601 text.** `newId()` and `nowIso()` in `src/server/db/index.ts` are the only sources.
- **WAL mode and foreign keys are on** (`src/server/db/index.ts`).
- **Forward migrations only.** `npm run db:generate` writes numbered SQL plus a snapshot; `scripts/check-migrations.mjs` fails when the SQL files and `drizzle/meta/_journal.json` disagree, which catches two PRs picking the same number. Never edit a shipped migration; write a new one.
- **Queries may throw; actions never do.** A query returns data or null and lets a database error propagate. A server action catches and returns `ActionResult` (`src/server/lib/action-result.ts`) with a `code` the UI can branch on.
- **Soft delete where anything hangs off a row.** A sync that no longer sees a post sets `videos.deletedAt` (`sync-engine.ts`); untracking a channel sets `channels.deletedAt`. Saved posts, planned posts and analyses stay. Scripts and planned posts reference videos, sessions and scripts with `ON DELETE SET NULL`, so a plan outlives its script, session and source video.
- **Missed is derived.** `planned_posts.state` stores draft, scheduled, publishing, published or failed. Nothing stores "missed"; a scheduled plan whose date passed is read as missed (`src/server/queries/planned-posts.ts`).
- **Exactly one own channel and one default account.** Both are partial unique indexes (`channels_single_own`, `ig_accounts_single_default`).
- **One analysis and one transcript per video** (the video id is the primary key), **one saved post per video** (`saved_posts_video`). **One remix session per video** is enforced by `getOrCreateSession` in `services/remix.ts`, not by an index, so a second remix attempt resumes the existing session.
- **One active idea per source video.** `idea_source_active` is a partial unique index excluding discarded rows.
- **Own-channel data is a separate table set.** Own posts never appear in the outlier feed, the dashboard stats or scoring, structurally rather than by a filter someone must remember.
- **Own median reach has its own function.** `src/server/services/own-metrics.ts` computes reach medians; it must not reuse the view-count median in `outlier-calc.ts`, because reach and views are different quantities.
- **A sync lock lives in the database.** `sync_jobs_lock_running` is a partial unique index on `lock_key` where status is running, so a second process cannot start an overlapping run. A crashed run's stale lock is reaped by heartbeat (see [jobs-and-failures](jobs-and-failures.md)).
- **Secrets are plaintext in the local database and never returned to the browser.** `secretStatus()` reports configured and source only (`src/server/secrets/store.ts`). The Instagram password for a non-default account is stored as `IG_PASSWORD::<accountId>`.
- **Settings precedence is database, then environment, then default.** An invalid stored value is treated as absent, never thrown (`src/server/settings/index.ts`).
- **The platform column is plain text.** `channels.platform` and `videos.platform` allow another source later without a migration; only Instagram is ingested.
- **A "video" is any tracked post.** The `videos` table also holds photos and carousels; `mediaType` says which, and a carousel is one row plus rows in `video_children`.
- **Agent-authored output keeps provenance.** `content_artifacts` stores the agent's JSON verbatim with agent, model, source video ids and assumptions; `kind` is validated in `services/artifacts.ts`, not by a constraint.
- **Funnel snapshots are append-only.** `reel_funnel` rows are never updated or deleted. A read takes the newest `captured_at` per case-insensitive keyword, source and metric (metrics are stored lowercased), ties going to the later insert, and links a row to the plan whose `keyword` matches case-insensitively at read time. A renamed plan keyword leaves older rows under the old keyword with no plan (`services/funnel.ts`).
- **Frame-pass layout cannot be fabricated.** `persistFramePass` (`services/frame-pass.ts`) refuses a layout field that carries a value while citing no frames. The model's output goes through the same validator a human entry would.

## What survives a reload

State has four layers, most durable first.

| Layer | Examples | After a reload |
| --- | --- | --- |
| Committed rows | saved post, script, planned post, analysis, remix session | Kept. |
| Autosaved session fields | remix topic, research notes, hook, style, outline, variants, chosen variant | Kept at the last landed write. |
| URL state | feed filters, sort, layout, density; remix opening stage and seed; dashboard `?tab=`; `?reel=`; calendar `?month=` | Kept, and shareable by copying the URL. |
| Client-only state | an unblurred field, a dialog's fields before submit, a chosen detail tab | Lost. |

Rules behind the table:

- The remix studio autosaves fire-and-forget through `src/components/remix/autosave.ts`. A failed write raises an "Autosave failed" toast and leaves the field as typed. Text areas save on blur and selects save on change, so an unblurred edit is the one thing a reload loses.
- Stage advances (Continue, Restart) are awaited writes of `remix_sessions.stage`, so the furthest stage a reload resumes at is reliable.
- Dialogs (keep note, plan, save script title) commit only on submit. Leaving one is a cancel.
- Two tabs on one video share one session. Their autosaves write the same columns, last write wins per field, with no merge.
- A saved view applied to the feed is a copy of its criteria in the URL, not a link to the row.
- The recently viewed list is `app_settings.recently_viewed`, a JSON array of video ids, most recent first, capped at 8 (`src/server/queries/video.ts`). The write is fire-and-forget and swallows errors so tracking never breaks a page.
- Saving never needs an external service.

## Multi-account sync

An `ig_accounts` row holds one Instagram identity: username, label, status (active or paused), optional proxy, device seed, session path and sidecar port, and a per-account `cooldown_until`. A channel is pinned to an account through `channels.accountId`; null means the default account, so a single-account install behaves as before. The account CRUD lives in `src/server/services/accounts.ts` and the Accounts section of Settings.

What is built and what is not:

- `planAccountSync` and `accountChildEnv` in `services/accounts.ts` are pure, tested functions. The planner groups channels by account and skips an account that is paused or cooling down, so one account's cooldown never stops the others.
- The sync engine does not call them yet. A sync still runs against the one default sidecar, serialized behind its process-global lock. Nothing in the product should call this parallel Instagram sync.
- Running one live sidecar per account needs per-account credentials and a live environment to watch rate-limit behavior. It is deliberately not claimed as done.

## Database recovery runbook

There is no down migration and none is planned. If a migration did the wrong thing, restore the file taken before it ran.

1. **Stop everything.** Run `kai stop` (or stop the dev server). Do not run `db:migrate` again.
2. **Find the backup.** `npm run db:migrate` calls `backupDatabase()` (`scripts/backup-db.ts`) first. It checkpoints the WAL and copies the file to `data/crowsnest.db.bak-<epoch seconds>`. If the backup throws, the migration does not run and exits non-zero. Only the newest 5 are kept (`KEEP_BACKUPS`). List them with `ls -t data/crowsnest.db.bak-*` and read an epoch with `date -r <epoch>`.
3. **Restore.** With the app stopped:
   ```
   cp data/crowsnest.db.bak-<epoch> data/crowsnest.db
   rm -f data/crowsnest.db-wal data/crowsnest.db-shm
   ```
   The `-wal` and `-shm` files pair with the old file. Leaving them lets SQLite replay stale entries onto the restored copy.
4. **Decide about the migration.** If it was wrong, fix `schema.ts` and generate a new forward migration that corrects it. If it was right and something else broke, fix that and run `npm run db:migrate` again.

On an installed Kit the same files sit in the state directory (`~/.kai/state`, symlinked across installs). A buyer does not run migrations by hand: `kai update` runs `src/server/db/migrate.ts` after switching versions, so the backup a buyer relies on is the one that step takes.

## Where to look

- `src/server/db/schema.ts`, `src/server/db/index.ts`, `src/server/db/migrate.ts`
- `scripts/backup-db.ts`, `scripts/check-migrations.mjs`, `drizzle/`
- `src/server/settings/index.ts`, `src/server/secrets/store.ts`
- `src/server/services/accounts.ts`
- `src/components/remix/autosave.ts`
