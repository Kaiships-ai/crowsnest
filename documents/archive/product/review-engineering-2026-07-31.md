# Crowsnest engineering review, 2026-07-31

Independent review, done by reading the code and querying `data/crowsnest.db` directly.
No sync was run, no migration was run, nothing was mutated. Every claim below cites a
file and line or a query result. Scale target used throughout: 50 channels, 5,000
videos, one Mac, one user, per the brief's own framing, not web scale.

## The six scores

| # | Area | Score |
|---|------|-------|
| 1 | Scalability (to 50 channels / 5,000 videos) | 6/10 |
| 2 | Cost per sync and per remix | 8/10 |
| 3 | Implementation tradeoffs | 5/10 |
| 4 | Maintainability | 6/10 |
| 5 | Correctness risk | 4/10 |
| 6 | Test quality | 8/10 |

Detail on each follows. Then the specific checks asked for. Then the one thing most
likely to bite him first.

## 1. Scalability, 6/10

The channel-facing screens are built as one query per aggregate per channel, not one
query for all channels. `getChannelsList` (`src/server/queries/channels.ts:146-157`)
loads every channel row, then calls `buildChannelRow` per channel
(`channels.ts:124-144`), which runs three separate queries in parallel per channel:
`getMedianViews` (`channels.ts:79-98`), `countOutliers30d` (`channels.ts:100-114`), and
`getChannelFleets` (`channels.ts:116-122`). At 50 channels that is 150 queries on every
load of the Channels screen and the Dashboard's fleet section, with nothing cached: the
settings module's own doc comment states the app "never caches. Every call re-reads"
(`src/server/settings/index.ts:26-29`), and no query layer anywhere memoizes a result
within a request either.

`getMedianViews` is the expensive one of the three. It selects every non-deleted video
row for that one channel (`channels.ts:93-96`) and runs `computeChannelBaseline` over
all of them in JS. There is no `LIMIT` and no aggregate pushed to SQL; a channel with
2,000 posts reads and sorts 2,000 rows in Node every time any screen asks for its
median. `getChannelMedianBasis` (`channels.ts:267-302`) runs the identical query a
second time for the same channel when the detail page loads, because it does not reuse
`getMedianViews`'s result. Two round trips for the same data, not two answers (see
section 4 of the specific checks below for why they cannot actually disagree).

`getFleetSpikes` (`src/server/queries/dashboard.ts:139-190`) repeats the same shape: one
query per fleet for membership, one for the outlier count, one for the sparkline rows,
inside a `Promise.all` over `fleets`. Small at today's fleet count, same growth curve as
the channel list.

The write side has the sharper edge. `recomputeChannelScores`
(`src/server/services/sync-engine.ts:745-760`) reads every live video for a channel, then
writes one `UPDATE ... WHERE id = ?` per row in a plain `for` loop, each one a separate
awaited statement, not batched into a transaction. This runs after every single channel
sync (`sync-engine.ts:1049`) and again inside `importReelByUrl`
(`sync-engine.ts:1370`). A channel with 500 posts issues 500 individual round trips to
better-sqlite3 on every sync of that one channel, every time. The transactional twin,
`recomputeAllChannelScoresSync` (`sync-engine.ts:798-803`), is only used for the
settings-change path; the much more frequent per-sync path stays unbatched.

