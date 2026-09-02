# Crowsnest performance review, static half

Written at `main` / `8909788`. Report only, no code changed, no branch switched. HEAD was
verified unchanged at the end of the pass.

Companion to `docs/reviews/2026-08-04-surface-map.md`, which set the boundary. A separate
Perf-runtime pass will measure real page loads in a browser; nothing here touched the
browser or the dev server.

## How the numbers were produced

Two SQLite databases, both copies, never the live one:

- `perf.db`: a `sqlite3 .backup` snapshot of `data/crowsnest.db` as it stands today.
  452 videos, 10 channels, 6490 log events, 40 sync jobs.
- `scale.db`: the same snapshot grown to 20,340 videos and 1,480 sync jobs by
  duplicating real rows, keeping real column widths including `raw_payload`. That is
  45x today's library, which is roughly what 10 channels look like after a year of
  30-day syncs. No `ANALYZE` was run, matching production (the real database has no
  `sqlite_stat1` row, verified).

Timings come from `better-sqlite3` out of this repo's own `node_modules`, warmed then
averaged over 10 to 500 iterations. They are pure database and hydration cost. They do not
include React rendering, network, or the Next.js server component pipeline, so treat them
as a floor, not a page load time.

Anything below marked **estimate** was reasoned from a constant already measured and
recorded in this repo, not measured by me.

## The one-line summary

At today's 452 videos nothing in the database is slow. Every hot query is under a
millisecond. The findings below are almost all about what happens as the library grows,
plus two that already cost real bytes today.

The top hotspot is a single redundant sort key in the feed query that makes every index on
`videos.outlier_score` unusable. Removing it is a 241x speedup on the default feed sort with
byte-identical results.

---

## High impact

### H1. The `IS NULL` sort key blocks every index on the feed's default sort

`src/server/queries/feed.ts:204`, and the identical `orderBy` at
`src/server/queries/dashboard.ts:107`.

The order is built as `outlier_score IS NULL` first, then `outlier_score DESC`. SQLite
cannot serve an ordering whose leading term is an expression, so the planner falls back to
a full scan of `videos` plus a temp b-tree, no matter what indexes exist. This is the
default sort on `/feed`, the sort `getTopOutliersToday` uses on the dashboard, and the sort
`resolveFeedNav` uses on every video detail page.

The comment on that line already says the key is redundant: SQLite sorts NULLs last under
DESC anyway, and it was kept only so intent reads clearly at the call site.

**Measured**, on scale.db with an index on `videos(outlier_score desc)` present:

| Query | With the `IS NULL` key | Plain `DESC` | Speedup |
| --- | --- | --- | --- |
| feed page 1, limit 24 | 12.91 ms | 0.054 ms | 241x |
| feed page 21, offset 480 | 14.06 ms | 0.066 ms | 213x |

Plans: `SCAN v ... USE TEMP B-TREE FOR ORDER BY` becomes
`SCAN v USING INDEX ix_v_score`. The two queries return byte-identical result rows,
verified by comparing the returned id lists.

Today, at 452 videos, the same query costs 0.128 ms, so this is invisible right now.

**Fix.** Drop the `outlier_score IS NULL` term from `buildOrderBy` and from
`getTopOutliersToday`, then add `create index videos_outlier_score on videos(outlier_score desc)`.
Keep the intent in a comment rather than in the SQL. If explicit NULL placement is ever
genuinely wanted, `ORDER BY outlier_score DESC NULLS LAST` is index-friendly on SQLite 3.30
and later.

### H2. The dashboard pulls 10,000 feed rows and ships them all to the browser

`src/app/(shell)/page.tsx:77` calls `getOutlierFeed({ sort: "score", limit: 10_000, offset: 0 })`.
The resulting `allItems` array is passed as a prop to five components at
`src/app/(shell)/page.tsx:193` through `:198`. One of them,
`src/components/dashboard/score-ranking-list.tsx:1`, is a `"use client"` component, so the
entire array crosses the server/client boundary and is serialized into the RSC flight
payload on every dashboard load.

`ScoreRankingList` renders 8 rows by default (`COLLAPSED_LIMIT = 8` at line 13). The other
9,992 items exist so a "show all" toggle can expand without a round trip.

**Measured:** a FeedItem serializes to 913 bytes.

| Library size | Items shipped | RSC payload | SQL plus hydration |
| --- | --- | --- | --- |
| today, 452 videos | 452 | 403 KB | 0.13 ms |
| scale.db, 20,340 videos | 10,000 (capped) | 8.8 MB | 34.5 ms |

