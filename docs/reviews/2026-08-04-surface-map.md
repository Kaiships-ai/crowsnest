# Crowsnest surface map

Boundary artifact for the review swarm. Written at `main` / `8909788`. Read-only survey,
no code changed.

Stack: Next.js 16 App Router (server components + server actions), drizzle over
better-sqlite3 at `data/crowsnest.db`, a FastAPI Instagram sidecar under `services/ig`,
an LLM client that talks to a local 9router proxy.

Dev server: http://localhost:3000 (browse via `localhost`, not `127.0.0.1`).

## 1. Routes and screens

All app routes live under `src/app`. There is one route group, `(shell)`, whose layout
renders the sidebar, topbar and command palette. `/first-run` sits outside it on purpose.

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `src/app/(shell)/page.tsx` | Dashboard. Stat tiles, top outliers today, outlier timeline, producer donut, reach/score scatter, coverage list, fleet spike row, recently viewed, plus a dependency status panel that pings the sidecar and the LLM. |
| `/feed` | `src/app/(shell)/feed/page.tsx` | Outlier feed. Grid or list of tracked videos with score/views/recency filters, fleet and platform filters, saved views, sort, density, load more. A bare visit applies no default filter. |
| `/feed/[videoId]` | `src/app/(shell)/feed/[videoId]/page.tsx` | Video detail. Player or carousel viewer, metric chips, median baseline, Layout section (frame pass lives here), transcript / hook and structure / why it worked tabs, save to Vault, similar outliers, prev/next feed nav. |
| `/feed/[videoId]/remix` | `src/app/(shell)/feed/[videoId]/remix/page.tsx` | Remix studio. Staged flow (research, hook, style, prompt, script) with a context rail, run log, autosave, and a blocked state when no LLM key is present. Accepts `?hook=<id>` and `?style=<id>` deep links from Vault template cards. |
| `/channels` | `src/app/(shell)/channels/page.tsx` | Channels kanban. Fleet columns, drag between fleets, add/remove channel. |
| `/channels/[channelId]` | `src/app/(shell)/channels/[channelId]/page.tsx` | Channel detail. Header stats with median confidence, outlier history chart, reach by post bars, post calendar, video grid. |
| `/mine` | `src/app/(shell)/mine/page.tsx` | My channel. Own-account stat tiles, reach by post, weekday rhythm, planner calendar. Two independent gates: `channels.is_own` must be set, and the IG Graph token must be present. Planner renders regardless. |
| `/vault` | `src/app/(shell)/vault/page.tsx` | Vault. Tabs `posts`, `scripts`, `hooks`, `styles`. Saved posts with notes, drafted scripts, saved hook and layout items. |
| `/runs` | `src/app/(shell)/runs/page.tsx` | Runs list. Sync jobs and remix runs with an SLA chip, live via SSE. |
| `/runs/[runId]` | `src/app/(shell)/runs/[runId]/page.tsx` | Run detail. Phase, counters, live log tail via SSE. |
| `/logs` | `src/app/(shell)/logs/page.tsx` | System logs. Level, source and text filters over `log_events`. |
| `/settings` | `src/app/(shell)/settings/page.tsx` | Settings, 11 anchored sections: niche profile, Instagram, Graph API, API keys, local binaries, scoring, feed defaults, sync, runs and alerts, onboarding, appearance. |
| `/first-run` | `src/app/first-run/page.tsx` | Onboarding. Outside `(shell)`. `(shell)/layout.tsx` redirects a fresh install here; this page redirects back to `/` once `first_run_completed` is set. |

API routes (all `runtime = "nodejs"`, better-sqlite3 has no edge build):

| Route | File | Purpose |
| --- | --- | --- |
| `GET /api/runs/stream` | `src/app/api/runs/stream/route.ts` | SSE. Pushes `listRuns()` every 2000 ms; with `?runId=` also tails that run's log events. |
| `GET\|HEAD /api/media/[assetId]` | `src/app/api/media/[assetId]/route.ts` | Streams a stored asset out of `MEDIA_ROOT` with byte-range support. Every failure is a bare 404 with no detail. |
| `POST /api/logs/ingest` | `src/app/api/logs/ingest/route.ts` | The single write path into `log_events`. Backend, frontend and sidecar all funnel here so redaction and the token gate cannot be bypassed. `source: "sidecar"` is gated by `X-IG-Token`. |