None of this crashes at 50 channels and 5,000 videos. SQLite on local disk answers a
single-row-keyed query in well under a millisecond, so 150 sequential-ish queries and a
few thousand unbatched updates land in the low single-digit seconds, not a hang. What
breaks first as the numbers grow past that is response time on the Channels screen and
the Dashboard (both linear in channel count times per-channel video count, with a cold
read every time), and sync duration for a channel that accumulates hundreds of posts
(linear in that channel's own post count, unbatched). Neither is a wall today. Both are
the first thing to notice once "50 channels" stops being hypothetical.

## 2. Cost, 8/10

Instagram sync itself is free: it goes through the local `instagrapi` sidecar, not a
paid API (`README.md`, Costs section). The only metered calls are Claude.

Analysis is cached and on-demand. `getOrCreateAnalysis`
(`src/server/services/analyze.ts:66-119`) checks `video_analyses` first and returns
without touching Claude on a hit (`analyze.ts:70-83`); a video is analyzed at most once
unless the row is deleted. Nothing calls this automatically on sync. Auto-analyze on a
score threshold is explicitly deferred to P2 in `v1-scope.md` with the reasoning stated
plainly: "Costs money on every sync, and V1 has not yet established what a run costs."
That is the correct call, and it is followed in the code as written.

Remix cost is bounded and visible. `quickRemix` (`src/server/services/remix.ts:471-483`)
makes exactly 5 Claude calls: one for hooks, one for the outline, three for script
variants in parallel via `Promise.allSettled` (`remix.ts:382-384`,
`DEFAULT_VARIANT_COUNT = 3` at `remix.ts:65`). Every generation call is triggered by a
user click, none of them loop or retry on their own, and every attempt (success or
failure) writes a `remix_runs` row (`remix.ts:83-95`), so a run's real cost is
reconstructable after the fact.

Points off for two things. First, nothing in the code enforces a spend ceiling: a user
who mashes "Regenerate all" has no rate limit or daily cap between them and their
Anthropic bill, only their own judgment. That is a reasonable choice for a single-user
tool, but it is a choice, not a guarantee, and it is worth being deliberate about if this
ever stops being one person's Mac. Second, `v1-scope.md`'s P0 list for Video detail asks
for "Analyse gate with a cost-honest line" that could not be confirmed built (not
checked as a UI review is out of scope here); if it is missing, the one place the app
could tell Kai what a click is about to cost him is silent about it.

## 3. Implementation tradeoffs, 5/10

The clearest tradeoff is a scope commitment not met: `v1-scope.md` lists the Layout
section, a frame pass, and an "unverified marker on any tag the model guessed without
frames" as P0 for Video detail, justified by "the one job names layout... cutting it
cuts a third of the product's stated purpose." The schema comment on
`videoAnalyses.layout` (`src/server/db/schema.ts:182-192`) says plainly there is "no
frame pass wired up yet (no image-input path on the LLM client, no frame sampler)" and
every row's `layout` is null today. This is stated honestly in the code, not hidden, but
it means one of the three things the product's own one-line mission promises (hook,
script, layout) is not built. That is a product decision to surface, not a bug to file,
but it belongs on this list because it is the single largest gap between what the brief
calls non-negotiable and what ships.

Two smaller tradeoffs, both speed-over-correctness in a way that will cost a rewrite
later rather than cost a wrong answer today:

- `own-metrics.ts:24` hardcodes `const MIN_USABLE = 5` for own-channel reach, a second,
  independent copy of the idea `score_min_usable_posts` already represents as a
  configurable setting (`src/server/settings/index.ts:47`, default `5`). They agree by
  coincidence today. Change the setting on the Settings page and the tracked-channel
  scores move; the own-channel median silently does not, because it never reads the
  setting. The doc comment on `own-metrics.ts` argues, correctly, that reach and views
  are different units and should not share a *baseline function*. That argument does not
  extend to the *minimum sample size*, which is a policy choice about trustworthy
  medians in general, not a units question, and there is no comment explaining why that
  one number was left independent rather than pulled from settings too.

- `MAX_ITEMS_PER_SYNC` never made it into `app_settings`. It is read directly from
  `config.MAX_ITEMS_PER_SYNC` in `sync-engine.ts:1116` and `sync-actions.ts:293`,
  bypassing the settings module's DB-over-env-over-default precedence entirely, while
  its sibling `syncLookbackDays` did make the move (`settings/index.ts:60`). A real
  per-run safety cap that cannot be changed without an env var and a restart, sitting
  next to five other sync-relevant settings that can be changed from a page, is an
  inconsistency a future reader will trip on.

## 4. Maintainability, 6/10

The raw numbers are real: `sync-engine.ts` is 1,417 lines, `schema.ts` defines 23
tables. But the comment density materially changes what those numbers mean in practice.
Both files carry inline rationale for nearly every non-obvious decision, frequently
citing the specific incident that motivated it: `sync-engine.ts:196-201` explains why
two runs on one channel is a corruption bug, not a pacing one, and names the real
incident ("this codebase has already lost 8 live @kallaway posts to a soft-delete");
`schema.ts:369-377` explains why NULL cannot be the library-run lock key, and says it
was verified, not assumed. A new reader six months out is not starting from the diff
alone, which is a genuine mitigation against the file-size problem, not a coat of paint
over it.

What the comments cannot fix is the number of places one idea now lives. Scoring alone
has three recompute entry points that must stay in lockstep by convention, not by a
shared implementation: `recomputeChannelScores` (async, per-channel, sync-engine.ts:745),
`recomputeChannelScoresSync` (sync, per-channel, inside a transaction,
sync-engine.ts:767), and `recomputeAllChannelScoresSync` (sync, all channels,
sync-engine.ts:798). The settings module has a matching async/sync pair
(`getSettings` / `resolveAllSettings`) for the same "better-sqlite3 transactions must be
synchronous" reason. Each pairing is well justified on its own terms in its own comment,
but a future change to how a score is computed has to be found and applied in three
places, and nothing but a shared test suite enforces that they stay equivalent.