The 403 KB is a cost being paid today, on every dashboard visit, to render 8 rows.

**Fix.** Do the shaping on the server. `rankableItems` and the other functions in
`dashboard-chart-data.ts` are pure and already run server-side for the four non-client
charts; only the collapse toggle needs to be a client component, and it only needs the rows
it will actually render. Passing `ranked.slice(0, 200)` plus a count would cut the payload
by more than 95 percent. Separately, `limit: 10_000` should become a real cap tied to what
the charts need rather than a number chosen to mean "all of them".

### H3. Every video detail page load fetches 5,000 rows to compute one array index

`src/app/(shell)/feed/[videoId]/resolve-feed-nav.ts:23` sets `FEED_ORDER_LIMIT = 5000`, and
line 57 runs the full feed query at that limit purely so line 58 can `findIndex` the current
video and read its two neighbours.

The file's own comment defends this as cheap on local SQLite, and at today's scale it is
right. The cost is not the SQL, it is hydrating and holding 5,000 objects to use three of
them.

**Measured:**

| Library size | Rows hydrated | Time | Hydrated size |
| --- | --- | --- | --- |
| today, 452 videos | 452 | 0.77 ms | 405 KB |
| scale.db, 20,340 videos | 5,000 | 26.14 ms | 4.2 MB |

Note this query carries the H1 sort key, so fixing H1 alone drops the SQL portion by two
orders of magnitude. The hydration cost stays.

**Fix.** Replace the fetch-then-scan with a windowed query: `row_number()` over the same
ordering, then select the rows at `n-1`, `n`, `n+1`, plus one `count(*)` for the
"x of y" label. Three values instead of 5,000 rows, and it removes the silent correctness
cliff the comment describes where a library past 5,000 posts loses its prev/next links.

### H4. The shell layout runs two full scans of `videos` on every navigation

`src/app/(shell)/layout.tsx:40` awaits `getFailureStrip`, `getDashboardStats` and
`getSavedPosts` on every full navigation into the shell, and the layout is `force-dynamic`
(line 19). Nothing in the app is cached.

The layout uses the result for four booleans in the get-started checklist:
`stats.channelsTracked > 0`, `savedPosts.length > 0`, `stats.scriptsDrafted > 0`, and the
first-run flag. It never reads `viewsSparkline`, `newOutliers7d`, `vaultedThisWeek`, or
`channelsDelta7d`, but `getDashboardStats` computes all of them.

Two of those unused computations are full scans of `videos`:

- `src/server/queries/dashboard.ts:70` counts outliers in the last 7 days.
  Plan: `SCAN videos`. No index covers `(outlier_score, posted_at, deleted_at)`.
- `src/server/queries/dashboard.ts:85` selects every `posted_at` and `view_count` from the
  last 90 days and buckets them into 12 sums **in JavaScript**
  (`bucketViewsByPostedAt`, line 19). Plan: `SCAN videos`.

**Measured:**

| | today, 452 videos | scale.db, 20,340 videos |
| --- | --- | --- |
| outliers-7d count | 0.024 ms | 14.47 ms |
| 90-day sparkline scan | 0.086 ms (449 rows) | 15.80 ms (4,993 rows) |
| whole shell layout read | 0.12 ms | 30.28 ms |

With an index on `videos(posted_at desc)` the outliers-7d count drops from 12.83 ms to
0.022 ms, a 582x speedup, measured.

**Fix.** Three separate things, cheapest first. Add `create index videos_posted_at on videos(posted_at desc)`.
Move the sparkline bucketing into SQL as a `GROUP BY` over a computed bucket index so it
returns 12 rows rather than 5,000. Give the layout its own lean query for the three booleans
it needs instead of reusing `getDashboardStats` wholesale; the comment at line 36 that calls
the reuse "not a real cost" is correct today and stops being correct at roughly 5,000 videos.

---

## Medium impact

### M5. The SSE stream reads every run row every two seconds, then throws most away

`src/server/queries/runs.ts:111` and `:112` select **all** of `sync_jobs` and **all** of
`remix_runs` with no `LIMIT`, merge and sort in JavaScript, then `slice(0, 50)` at line 116.
`src/app/api/runs/stream/route.ts:41` calls this every 2000 ms per open connection, and
enqueues the payload whether or not anything changed. Both `/runs` and `/runs/[runId]`
subscribe.

**Measured** on scale.db with 1,480 sync jobs (roughly a year at four syncs a day):