Sidebar and command palette share one list: `src/components/layout/nav-items.ts`
(8 entries, grouped Research / Create / Sources / System). Topbar titles come from
`ROUTE_TITLES` in `src/components/layout/topbar.tsx`, which is why several pages
deliberately start their content at `h2`.

Every data-backed route in the shell sets `export const dynamic = "force-dynamic"`,
including `(shell)/layout.tsx` itself.

## 2. The two features shipped this session

### 2a. Frame pass

What it is: a Layout reading (on-screen text, text position, cut rhythm, framing) taken
from actual video frames rather than guessed from the caption. The LLM client has no
image path and the 9router proxy relays no vision model, so the reading comes from a
Claude Code subprocess spawned locally with `--allowedTools Read`.

Where to exercise it: `/feed/<videoId>`, the Layout section, button labelled
"Run frame pass" (or "Re-run frame pass" / "Retry frame pass" depending on state).
It only works on a video that already has a downloaded video asset. `EAGER_VIDEO_DOWNLOAD`
is false, so a freshly synced post has a thumbnail but no mp4 and the pass fails with
`FRAME_NO_VIDEO_ASSET`.

| File | Role |
| --- | --- |
| `src/components/video/layout-section.tsx` | The button, the poll loop, the four states (never run, running, failed, has reading), the toasts. |
| `src/server/actions/analyze-actions.ts:72` `runFramePassAction` | Starts a pass, returns a job id. Pre-checks for a running job. |
| `src/server/actions/analyze-actions.ts:100` `getFramePassJobAction` | Poll one job. An unknown id reads as failed, never as running. |
| `src/server/services/frame-pass-runner.ts` | Orchestrator. Inserts the job row, resolves the video file, extracts frames into a temp dir, asks Claude, parses, persists, cleans up. |
| `src/server/services/watch-frames.ts` | Stage 1. Shells out to the claude-video plugin `watch.py` (yt-dlp + ffmpeg) and parses its report lines into `{path, timestampSeconds, reason}`. |
| `src/server/services/claude-task.ts` | Stage 2 transport. `spawn` of the Claude CLI in print mode. Hardcoded default binary at `/Users/kienbeovl/.local/bin/claude`. `--allowedTools Read` is the security boundary. Default timeout 600000 ms. |
| `src/server/services/frame-pass-prompt.ts` | Builds the prompt from the frame list; parses the reply into a `VideoLayout`. |
| `src/server/services/frame-pass.ts` | `resolveVideoFile`, `persistFramePass`, `recordFramePassFailure`. Holds the anti-fabrication guard. |
| `drizzle/0013_frame_pass_jobs.sql`, `src/server/db/schema.ts:457` | The `frame_pass_jobs` table. |

Two invariants worth checking:

1. Anti-fabrication. `persistFramePass` rejects any Layout field carrying a non-null
   `value` while `fromFramesSec` is empty. A value with no backing frame is a guess.
2. One pass at a time, globally. A partial unique index on `frame_pass_jobs`
   (`lock_key` constant, `WHERE status = 'running'`) is the real lock. The check in
   `runFramePassAction` is only a nicety; the runner catches the unique violation and
   returns the id of the job that actually holds the lock.

Result lands on `video_analyses`: `layout`, `frames_sampled`, `frame_model`
(`claude-code/watch+sonnet`), `frame_pass_at`, `frame_pass_error`. A layout-only analysis
row is legal; the text columns stay null until Analyze runs.

### 2b. Reel view count enrichment

What it is: the IG list endpoint returns `play_count: 0` for reels, so a second pass asks
the single-media endpoint for each of the newest N reels per channel and writes the real
number back before scoring.

Off by default. `VIEW_COUNT_ENRICH_PER_CHANNEL` defaults to 0, range 0 to 200
(`src/server/config.ts:75`). Set it to a small number to exercise the pass.

| File | Role |
| --- | --- |
| `src/server/services/sync-engine.ts:675` `enrichmentCandidates` | Newest-first, scoped to `product_type = 'clips'`, excludes soft-deleted rows. Deliberately not filtered to null view counts, since counts grow after a post lands. |
| `src/server/services/sync-engine.ts:737` `enrichViewCounts` | The pass. Per reel: cancel check, heartbeat tick, one `fetchMediaStats`, write. Counts `enriched` / `skipped` / `withheld` / `stopped`. Three consecutive `IG_NOT_FOUND` answers end the pass (a likely action-block, not three real deletions). |
| `src/server/services/sync-engine.ts:1355` | The call site. Runs before `recomputeChannelScores`, gated on the knob, on `stopReason !== "cancelled"`, and on a live cancel re-check. |
| `src/server/ig/client.ts:482` `fetchMediaStats` | POSTs `{pk}` to the sidecar `/media-stats`. |
| `services/ig/crowsnest_ig/app.py:330` `/media-stats` | Sidecar route. Engagement counts for one media and nothing else. |

