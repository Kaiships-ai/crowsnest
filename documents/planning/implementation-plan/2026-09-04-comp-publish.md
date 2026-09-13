# Implementation plan: publish (schedule and auto-publish own-channel Reels)

Component: `publish`. Case A (`/crowsnest-component`), Goal 4. Replaces the Serve button that
Goal 2 deletes. Build starts only after Goal 2's PR merges (or branch off Goal 2's branch on
orchestrator OK). This plan is written against `main` and copied into the worktree when it is
created.

## Goal

From a planned post on `/mine`: upload an mp4, write a caption, set a schedule time, save. An
in-process scheduler publishes the Reel to the creator's real own channel at that time,
survives a dev-server restart, and never double-publishes. States run
`draft -> scheduled -> publishing -> published | failed` with retry and an error class.

## Locked decisions (orchestrator gates P1/P2)

1. Publish path is the Instagram Graph API against the own channel, using the existing
   `IG_GRAPH_TOKEN` / `IG_GRAPH_USER_ID`. Reels are URL-based: create a media container with
   a public `video_url`, poll `status_code`, then publish. instagrapi on the real account is
   NOT the primary path (ban risk).
2. The public URL comes from a pluggable provider. Round 0 provider is S3-compatible presigned
   upload (Cloudflare R2 or S3): upload the mp4, create the container against its public URL,
   publish, then delete the object. Env/settings: `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`,
   `S3_SECRET`, `S3_PUBLIC_BASE`. The app has no S3 code yet; this plan adds it. R2 is already
   used by the Kit worker, so the account exists.
3. Fallback: instagrapi with a SEPARATE real-account session file, off by default, behind a
   setting with an explicit warning. Not built in Round 0 beyond the seam; a `05-backlog`
   entry tracks finishing it.
4. Scheduler is an in-process interval booted in `server.ts` with a DB state lock. Idempotency
   key = `postId + scheduledAt`. A due row is claimed by a single
   `UPDATE ... SET state='publishing' WHERE id=? AND state='scheduled'` (the atomic claim; a
   zero-row result means another tick already took it). launchd hardening -> `05-backlog`.
5. Dry-run: `PUBLISH_DRY_RUN` defaults on in dev. It runs the whole path (upload + container
   creation) but skips the final publish POST, marking the row `published` with a
   `dryRun` marker so evidence can be captured without touching the live account.
6. If no bucket is configured, the schedule UI saves the plan but explains what to configure
   and does not offer publish (honest surface, no fabricated success).

## Reuse (ponytail: do not rebuild)

- `src/server/graph/client.ts` + `src/server/actions/graph-actions.ts`: the Graph client and
  token check already exist for own-channel reads. Extend the client with container/publish
  calls; reuse the token plumbing.
- `src/server/db/schema.ts` `plannedPosts` + `src/server/queries/planned-posts.ts` +
  `src/server/actions/planned-post-actions.ts`: extend, do not replace.
- `src/server/media/store.ts` (`recordAsset`, `getAssetBySha256`, content-addressed store,
  `/api/media/<id>` with Range): takes the uploaded mp4. No new media infra.
- `/mine` calendar (`MineCalendar`) + `GraphConnectPanel` pattern: host the new surface and
  the not-configured states.

## Impact analysis and change gates (per CLAUDE.md)

Before editing each symbol in the worktree, run `impact` (MCP) or
`node .gitnexus/run.cjs impact "<sym>" --direction upstream --repo .` and report callers.
Named targets: `plannedPosts`, `getPlannedPosts`, `PlannedPostState`,
`schedulePlannedPostAction`, `markPlanPublishedAction`, `GraphClient`. Reindex first
(`analyze --index-only`) because the index may be stale. Run `detect_changes --scope all`
before every commit; `UNKNOWN` risk is not an all-clear.

## Phases and tasks (each task = one fresh implementer sub-agent, per-task review)

### Phase A — data model and state machine

- **A1. Schema + migration.** Extend `plannedPosts`: add `videoAssetId` (fk media asset,
  nullable), `caption` (text), `scheduledAt` (text ISO, nullable — the combined date+time the
  scheduler reads; keep `plannedDate`/`plannedTime` for the calendar), `publishState` reuse of
  existing `state` widened to include `publishing` and `failed`, `idempotencyKey` (text,
  unique with a partial index), `attemptCount` (int default 0), `lastError` (text nullable),
  `errorClass` (text nullable), `publishedAt` (text nullable), `dryRun` (int default 0). Write
  the Drizzle migration (`npm run db:generate`). Update the schema doc comment that currently
  says planned posts never touch the network.
- **A2. Query + type.** Extend `PlannedPostState` in `queries/planned-posts.ts` to
  `draft | scheduled | publishing | published | failed | missed` and update `toRow` so the new
  columns surface. Keep `missed` derived. crowsnest_plans passes this through read-only
  (coordinated with Goal 2 — no tool change on their side).

### Phase B — publish provider and Graph publish