- 0.97 ms per tick to read and serialize.
- 1,480 sync job rows plus 11 remix rows read, 50 kept.
- 33.4 KB on the wire per tick, which is 16.3 KB/s per open connection.
- Per open tab per hour: about 1.75 s of CPU and 60 MB written to the socket.

`sync_jobs` grows one row per sync forever. There is no retention policy on it.

**Fix.** Push the limit into SQL. Two `LIMIT 50` queries merged and re-sliced gives the same
answer and reads 61 rows instead of 1,491. Then hold the last serialized payload and only
enqueue when it differs, which turns an idle Runs tab from 60 MB/hour into approximately
zero. A comment-only heartbeat every 15 s keeps the connection alive.

### M1. `/feed` runs five scans of `videos` per page load, four of which are counts

One `/feed` render triggers, all under the H1 non-indexable ordering:

1. the page itself, `getOutlierFeed` (`feed.ts:217`),
2. the total count in the same `Promise.all` (`feed.ts:225`),
3. three band counts, one per follower band (`getFeedBandCounts`, `feed.ts:261`).

Each band count calls `buildWhere` again (`feed.ts:252`), which re-runs the fleet
membership subquery (`feed.ts:185`) when a fleet filter is active. So a fleet-filtered feed
load issues four separate `fleet_channels` lookups for the same fleet.

**Measured:** page 0.128 ms, total count 0.015 ms, one band count 0.025 ms today, for
0.218 ms per feed load. On scale.db: 17.93 / 0.68 / 1.20 ms, for 22.21 ms per feed load.

**Fix.** One `GROUP BY` over a `CASE` expression on `channels.follower_count` returns all
three band counts in a single pass, and it can share the scan with the total count. Resolve
fleet membership once and pass the id list into `buildWhere`.

### M3. `getChannelsList` is an N+1, and three screens call it

`src/server/queries/channels.ts:160` maps `buildChannelRow` over every channel, and
`buildChannelRow` (line 129) fires three queries per channel: the median basis (which
selects every non-deleted video for that channel, line 97), the 30-day outlier count
(line 104), and the fleet memberships (line 120).

Callers: `src/app/(shell)/page.tsx:78`, `src/app/(shell)/feed/page.tsx:19`, and
`src/app/(shell)/mine/page.tsx:48`. So the dashboard and the feed each pay it on every load.

`getKanbanBoard` (`channels.ts:186`) then adds a fourth per-channel query on top, calling
`getChannelMedianBasis` again for every channel it just built.

**Measured** on scale.db: 16.34 ms for 10 channels, which is 1.63 ms per channel.
**Estimate** at 100 channels: about 163 ms, on the dashboard and the feed, per load.

**Fix.** Three grouped queries. The outlier count and the fleet memberships are plain
`GROUP BY channel_id` aggregates. The median needs the rows, but one query fetching
`(channel_id, view_count, posted_at)` for all channels at once, bucketed in JavaScript,
replaces N queries with one. For the kanban, compute the basis once and reuse it rather
than recomputing per card.

### M4. `getFleetSpikes` is an N+1 over fleets, and buckets in JavaScript

`src/server/queries/dashboard.ts:166` maps over every fleet and issues, per fleet: a
membership lookup (line 168), an outlier count (line 175), and a 90-day row fetch (line 189)
that pulls every matching row into JavaScript for `bucketViewsByPostedAt`.

Three queries per fleet, and the third scales with the fleet's post count, not with the 12
numbers it produces. Same shape as H4's sparkline, same fix.

### M2. "Load more" on `/feed` grows the limit and never moves the offset

`src/app/(shell)/feed/page.tsx:75` builds the load-more link as
`loadMoreParams.set("limit", String(filters.limit + LOAD_MORE_STEP))`, with `offset` fixed
at 0 (line 38). Click 20 re-fetches 504 rows and re-renders the whole grid from scratch.

**Measured** SQL cost on scale.db: limit 24 is 14.20 ms, limit 1008 is 16.40 ms. The SQL
barely grows because the H1 scan dominates either way.

The real cost is the payload and the render. At 913 bytes per item, click 41 ships about
920 KB of RSC payload and mounts 1,008 cards. That is a client-side cost this static pass
cannot measure; **flagging it for the Perf-runtime pass** as the most likely place to find a
long task.

**Fix.** Fixing H1 makes offset paging cheap, at which point append-on-scroll with a real
offset replaces the growing-limit pattern.