Two things a reviewer should probe:

1. The pass is the longest stretch of authenticated requests in a run, and it sits
   between two flushes. Its only heartbeat is `tick`, which reuses phase `"scoring"`.
   Without it the run can outlast `SYNC_STALL_SECONDS` (UI calls it dead) and then
   `LOCK_STALE_MS` (another run steals the lock and its `softDeleteMissing` buries posts
   it never reached).
2. Both `tick` and `shouldStop` touch the DB and can throw. They are caught inside the
   pass, because letting either escape would turn a fully successful page walk into
   `stopReason: "error"` over a view count.

Related, from an earlier fix in this session: instagrapi's `request_timeout` is a sleep
before every private request, not a socket timeout. Feeding it a millisecond value cost
180 s per call.

## 3. Main user flows

### Flow A: first run

1. Fresh install, any shell URL. `(shell)/layout.tsx` reads `getFirstRunGate()` and
   redirects to `/first-run`.
2. `OnboardingFlow` collects the niche profile, then Instagram login, then a first
   channel.
3. `first_run_completed` is written to `app_settings`. Revisiting `/first-run` now
   redirects back to `/`. The only way back in is the Settings control that clears the
   flag.

### Flow B: add a channel and sync

1. `/channels`, add a channel by handle (`addChannelAction`, `src/server/actions/sync-actions.ts:394`).
2. `startSyncAction` (`:119`) takes the sync lock and starts `runSync`.
3. Sync phases in order: `starting`, `profile`, `fetching`, `retrying`, `saving`,
   `scoring`, `finalizing`. Per channel: profile fetch, paged media walk, upsert into
   `videos`, soft-delete of anything missing, optional view count enrichment, then
   `recomputeChannelScores` and a `channel_snapshots` row.
4. Progress via `getSyncProgressAction` / `getChannelSyncProgressAction`, or live on
   `/runs` through the SSE stream. `cancelSyncAction` sets the cancel flag; the engine
   checks it between channels and inside the enrichment loop.
5. `/runs/<runId>` shows the phase, counters and log tail.

### Flow C: browse and open a video

1. `/feed`. Filter by fleet, platform, min score, min views, since days. Sort and switch
   grid/list density. Saved views via `saved_filters`.
2. Quick preview sheet from a card, or click through to `/feed/<videoId>`.
3. Detail screen: player or carousel, metric chips, median baseline with a confidence
   read, similar outliers, prev/next nav resolved from the same filter criteria
   (`resolve-feed-nav.ts`).
4. Analyze (`analyzeVideoAction`) fills hook and structure, transcript, why it worked.
5. Run frame pass (Flow D) fills the Layout section.
6. Save the post (`createSavedPostAction`) or save a hook/layout to Vault
   (`createVaultItemAction`).

### Flow D: frame pass

1. Video must have a downloaded video asset. If not, `downloadVideoAction`
   (`src/server/actions/media-actions.ts:24`) first.
2. `/feed/<videoId>`, Layout section, click "Run frame pass".
3. `runFramePassAction` inserts a `frame_pass_jobs` row with `status = 'running'`.
4. Runner extracts frames via `watch.py` into a temp dir.
5. Runner spawns the Claude CLI with `--allowedTools Read` and the frame paths.
6. Reply is parsed into a `VideoLayout` and validated by `persistFramePass`.
7. Client polls `getFramePassJobAction` until success or failure, then toasts and
   re-renders the section.

### Flow E: remix and export

1. `/feed/<videoId>/remix`. Blocked with a named recovery if no LLM key.
2. Stage research (`buildResearchAction`) pulls the transcript, the analysis, similar
   tracked outliers and up to 5 Vault items.
3. Stage hook (`generateHooksAction`), stage style, stage prompt, stage outline
   (`generateOutlineAction`), stage variants (`generateVariantsAction`).