23 tables for a single-user local tool is a lot of schema to hold in one head, even a
well-commented one. Some of that is inherent to the product's own scope (own-channel
Insights alone is 4 tables, the planner is 1, the remix run log is 1), not padding.

## 5. Correctness risk, 4/10

`videos.outlier_score` is a stored, materialized column
(`src/server/db/schema.ts:110`), recomputed on write, not derived on read. This is a
real, already-realized risk, not a hypothetical one: two separate bugs from this exact
pattern were found and fixed today.

- Commit `1109299` ("a failed recompute can no longer leave scores half rewritten"): the
  settings-change recompute walked every channel with plain sequential updates: a throw
  partway through would leave some channels scored under the new setting and some under
  the old one, with the settings page reporting success. Fixed by wrapping the settings
  write and the full recompute in one `db.transaction` so a failure rolls back
  everything, proven by a test that throws mid-transaction and asserts neither write
  survived (`src/server/actions/settings-actions.test.ts`, the rollback-primitive test
  added in that commit).
- Commit `53ed4c9` ("the median on screen is the median the scores were divided by"):
  `getMedianViews` used to prefer the latest `channel_snapshots` row and fall back to a
  live computation. Once baseline method and window became settings, a snapshot written
  before a settings change could disagree with a score computed after one, and both
  numbers looked authoritative on their own screen. The fix, and the reasoning, are
  documented in `channels.ts:79-98`; the regression test is
  `channels.test.ts:206-223`.

Both are fixed and both are now covered by a test that reproduces the exact failure.
The residual risk is structural, not a live bug: nothing in the schema enforces that
`outlier_score` gets recomputed whenever the set of live videos for a channel changes.
Today only two code paths mutate that set (`sync-engine.ts`'s sync path and settings
changes), and both remember to call the recompute. A third write path added later
(a manual view-count correction, a bulk re-import, anything that touches `videos` without
going through `sync-engine.ts`) has no structural guard forcing it to also call
`recomputeChannelScores`; it would just leave a stale score sitting next to a fresh one,
exactly like the two bugs above, and nothing would flag it until someone noticed the
number on screen looked wrong. A trigger or a single funnel-point for "anything that
changes `videos.view_count` or `videos.deleted_at` recomputes that channel's scores"
would close this structurally; right now it is closed by two call sites remembering to
do the right thing.

## 6. Test quality, 8/10

892 tests, and the samples read as testing behavior, not restating the implementation.
`channels.test.ts` is a strong example: several tests exist specifically because a real
bug was found, and they assert the *user-visible* consequence, not an internal call
count. The soft-delete exclusion test seeds a soft-deleted video with an inflated score
and view count "that would corrupt both stats if it were ever counted as live"
(`channels.test.ts:128-147`) and asserts the real numbers, not that a filter function was
called. The stale-snapshot test (`channels.test.ts:206-223`) is a direct regression test
for commit `53ed4c9`, seeding a `channel_snapshots` row that disagrees with the computed
value and asserting the computed value wins.

`sync-engine.test.ts` (57 `test`/`it` blocks) covers concurrency (same-channel and
library-vs-channel lock overlap, `sync-engine.test.ts:559-666`), cancellation mid-page
and mid-backoff (`:1210-1465`), retry budgets and Instagram's own retry-after hint
(`:1011-1209`), and the specific soft-delete guardrails that prevented a repeat of the
lost-post incident (`:325-484`). This is real coverage of a genuinely hard concurrency
and failure-handling surface, exercised against a real in-memory SQLite database and a
mocked `IgClient`, not a fully mocked-out unit test asserting mock-call arguments.

The eight points off, not ten, are for what this kind of test cannot prove, covered in
the sync_jobs finding below: every one of these tests validates the engine's logic
against an `IgClient` stub that behaves exactly as the engine's author expects it to.
None of them prove the real `instagrapi` sidecar actually behaves that way under a real
multi-channel, multi-minute run against live Instagram rate limiting.

## The specific checks

**Migrations 0005, 0006, 0007, applied to the live database today.** Confirmed applied:
`drizzle/meta/_journal.json` lists all eight migrations through `0007_gorgeous_unus`,
and `data/crowsnest.db` has the tables they create (`own_posts`, `planned_posts`,
`saved_posts`, `remix_runs`, and the new `video_analyses` columns). They are not
reversible: `drizzle-kit generate` for this project only ever writes forward migrations,
there are no down-migration files anywhere in `drizzle/`, and the mechanism
(`drizzle-orm/better-sqlite3/migrator`) has no rollback command. `0002_drop_cdn_url_columns.sql`
already establishes that this is a real constraint, not a theoretical one: it drops
`avatar_url`, `thumbnail_url`, and `video_url` with `ALTER TABLE ... DROP COLUMN`, and
that data is gone from any database that has run it, permanently. On a fresh clone this
is a non-issue: `npm run db:migrate` replays all eight in order against an empty file and
the result is deterministic. The exposure is entirely on the one existing
`data/crowsnest.db`: there is no backup step before `db:migrate` runs, in the README or
anywhere else, so the only real database this project has ever had was migrated three
times today with no snapshot taken first. Nothing observed suggests today's three
migrations caused any damage, but the practice has no safety net if a future one does.