### M8. The dashboard blocks on two live network pings before it renders anything

`src/app/(shell)/page.tsx:84` and `:85` put `getIgStatusAction()` and
`testAnthropicKeyAction()` inside the same `Promise.all` as the page's queries, with no
Suspense boundary. The page cannot start streaming until both settle.

- The sidecar health call has a 5,000 ms timeout (`src/server/ig/client.ts:410`).
- The LLM ping is wrapped at 6,000 ms (`LLM_PING_TIMEOUT_MS`,
  `src/components/status/dependency-status.ts:203`).

So a dashboard load has a worst case time to first byte of about 6 s when the 9router proxy
is down or slow, against a database cost of 0.12 ms. In practice this is almost certainly
the dominant dashboard latency, not any query in this report. **The Perf-runtime pass should
confirm it by loading `/` with the proxy stopped.**

**Fix.** Wrap `DependencyStatusPanel` in `<Suspense>` and let it stream in. The panel is a
status widget; the KPIs and charts should not wait for it.

### M7. `enrichViewCounts` is the longest serial stretch in the app, and it holds the sidecar lock

`src/server/services/sync-engine.ts:781` loops over up to 200 reels per channel
(`VIEW_COUNT_ENRICH_PER_CHANNEL`, range 0 to 200, `src/server/config.ts:75`), one
authenticated request each. Node paces with `jitterMs()` between reels
(`sync-engine.ts:827`), which is 300 to 800 ms, average 550 ms. The sidecar paces
independently with `client.delay_range = [1, 3]`
(`services/ig/crowsnest_ig/session.py:247`).

**Estimate**, built on this repo's own measured constant: the comment at
`session.py:243` records a single call taking 1.9 s under the correct configuration. Adding
Node's average 550 ms gives about 2.45 s per reel.

| Budget | Per channel | 10 channels |
| --- | --- | --- |
| 50 reels | about 2 min | about 20 min |
| 200 reels | about 8 min | about 82 min |

`ManagerSession.call` holds one re-entrant lock for the whole operation
(`services/ig/crowsnest_ig/session.py:600`), so for that entire window every other
authenticated sidecar route queues behind it. A manual download or a reel import started
during a large enrichment pass will appear to hang.

**Verified as fine, and worth not "fixing":** `/health` escapes the lock.
`manager.logged_in()` and `manager.username()` read `self._client` directly without
acquiring it (`session.py:329` and `:333`), so the dashboard's dependency ping and the
Settings status panel stay responsive during a sync. That looks like an oversight and is
not one.

**Verified as fine:** the pass ticks a heartbeat per reel (`sync-engine.ts:793`), so at
about 2.45 s per reel it comfortably beats `HEARTBEAT_MAX_SILENCE_MS`, which is
`SYNC_STALL_SECONDS * 1000 / 3` = 30 s (`sync-engine.ts:100`). The stall and stale-lock
hazard the surface map flagged does not fire on timing alone.

**Fix.** Nothing about the pacing; it is deliberate and correct for a burner account. What
is missing is that the cost is invisible before you pay it. Setting
`VIEW_COUNT_ENRICH_PER_CHANNEL` to 200 with 10 channels signs the user up for over an hour
with no warning anywhere. The setting's help text should state the arithmetic.

---

## Low impact

### L1. `recomputeChannelScores` issues one UPDATE per video outside a transaction

`src/server/services/sync-engine.ts:1050`. The synchronous twin at line 1069 runs inside a
transaction; the async one, used after every channel sync, does not.

**Measured** on scale.db, 5,355 rows in the largest channel: 43.47 ms as loose autocommits
versus 29.98 ms inside one transaction. A 1.45x difference, about 13 ms. Real but small.

The stronger argument for wrapping it is atomicity, not speed: a crash mid-loop currently
leaves a channel with half its scores recomputed against a new baseline and half against the
old one, and nothing records that.

### L2. The database has never been analyzed

`data/crowsnest.db` has no `sqlite_stat1` table (verified: 0 rows). SQLite is planning every
query in this report without table statistics. It got the plans right anyway, because the
schema is simple, but a one-line `ANALYZE` after a sync would remove a class of future
mystery. Cheap insurance, no downside.

### L3. `videos.raw_payload` is 60 percent of the database

**Measured:** 452 rows, 6,195,097 bytes of `raw_payload`, averaging 13.7 KB per row, in a
10.4 MB database. No query path I traced reads the column; every read path selects explicit
columns (`feedItemColumns` at `feed.ts:70` is the shared shape and does not include it).