4. `saveScriptAction` writes a `scripts` row; the run is recorded in `remix_runs` and
   shows up on `/runs`.
5. Export prompts via `buildVideoPromptAction` / `buildScriptPromptAction`
   (`src/server/actions/export-actions.ts`). There is also `quickRemixAction` for a
   single-shot path.
6. Scripts show on `/vault?tab=scripts` and can be attached to a planned post
   (`attachScriptToPlanAction`).

### Flow F: my channel and the planner

1. Mark a channel as own (`setOwnChannelAction`).
2. Connect the Graph API token in Settings; `checkGraphTokenAction` gates the panel.
3. `measureOwnChannelAction` (`src/server/actions/graph-actions.ts:115`) writes
   `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`.
4. Planner calendar on `/mine` works with no Graph connection at all: create, schedule,
   unschedule, publish, delete planned posts.

## 4. Server actions and data paths

17 action modules under `src/server/actions/`, roughly 65 exported actions. Grouped:

- Sync: `sync-actions.ts` (`startSyncAction`, `getSyncProgressAction`,
  `getChannelSyncProgressAction`, `cancelSyncAction`, `addChannelAction`,
  `importReelAction`).
- Analyze and frame pass: `analyze-actions.ts` (`analyzeVideoAction`,
  `runFramePassAction`, `getFramePassJobAction`).
- Instagram: `ig-actions.ts` (status, login, login by session, challenge choose,
  challenge code, two factor, logout), `sidecar-actions.ts` (start, stop, alive).
- Graph: `graph-actions.ts` (`measureOwnChannelAction`, `checkGraphTokenAction`).
- Remix: `remix-actions.ts` (session, stage, research, hooks, outline, variants, save,
  quick remix, run log, delete).
- Library: `saved-post-actions.ts`, `vault-actions.ts`, `saved-view-actions.ts`,
  `planned-post-actions.ts`, `channel-actions.ts`, `fleet-actions.ts`,
  `media-actions.ts`, `export-actions.ts`, `notification-actions.ts`.
- Config: `settings-actions.ts`, `secrets-actions.ts` (including
  `regenerateServiceTokenAction`).

Read paths live in `src/server/queries/` (channels, dashboard, feed, video, saved-posts,
vault, own-channel, planned-posts, runs, remix-runs, failure-surface, first-run-gate).
Pages call these directly as server components; they do not go through actions.

Main services in `src/server/services/`:

- `sync-engine.ts` (76 KB, the largest file in the repo). Lock, page walk, upsert,
  soft delete, view count enrichment, score recompute, snapshots, cancel handling,
  retry policy.
- `outlier-calc.ts`. Median basis, `MEDIAN_CONFIDENCE_THRESHOLDS`, `medianConfidence`,
  the outlier multiple.
- `analyze.ts`, `remix.ts`, `similar.ts`, `export.ts`, `own-metrics.ts`.
- Frame pass set: `frame-pass.ts`, `frame-pass-runner.ts`, `frame-pass-prompt.ts`,
  `watch-frames.ts`, `claude-task.ts`.

IG sidecar surface (`services/ig/crowsnest_ig/app.py`), every route except `/health`
behind `X-IG-Token` via `require_token`:

`GET /health`, `POST /login`, `POST /challenge/resolve`, `POST /two-factor`,
`POST /login-by-session`, `POST /logout`, `GET /profile`, `GET /medias`,
`POST /resolve-media`, `POST /media-stats`, `POST /download`.

TypeScript side: `src/server/ig/client.ts` (`health`, `profile`, `medias`,
`resolveMedia`, `fetchMediaStats`, `download`), `src/server/ig/assets.ts`,
`src/server/ig/errors.ts`.

LLM: `src/server/llm/client.ts` (`hasLlmKey`, `isCompatMode`, `getLlm`),
`src/server/llm/schemas.ts` (including `VideoLayoutSchema`),
`src/server/llm/error-message.ts`. Compat mode points at the local 9router proxy on
port 20128.

## 5. Key DB tables and what writes them

27 tables in `src/server/db/schema.ts`, 14 migrations in `drizzle/`. Note: the dev
database is push/bootstrap based, not migration tracked, so `db:migrate` replays from
0000 and fails. New DDL gets applied with `sqlite3 data/crowsnest.db < drizzle/NNNN.sql`.