**Settings precedence (DB over env over default), consistent or not.** Mostly
consistent. Every scoring-relevant setting (`scoreBaselineMethod`, `scoreBaselineWindow`,
`scoreMinUsablePosts`, `scoreMinViewsFloor`, `syncLookbackDays`) is read exclusively
through `getScoringOptions()` / `getSetting()`, confirmed by grep: no file outside
`settings/index.ts` reads `config.LOOKBACK_DAYS` directly anymore, and `sync-engine.ts:1112`'s
own comment says so. The one confirmed bypass is `MAX_ITEMS_PER_SYNC`, covered above in
section 3: it is a real per-sync behavior control that skips the settings module
entirely and is read straight off `config` in both `sync-engine.ts:1116` and
`sync-actions.ts:293`. No other direct `process.env` reads were found touching anything
the settings module claims to own; the rest of the `process.env` call sites are API
keys, binary paths, and log level, none of which `app_settings` models.

**own-metrics.ts's private `MIN_USABLE = 5` versus the configurable
`score_min_usable_posts`.** Confirmed two independent sources of truth for the same
idea, detailed in section 3. They hold the same value today (both default to 5) purely
because nobody has changed the setting yet. They will disagree the first time Kai
changes "minimum posts before a score is computed" on the Settings page: tracked-channel
scores move, the own-channel median does not, silently.

**Whether `getChannelMedianBasis` and `getMedianViews` can disagree.** No, they
structurally cannot, though they are two separate queries doing redundant work to get
there. Both select the same rows (`eq(channelId), isNull(deletedAt)`,
`channels.ts:93-96` and `channels.ts:271-274`), both resolve options via the same
`getScoringOptions()` call, and both pass those options into the same pure function,
`computeChannelBaseline` (`outlier-calc.ts:116-124`). Same input, same function, same
output, by construction, confirmed by the test at `channels.test.ts:360-387` which
computes the expected value independently and asserts the basis query matches it. The
inefficiency is real (two round trips fetching the same rows when a screen needs both),
the disagreement risk is not.

**`sync_jobs` and the state of real sync coverage.** Not literally zero rows: one row
exists (`13b82b95-4d6a-45d9-abb2-da8b8ed6cbc4`), status `partial`, `stop_reason
cancelled`, `items_seen 0`, `items_created 0`, for the `@hormozi` channel, started and
finished 32 seconds apart today. That is functionally the same finding stated slightly
differently: no sync has ever run to completion, and the one attempt on record was
stopped before it fetched a single item. Worth flagging on top of that: `@kallaway`
carries `last_synced_at = 2026-07-27` and 8 real videos in the `videos` table, four days
before the one logged sync attempt and with no corresponding `sync_jobs` row for it at
all. Either that data predates the current `sync_jobs`-backed engine, or a job row was
removed at some point; either way, `sync_jobs` alone cannot currently answer "how did
the data that's in the database get there," which matters because it is also the table
every failure-surface screen reads from. What this means for confidence: the whole
retry ladder, the cancel-and-resume logic, the heartbeat and stale-lock reaping, the
soft-delete safety checks, all thoroughly unit-tested against a mocked `IgClient`
(section 6), have never been proven against the real sidecar for a run longer than 32
seconds. The first real multi-channel sync is the first time this code meets Instagram's
actual rate limiting, actual challenge flows, and actual multi-minute runtimes, and nothing
in the test suite or the database can currently speak to whether it holds up.

## The one thing most likely to bite him first

The sync engine is the most heavily engineered, most heavily tested file in the
codebase, and it is also the least proven against reality. Every failure mode it
handles (rate limiting, stale locks, cancellation mid-request, a metric Instagram
withheld this time, retry budgets, heartbeat liveness) is real, well-reasoned, and
covered by a test against a mock. None of it has been exercised against the real
`instagrapi` sidecar for anything longer than the one 32-second cancelled run in
`sync_jobs`. Kai's next action with this tool is almost certainly a real multi-channel
sync, which makes the least-verified code path in the app also the very first thing he
is about to run for real, at whatever scale he adds channels to. If something surprises
him, it will surprise him there first, not in the scoring math or the settings page,
both of which have direct regression tests proving they already broke once today and got
fixed.