That is the right design and it means the column costs nothing at read time, since SQLite
pushes blobs that size into overflow pages. It does mean the database file grows at about
14 KB per tracked post: **estimate**, 20,000 posts is a 300 MB file, which is what
`scale.db` weighed in at (312 MB, measured). Worth knowing before someone is surprised by it,
and worth a retention policy eventually. Not worth changing now.

### L4. Two unused shadcn components drag two dependencies into `package.json`

`src/components/ui/form.tsx` (167 lines) and `src/components/ui/resizable.tsx` (50 lines)
have zero importers anywhere in `src`, verified by scanning every `ui/*` component for
external importers. They are the only consumers of `react-hook-form` (2.1 MB on disk) and
`react-resizable-panels` (556 KB).

Separately, `shadcn` (6.5 MB) is a scaffolding CLI listed under `dependencies` rather than
`devDependencies` in `package.json:41`.

None of this reaches the browser: unused modules are not bundled, and the two `radix-ui`
umbrella imports in the repo (`ui/form.tsx:4` and `:5`) are inside one of the dead files, so
the umbrella barrel never enters the graph either. This is install size and dependency
surface only. Delete the two files, drop the two dependencies, move `shadcn` to
`devDependencies`.

### L5. Log search scans the full JSON blob

`src/server/logs/store.ts:99` searches with `like(logEvents.fields, "%needle%")` over the
serialized JSON. Plan: `SEARCH log_events USING INDEX log_events_level_id` then
`USE TEMP B-TREE FOR ORDER BY`, so it is bounded by the level partition rather than the whole
table, but at `RETENTION_MAX = 50000` (line 30) it is still up to 50,000 JSON strings walked
per keystroke-driven search. Only matters if the Logs screen ever gets a live-as-you-type
filter. FTS5 is the answer if it does.

### Measured and found NOT to be a problem

Recording these so nobody spends time on them.

- **The retention DELETE after every log insert** (`store.ts:86`). Measured at zero
  detectable overhead. The predicate is on the rowid and the `max(id)` subquery is an index
  lookup. It looked like a second write per log line and costs nothing.
- **Media streaming** (`src/app/api/media/[assetId]/route.ts:34`) uses `createReadStream`
  with range support, never `readFile`. A 15 MB reel is not buffered into memory. Correct.
- **Sync progress polling** (`src/components/sync/sync-progress-view.ts:330`) returns `null`
  when the tab is not visible, so a background tab stops polling entirely. Correct, and
  better than the SSE stream in M5, which has no such check.
- **The client bundle's import surface** is lean. There is no charting library; the
  dashboard visuals are hand-rolled SVG. `@anthropic-ai/sdk` is imported only under
  `src/server/llm/` (verified). `@base-ui/react` is imported through 18 deep subpaths, which
  is already the tree-shakeable form. `lucide-react` (44 import sites) is in Next 16.2.11's
  default `optimizePackageImports` list, verified in
  `node_modules/next/dist/esm/server/config.js:914`.

### Not measured

**Production bundle sizes.** A `next dev` server is running against this checkout (PID
30461), and `next build` writes to the same `.next` directory, so building would have broken
the running server that the other reviewers in this swarm are using. `next.config.ts` sets no
`distDir`, so there was no safe way to build into a separate directory without editing a
tracked file, which this pass is not allowed to do.

Handing this to the Perf-runtime pass: run `next build` once the dev server is free and check
the First Load JS per route, especially `/` and `/feed`. Based on the import survey above I
expect it to be unremarkable, and I expect the RSC payload from H2 and M2 to dwarf the
JavaScript bundle either way.

---

## Suggested order of work

Ranked by measured benefit over effort:

1. **H1**, drop the `IS NULL` sort key and add the `outlier_score` index. Two lines and one
   migration, 241x on the app's most-run query, and it unblocks H3 and M2.
2. **H4**, add the `posted_at` index and aggregate the sparkline in SQL. 582x on the
   outliers-7d count, and it runs on every navigation.
3. **H2**, stop shipping 10,000 feed items to a client component. 403 KB saved per dashboard
   load today, before any growth.
4. **M8**, wrap the dependency panel in Suspense. Probably the largest wall-clock win of
   anything here, and the smallest diff.
5. **M5**, put the `LIMIT` in the SQL and skip unchanged SSE payloads.
6. **H3**, then **M1**, **M3**, **M4**, which are all the same "one query instead of N"
   shape.