| Table | Written by |
| --- | --- |
| `channels` | `sync-engine.ts`, `channel-actions.ts` |
| `videos` | `sync-engine.ts`, `media-actions.ts` (asset ids), `frame-pass.ts` reads only |
| `video_children` | `sync-engine.ts` (carousel children) |
| `channel_snapshots`, `video_snapshots` | `sync-engine.ts` |
| `video_analyses` | `analyze.ts` (text columns), `frame-pass.ts` (layout columns) |
| `transcripts` | `src/server/transcribe/index.ts`, read by `analyze.ts` and `remix.ts` |
| `media_assets` | `src/server/ig/assets.ts`, `src/server/media/store.ts` |
| `sync_jobs` | `sync-actions.ts`, `sync-engine.ts` |
| `frame_pass_jobs` | `frame-pass-runner.ts`, read by `analyze-actions.ts` |
| `remix_sessions`, `remix_runs` | `services/remix.ts` |
| `scripts` | `services/remix.ts`, `remix-actions.ts` |
| `vault_items` | `vault-actions.ts`, `services/remix.ts` |
| `saved_posts` | `saved-post-actions.ts`, cascade from `channel-actions.ts` |
| `saved_filters` | `saved-view-actions.ts`, seeded by `db/bootstrap.ts` |
| `planned_posts` | `planned-post-actions.ts`, cascade from `channel-actions.ts` |
| `fleets`, `fleet_channels` | `fleet-actions.ts` |
| `app_settings` | `src/server/settings/index.ts`, `settings-actions.ts`, `graph-actions.ts` |
| `secrets` | `src/server/secrets/store.ts` only (`setSecret`, `clearSecret`, `getOrCreateServiceToken`) |
| `log_events` | `src/server/logs/store.ts` only, reached through `POST /api/logs/ingest` |
| `notifications` | `notification-actions.ts` |
| `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments` | `graph-actions.ts` |

Structural choice worth knowing: own-channel data is a separate table family rather than
a flag on `channels`, so "own posts never appear in the outlier feed" is a fact about the
schema rather than a clause every query has to remember.

## 6. Review targets

### Health (code quality)

1. `src/server/services/sync-engine.ts`, 76 KB in one module with a 107 KB test file
   beside it. The single biggest complexity concentration in the repo.
2. `src/server/services/remix.ts` (20 KB) and its 23 KB test. Six stages of prompt
   plumbing.
3. Frame pass set as a unit (`frame-pass.ts`, `frame-pass-runner.ts`, `claude-task.ts`,
   `watch-frames.ts`). New this session, five modules, two subprocess boundaries.
4. Duplicated concerns worth a look: `isUniqueViolation` exists in at least three places
   (`frame-pass-runner.ts`, `media/store.ts`, `sync-engine.ts`); `ReachByPostBars` is
   exported from two different component files (`mine/`, `channels/`).
5. Comment-to-code ratio across `src/server`. Many modules carry long design-rationale
   headers. Judge whether they have drifted from the code they describe.

### Security

1. `src/server/services/claude-task.ts`. Spawning a CLI with a hardcoded absolute binary
   path, `CLAUDE_BINARY_PATH` env override, `--allowedTools Read` as the only sandbox,
   and the prompt built from database content. Prompt injection reaching a `Read` tool is
   the concrete threat.
2. `src/app/api/logs/ingest/route.ts` plus `src/server/secrets/store.ts`. Token compare,
   redaction, `getOrCreateServiceToken`, and the known desync where regenerating the
   token in Settings leaves a hand-started sidecar unauthorized.
3. `src/app/api/media/[assetId]/route.ts`. Path traversal outside `MEDIA_ROOT`, the
   claimed "every failure is a bare 404" property, and range header parsing in
   `src/server/media/range.ts`.
4. `services/ig/crowsnest_ig/app.py`. `require_token` coverage per route (`/health` is
   deliberately outside it), `_constant_time_eq`, and whether error handlers leak
   session or credential detail.
5. Server actions with no auth layer at all. Every action in `src/server/actions/` is
   reachable by any page in the browser; confirm nothing destructive is exposed without
   an id check (`removeChannelAction`, `deleteScriptAction`, `clearSecretAction`).

### Devex

1. `db:migrate` is broken against the dev database (push/bootstrap based, replays from
   0000). New DDL has to be applied by hand. This is a real onboarding trap.