- **B1. Storage provider seam.** New `src/server/publish/storage-provider.ts`: interface
  `{ upload(localPath): Promise<{publicUrl, objectKey}>; delete(objectKey): Promise<void> }`.
  Implement `S3StorageProvider` (presigned PUT via the already-installed AWS SDK if present,
  else a small SigV4 fetch — check deps first, ponytail). Config from the `S3_*` env/settings;
  `null` provider when unconfigured. One self-check test with a fake provider.
- **B2. Graph Reels publish.** Extend `src/server/graph/client.ts`: `createReelContainer({
  videoUrl, caption })`, `pollContainer(id)` (until `status_code` FINISHED/ERROR, bounded),
  `publishContainer(id)`. Typed errors with an error class (auth, container, timeout,
  rate-limit). No secrets to the browser.
- **B3. Publish service.** New `src/server/services/publish-post.ts`: given a claimed row,
  run upload -> container -> poll -> (publish unless dry-run) -> delete object -> write
  `published`/`failed` + `publishedOwnPostId` + error fields. Idempotent: re-entry on the same
  row is a no-op if already terminal. Injectable provider/graph for tests. Self-check test
  covers dry-run, success, and each failure class.

### Phase C — scheduler

- **C1. In-process scheduler.** New `src/server/services/publish-scheduler.ts`: interval
  (settings-driven, safe default ~30s) that selects due `scheduled` rows
  (`scheduledAt <= now`), claims each with the single atomic `UPDATE`, calls the publish
  service, and reschedules retries with backoff up to a cap, else `failed`. Never throws out of
  a tick. Self-check test: claim is exclusive under two concurrent ticks (no double publish).
- **C2. Boot it.** Wire the scheduler start into `server.ts` next to the existing boot
  reconcile. Guard so tests/CLI do not start it. `impact` on `server.ts` boot first.

### Phase D — actions and UI

- **D1. Actions.** In `planned-post-actions.ts`: `uploadPlanVideoAction` (stream mp4 ->
  `recordAsset`, attach), `setPlanCaptionAction`, `schedulePublishAction(id, scheduledAt)`
  (writes `scheduled` + idempotencyKey), `cancelScheduledPublishAction`,
  `publishNowAction`, `retryFailedPublishAction`. Validate at the action layer.
- **D2. Schedule dialog + calendar states.** Build the P2 design in `src/components/mine/`:
  drop-zone (mp4), caption field with mono char count, date/time inputs, one amber primary
  action per state (Schedule / Publish now). Calendar cell + plan row render
  publishing/published/failed with neutral/green/red per the Amber Law. Not-configured panels
  (no token / no bucket) reuse the `GraphConnectPanel` shape. Dry-run banner in dev. Designed
  destructive confirm (red wash), never `window.confirm`. testids on every interactive node.

### Phase E — docs and evidence

- **E1. Five-doc block** `documents/architect/core-components/publish/01..05` via
  `crowsnest-document-component`, house style. Update mkdocs nav, README (feature + journey §5),
  PRODUCT.md (the cook-and-publish step is now real), `.env.example` (`S3_*`, dry-run,
  fallback setting). Archive nothing of Goal 2's studio docs (Goal 2 owns that).
- **E2. Evidence.** One real dry-run publish captured under `evidence/publish/` (request/
  response of container creation + skipped-publish marker), plus `/mine` light+dark
  screenshots of each state.

## Migration collision protocol (program notice)

Goals 2, 3, 4, 5 each add a Drizzle migration from the same base, so numbers and
`drizzle/meta/_journal.json` will collide. Expected merge order is G2, G3, G5, G4, so Goal 4
regenerates last. Do NOT hand-edit migration numbers. Before opening the PR, and again after
every rebase onto main: if main gained a migration since ours was generated, delete our
generated SQL plus our `_journal.json` / snapshot entries, re-run `npm run db:generate` on top
of main so ours sorts last, then re-run `migrations.test.ts`. State `migration regenerated on
<main sha>` in the PR body.

## Verification (Round 0 DoD)

Gate: `npm run typecheck && npm run lint && npm run test && npm run build && bash
scripts/testid-audit.sh`, clean tree. Then: upload -> caption -> schedule -> stored; restart
the dev server mid-schedule and confirm the row still publishes exactly once; dry-run publish
evidenced; all five states reachable; `/mine` shows schedule + state; crowsnest_plans returns
the new state read-only.

## Rounds (mandatory after DoD)

- Round 1: `/code-review high` (or a sonnet reviewer sub-agent) on the branch +
  `verification-before-completion` against a copy of the main-tree `data/crowsnest.db`;
  fix everything; `browse` screenshot walk of `/mine` in light + dark.
- Round 2: walk README §5 as a first-time user, fix the top 3 friction points, re-run the full
  gate. Deferrals -> `05-backlog-to-enhance.md` (instagrapi real-account fallback, launchd
  scheduler hardening, non-S3 URL providers).

## Assumptions taken (orchestrator silent -> ponytail default)

- The own IG account is a Business/Creator account linked to a Facebook page (Graph publish
  requires it). If not, Round 0 stays dry-run only and this is stated in the PR.
- The AWS SDK is added only if a raw SigV4 PUT proves more code than the dependency saves
  (checked at B1).