2. `src/server/config.ts`. Env knob discoverability: `VIEW_COUNT_ENRICH_PER_CHANNEL`,
   `EAGER_VIDEO_DOWNLOAD`, `MEDIA_ROOT`, plus the ones read straight off `process.env`
   outside the schema (`CLAUDE_BINARY_PATH` in `claude-task.ts`, `LLM_BASE_URL` in the
   remix page, `MEDIA_ROOT` again in `frame-pass.ts`). Timing constants that arguably
   should be knobs are hardcoded instead: `SYNC_STALL_SECONDS = 90` in `sync-types.ts`,
   with `LOCK_STALE_MS` derived from it in `sync-engine.ts`.
3. Hardcoded machine-specific absolute paths: `claude-task.ts` `DEFAULT_BINARY` and
   `watch-frames.ts` `DEFAULT_SCRIPT` both point into `/Users/kienbeovl/`. The repo does
   not run on another machine without editing them.
4. Two runtimes to start (Next plus the Python sidecar) with no single command. See
   `sidecar-actions.ts` and `services/ig/README.md`.
5. Test suite shape: `sync-engine.test.ts` at 107 KB. Runtime and failure legibility.

### Performance

1. `(shell)/layout.tsx` runs `getFailureStrip` + `getDashboardStats` + `getSavedPosts` on
   every full navigation, and the whole shell is `force-dynamic`. Nothing in the app is
   cached.
2. `GET /api/runs/stream` polls SQLite every 2000 ms per open connection, and both
   `/runs` and `/runs/[runId]` subscribe.
3. `enrichViewCounts`. Up to 200 sequential authenticated requests per channel, each
   with instagrapi's own internal retries on top. Wall-clock cost and heartbeat interplay
   with `SYNC_STALL_SECONDS` and `LOCK_STALE_MS`.
4. Frame pass: `watch.py` (yt-dlp + ffmpeg) then a Claude subprocess with a 600 s
   timeout, held open while the client polls. One at a time globally.
5. Feed queries in `src/server/queries/feed.ts` (`getOutlierFeed`, `getFeedBandCounts`)
   and dashboard aggregates. Check index coverage against `schema.ts`.

### QA (functional)

1. Frame pass state machine end to end: never run, no video asset, running, second
   concurrent attempt, parse failure, ran but empty, success, re-run. The button label
   changes across four of these.
2. View count enrichment with `VIEW_COUNT_ENRICH_PER_CHANNEL` set: cancel mid-pass,
   a deleted reel, three consecutive not-found, and confirming counts land before
   scoring rather than a sync late.
3. Sync cancel and stall: cancel during each phase, and what a stale lock does to
   `softDeleteMissing`.
4. First-run gate both directions: fresh install redirected into `/first-run`, completed
   install redirected out of it, and the Settings control that clears the flag.
5. Remix stages with the LLM proxy down, then up. `generation-blocked.tsx` and the run
   log.

### Design (visual)

1. `/feed` in both grid and list density, plus the quick preview sheet
   (`src/components/feed/`).
2. `/feed/[videoId]` Layout section in its four states. Empty, running, error and
   populated all render in the same slot (`layout-section.tsx`).
3. `/` dashboard dataviz set: `outlier-timeline`, `producer-donut`,
   `reach-score-scatter`, `score-ranking-list`, `stat-tile`. Consistency of the stat tile
   contract (big mono numeral, sample-size caption, dash never a fabricated zero).
4. `/settings` at 11 sections with a sticky anchor nav (`settings-nav.tsx`), and
   `/vault` at 4 tabs. Both are long scrolling screens.
5. Heading hierarchy across the shell. The topbar owns the `h1`, so pages start at `h2`.
   Check for pages that broke that rule.

### Usability (flows)

1. The path from a fresh install to a first outlier on screen. First run, add channel,
   sync, feed. Count the steps and the dead time.
2. Frame pass discoverability and its failure copy. The common first attempt fails with
   "video has no downloaded video asset (sync with downloads first)", which names a thing
   the user has no obvious button for.
3. Empty and blocked states: `/mine` with no own channel and no Graph token,
   `/vault` empty state, remix blocked with no LLM key, dashboard dependency panel.
4. Vault `hooks` and `styles` tabs. The code comments say these are scheduled to move
   into the Remix stage pickers and are only still there because the destination does not
   exist. Judge whether they read as useful or as orphans today.
5. Runs and Logs as a debugging pair. When a sync fails, how many clicks from the failure
   strip to the log line that explains it.
