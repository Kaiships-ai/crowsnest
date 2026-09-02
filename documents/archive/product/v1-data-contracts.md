# V1 data contracts

Written 2026-07-31. Owner: the data layer contract.

This document exists so the backend team and the frontend team can build at the
same time against a written interface instead of guessing at each other. For
every hole V1 has to fill it names the table, the columns, the query signature
with its return type, the server action signature, and what the thing returns
when it fails. Failure is the normal state in this product, so the failure
paragraph is not an appendix, it is half the contract.

No code here. No migrations run. Contracts only.

**Scope rulings folded in, 2026-07-31.** Graph API env variables are optional and
never required, so a machine with no token still boots. Scheduling is in V1 as a
manual planner with no publish path. Multi platform is cut, Instagram only, with
the `platform` columns left untouched so adding one later stays additive. All
seven contracts are unblocked.

## How to read this

Each contract has the same six parts.

- **Why**, one line, tied to the screen that needs it.
- **Tables**, in the drizzle style already used in `src/server/db/schema.ts`.
- **Queries**, in `src/server/queries/`, returning plain data.
- **Actions**, in `src/server/actions/`, `"use server"`, never throwing.
- **Failure**, every case the caller has to render.
- **Migration**, whether a migration is needed and whether it can destroy data.

## Conventions these contracts inherit

Read from the existing code, not invented here. Anything that breaks one of
these is a bug in the contract, not a style choice.

**Timestamps are text.** Every time column in `schema.ts` is `text()` holding an
ISO 8601 string, written through `nowIso()` from `src/server/db/index.ts`. No
contract below introduces an integer epoch column.

**Ids are text uuids** from `newId()`. Primary keys are `text("id").primaryKey()`.

**Queries return data or null, and are allowed to throw.** `getChannelDetail`
returns `ChannelDetail | null` and lets a database error propagate. Query
modules are not the error boundary.

**Actions are the error boundary and never throw.** `src/server/actions/sync-actions.ts`
defines the shape everything else follows:

```ts
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };
```

The `code` field is load bearing. The UI has to tell a rate limit apart from an
expired token apart from a sidecar that is not running, and each of those has a
different next step for the user. Every action below returns a code on failure.

**Nothing in this codebase calls `revalidatePath` or `revalidateTag`.** Verified
by grep across `src`: zero hits. Pages that read live state set
`dynamic = "force-dynamic"` and the client re-reads after an action, either by
router refresh or by polling, which is how the sync rail already works. New
actions follow the same rule. A contract below that says "the caller re-reads"
means exactly that, and no contract introduces a cache invalidation convention
this app does not have.

**Migrations** are generated, never hand written: `npm run db:generate` produces
a numbered file in `drizzle/` plus a snapshot in `drizzle/meta/`, and
`npm run db:migrate` applies it. Five migrations exist today, `0000` through
`0004`.

**Every own channel figure carries its sample size.** Not as a tooltip, as a
field on the return type. A return type that can express a mean without
expressing its n is a bug in the contract.

## What the schema already holds and nobody reads

Checked by grep over `src` for `tables.<name>`, ignoring tests and the schema
file itself. This matters because two of the contracts below need less new work
than the gap list suggests.

| Table | Written by | Read by | State |
|---|---|---|---|
| `saved_filters` | `db/bootstrap.ts`, system presets only | `queries/feed.ts` `getSavedFilters` | read path exists, no user write path |
| `channel_snapshots` | `services/sync-engine.ts`, one row per channel per run | `queries/channels.ts`, latest row only | history is being collected and thrown away |
| `video_snapshots` | `services/sync-engine.ts`, one row per post per run | nothing in production code | pure write, never read |
| `video_children` | sync engine | `queries/video.ts` | fine |
| `fleets`, `fleet_channels` | fleet actions | feed and channels queries | fine |

`channel_snapshots` is the important line. The sync engine has been writing
`capturedAt`, `followerCount` and `medianViews` per channel per run since it
landed, and `getMedianViews` reads only the newest row. Contract 4 is therefore
a query, not a schema change.

`video_snapshots` being write only is worth a decision of its own. It is a per
post per run history of view, like and comment counts. Nothing reads it, so
today it is disk cost with no product behind it. See contract 8.

---

## Contract 1: own channel insights

**Why.** Reach, saves, shares, profile visits, follows from post and watch time.
The prototype asks for these on the my-channel screen, the video detail screen
and the comparison screen. Nothing in the schema holds any of them. This is the
biggest hole in V1 and it recurs everywhere.

### The client is adapted, not written

A working own-channel Graph API client already exists at
`Kai-Official-OS/.claude/commands/ksa/serve/ig_stats.py`. It is proven against
the real account. It must be ported, not reinvented, and the port must keep the
metric strings byte for byte identical so the two clients cannot drift and
report different numbers for the same post.

What it already does, read off the file:

- Host and API version come from `ig_publish.py` (`HOST`, `API_VERSION`), so
  there is one place that knows which API version is targeted.
- `fetch_account` requests `id,username,followers_count,follows_count,media_count`
  on the `me` edge.
- `fetch_posts` requests media fields
  `id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,caption`
  then, per post, the insights metric string
  `reach,saved,shares,total_interactions,comments,likes`, plus `,views` when
  `media_product_type == "REELS"`.
- `fetch_comments` walks media then comments with
  `id,text,username,timestamp` and classifies each one.
- `_get` redacts the token from any HTTP error body before returning it, and
  returns `{"_error": ...}` rather than raising.
- A per post insights failure attaches `_error` to that post only and the rest
  of the run continues.

What it does not do, and this is the part the brief asks for: **profile visits,
follows from post and watch time are not requested by that client.** They are
not in the code, so they cannot be copied out of it, and the exact Graph API
metric names for them at the API version in use are unverified. The contract
below carries nullable columns for them and the rule is: no tile ships for a
metric until one real API call has returned it. A zero is a measurement and must
never stand in for a metric that was never asked for.

### The interface this app needs

New module `src/server/graph/client.ts`. It is a port of the three fetch
functions plus one addition this app needs and the Python does not.

```ts
export interface GraphAccount {
  id: string;
  username: string;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export interface GraphPostInsights {
  reach: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  comments: number | null;
  likes: number | null;
  views: number | null;
  /** Requested only when the metric name has been verified against a live call. */
  profileVisits: number | null;
  followsFromPost: number | null;
  watchTimeSec: number | null;
  /** Non-null when this one post's insights call failed while others succeeded. */
  error: string | null;
}

export interface GraphPost {
  externalId: string;
  permalink: string;
  mediaType: string;
  productType: string | null;
  format: "Reel" | "Carousel" | string;
  caption: string | null;
  postedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  insights: GraphPostInsights;
}

export interface GraphComment {
  externalId: string;
  permalink: string;
  author: string | null;
  text: string;
  postedAt: string | null;
  kind: "organic" | "self-test" | "bot-reply" | "bot-or-self-reply" | "own-comment";
}

export interface GraphTokenStatus {
  configured: boolean;
  /** Resolved by calling the account fields edge, so the screen names the real
   *  account rather than trusting a label. Null when the call failed. */
  username: string | null;
  state: "ok" | "not_configured" | "auth_failed" | "rate_limited" | "network" | "unknown";
  message: string | null;
  checkedAt: string;
}

export interface GraphClient {
  fetchAccount(): Promise<GraphAccount>;
  fetchPosts(limit?: number): Promise<GraphPost[]>;
  fetchComments(accountUsername: string): Promise<GraphComment[]>;
  /** Cheapest authenticated call. Used by the settings token strip and by
   *  "Test token". Never throws. */
  checkToken(): Promise<GraphTokenStatus>;
}
```

Three rules the port must keep.

1. The token never leaves the module in any error, string, log line or thrown
   value. `_get` already does this by string replace and the port does the same.
2. A per post insights failure is a field on that post, not an exception. The
   aggregate must be able to say "6 of 8 posts measured" so a low sum caused by
   a failed pull cannot be read as a low sum caused by low reach.
3. This client never touches the instagrapi sidecar credentials, and the sidecar
   never touches this token. Separate transports, separate tables, separate code
   paths.

### Env plumbing

`.env.example` has no Graph API variable at all today. Three are needed:

```
IG_GRAPH_TOKEN=
IG_GRAPH_USER_ID=
IG_GRAPH_API_VERSION=v21.0
```

**These must be optional in `src/server/config.ts`.** That file throws at module
load on a missing required variable and the process refuses to start. Making the
Graph token required would stop every existing machine from booting, including
Kai's, over a feature that is allowed to be unconfigured. The schema entry is
`z.string().optional()` and the "not configured" state is a first class UI state,
exactly as the API keys section already does it.

The token is a copy. It lives in Crowsnest's `.env.local` and goes stale
independently of the copy in Kai-Official-OS. Refreshing one does not refresh
the other, and the settings copy has to say so.

### The not connected surface, stated per query

Ruled by the scope owner and part of the contract, not an afterthought: a
machine with no Graph token must still boot, and every own channel surface must
degrade to a designed state rather than throwing. Three token states matter and
they are not interchangeable, because the user's next step differs in each.

- **Absent.** No `IG_GRAPH_TOKEN`. Nothing has ever been measured. The fix is to
  paste a token and restart.
- **Refused.** A token exists and the API rejected it, expired or revoked. There
  may be stored measurements from when it worked. The fix is to refresh the
  token.
- **Throttled or unreachable.** A token exists and probably works. Stored
  measurements are current as of their date. The fix is to wait, or to fix the
  network.

The rule that follows from those three: **an absent token yields no numbers, a
refused or throttled token yields the last stored numbers with their date.**
Stored data does not become false because the next pull failed. It becomes old,
and old with a date on it is useful. Old without a date on it is a lie, so no
query below returns a stored figure without the `capturedAt` that produced it.

None of these queries throw, and none of them return zero. Exact returns:

| Query | Token absent | Token refused | Throttled or unreachable |
|---|---|---|---|
| `getOwnChannelOverview` | `account: null`, `postsInWindow: 0`, `postsMeasured: 0`, every metric `{ value: null, sampleSize: 0, failedSampleSize: 0, wired }`, `medianReach: null`, `medianSampleSize: 0` | The newest stored snapshot in full, with `account.measuredAt` set to when it was taken. Metrics carry their real sample sizes. | Identical to refused. The two differ only in the banner the action's error code drives. |
| `getOwnPosts` | `{ items: [], total: 0 }` | Stored posts with their newest stored insights, `measuredAt` per row | Same as refused |
| `getOwnPostInsightHistory` | `[]` | The stored history, unchanged. History is immutable and a failed pull does not touch it. | Same as refused |
| `getOwnComments` | `{ counts: {}, organic: [], classifierVersion, fetchError: null }` | Stored comments. `fetchError` describes the last failed pull, not the stored rows. | Same as refused |
| `checkGraphTokenAction` | `ok: true` with `status.state: "not_configured"`, `username: null` | `ok: true` with `status.state: "auth_failed"` and the API's own message, token redacted | `ok: true` with `state: "rate_limited"` or `"network"` |

`checkGraphTokenAction` returning `ok: true` for an unconfigured token is
deliberate and worth reading twice. "I successfully determined that no token is
set" is a successful check. Returning `ok: false` there would make a normal,
expected, correctly handled configuration state indistinguishable from the
action itself breaking, and the settings strip would have no way to tell them
apart. `ok: false` on this action means the check could not be performed at all.

The screens that read these:

- **Token absent.** No tiles, no post table, no zeros anywhere. One panel naming
  `IG_GRAPH_TOKEN`, saying it goes in `.env.local`, and saying the dev server has
  to restart afterwards, because `config.ts` reads env once at module load. Same
  discipline `api-key-status-card.tsx` already follows.
- **Token refused.** Everything stored renders, with a banner saying the live
  pull failed and naming the date of what is on screen. The Measure now button
  stays enabled, because retrying is the user's next move.
- **Throttled.** Everything stored renders, Measure now disables for a cooldown,
  and the copy says to try later. Distinguishable from refused in wording,
  because one is fixed by waiting and the other is not.

The my-channel route itself renders in all three states. It is never hidden and
never redirects. A hidden screen is a feature the user never learns exists, and
the whole point of the token strip is that it is always visible, including when
everything is healthy.

### Tables

Four new tables, deliberately separate from `channels` and `videos`. A flag on
`channels` would put own posts inside `getOutlierFeed`, `getDashboardStats` and
`scoreVideos` by default, and every one of those would then need an exclusion
clause that somebody will forget. Separation makes the identity rule structural.

```ts
export const ownAccountSnapshots = sqliteTable("own_account_snapshots", {
  id: text("id").primaryKey(),
  capturedAt: text("captured_at").notNull(),
  externalId: text("external_id").notNull(),
  username: text("username").notNull(),
  followerCount: integer("follower_count"),
  followsCount: integer("follows_count"),
  mediaCount: integer("media_count"),
}, (t) => [index("own_account_snapshots_captured").on(t.capturedAt)]);

export const ownPosts = sqliteTable("own_posts", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  permalink: text("permalink").notNull(),
  mediaType: text("media_type").notNull(),          // raw IG value
  productType: text("product_type"),                // "REELS" | "FEED" | ...
  format: text("format").notNull(),                 // "Reel" | "Carousel" | raw media type
  caption: text("caption"),
  postedAt: text("posted_at").notNull(),
  durationSec: real("duration_sec"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastMeasuredAt: text("last_measured_at"),
  rawPayload: text("raw_payload", { mode: "json" }).$type<Record<string, unknown>>(),
}, (t) => [
  uniqueIndex("own_posts_external").on(t.externalId),
  index("own_posts_posted").on(t.postedAt),
]);

export const ownPostInsights = sqliteTable("own_post_insights", {
  id: text("id").primaryKey(),
  ownPostId: text("own_post_id").notNull().references(() => ownPosts.id, { onDelete: "cascade" }),
  capturedAt: text("captured_at").notNull(),
  reach: integer("reach"),
  saved: integer("saved"),
  shares: integer("shares"),
  totalInteractions: integer("total_interactions"),
  comments: integer("comments"),
  likes: integer("likes"),
  views: integer("views"),
  /** Unverified metrics. Nullable and never defaulted to 0: a zero is a
   *  measurement, and these have never been measured. */
  profileVisits: integer("profile_visits"),
  followsFromPost: integer("follows_from_post"),
  watchTimeSec: real("watch_time_sec"),
  /** Set when this post's insights call failed while the run as a whole succeeded. */
  fetchError: text("fetch_error"),
}, (t) => [index("own_post_insights_post_captured").on(t.ownPostId, t.capturedAt)]);

export const ownComments = sqliteTable("own_comments", {
  id: text("id").primaryKey(),
  ownPostId: text("own_post_id").notNull().references(() => ownPosts.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  author: text("author"),
  text: text("text").notNull(),
  postedAt: text("posted_at"),
  kind: text("kind").notNull(),   // classifier output
  classifierVersion: text("classifier_version").notNull(),
  capturedAt: text("captured_at").notNull(),
}, (t) => [uniqueIndex("own_comments_external").on(t.externalId)]);
```

One row per measurement in `own_post_insights`, not one row per post. That is
what preserves the history of a post's reach and gives a later diff something to
diff. It is also what makes contract 4's own-channel equivalent possible.

`classifierVersion` exists because `classify_comment` in `ig_stats.py` matches
against two hardcoded string sets and its own report says plainly it will
silently miscount if the auto reply copy changes. Storing the version means a
row classified under an old set is identifiable rather than silently wrong. Any
screen showing an organic comment count inherits that caveat and must print it.

### Queries

New module `src/server/queries/own-channel.ts`.

```ts
export interface OwnMetric {
  /** Null means not measured. It never means zero. */
  value: number | null;
  /** How many posts in the window contributed a non-null value for this metric. */
  sampleSize: number;
  /** Posts in the window whose insights call failed. */
  failedSampleSize: number;
  /** False for a metric the client does not request yet. Renders as "not wired". */
  wired: boolean;
}

export interface OwnChannelOverview {
  account: {
    username: string;
    followerCount: number | null;
    followsCount: number | null;
    mediaCount: number | null;
    /** Null when no measurement has ever been taken. */
    measuredAt: string | null;
  } | null;
  windowDays: number;
  postsInWindow: number;
  postsMeasured: number;
  metrics: {
    reach: OwnMetric;
    saved: OwnMetric;
    shares: OwnMetric;
    profileVisits: OwnMetric;
    followsFromPost: OwnMetric;
    watchTimeSec: OwnMetric;
  };
  /** Null below 5 usable posts or when the median is zero, mirroring
   *  computeChannelMedian's MIN_USABLE rule. */
  medianReach: number | null;
  medianSampleSize: number;
}

export async function getOwnChannelOverview(windowDays?: number): Promise<OwnChannelOverview>;

export interface OwnPostRow {
  ownPostId: string;
  externalId: string;
  permalink: string;
  format: string;
  caption: string | null;
  postedAt: string;
  durationSec: number | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  saved: number | null;
  shares: number | null;
  /** reach divided by median reach, one decimal. Null when either side is null. */
  reachIndex: number | null;
  measuredAt: string | null;
  insightsError: string | null;
}

export async function getOwnPosts(opts?: { limit?: number; offset?: number }): Promise<{ items: OwnPostRow[]; total: number }>;

/** History of one post's measurements, newest first. Feeds a per post trend and
 *  is the reason insights are stored per measurement. */
export async function getOwnPostInsightHistory(ownPostId: string): Promise<{
  capturedAt: string;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  views: number | null;
}[]>;

export interface OwnCommentSummary {
  counts: Record<string, number>;
  organic: { author: string | null; text: string; postedAt: string | null; permalink: string }[];
  classifierVersion: string;
  /** Null when the comment pull failed while the post pull succeeded. */
  fetchError: string | null;
}

export async function getOwnComments(): Promise<OwnCommentSummary>;
```

`OwnMetric` is the shape that makes the sample size rule structural. There is no
way to render a number from this type without having its n in hand.

### Actions

New module `src/server/actions/graph-actions.ts`, following `ig-actions.ts` and
`sync-actions.ts`: never throws, always returns a discriminated result with a
code, and the UI renders every code as its own state.

```ts
export async function measureOwnChannelAction(): Promise<ActionResult<{
  measuredAt: string;
  postsSeen: number;
  postsMeasured: number;
  postsFailed: number;
  commentsSeen: number;
  /** Set when posts succeeded but comments failed, or vice versa. */
  partial: boolean;
}>>;

export async function checkGraphTokenAction(): Promise<ActionResult<{ status: GraphTokenStatus }>>;
```

Error codes, matching the granularity `ig-actions.ts` already establishes:

`GRAPH_NOT_CONFIGURED`, `GRAPH_AUTH_FAILED`, `GRAPH_RATE_LIMITED`,
`GRAPH_NETWORK`, `GRAPH_PARTIAL`, `GRAPH_UNKNOWN`.

`measureOwnChannelAction` writes a new `own_account_snapshots` row, upserts
`own_posts` on `externalId`, inserts one `own_post_insights` row per post
measured, and upserts `own_comments` on `externalId`. It never deletes. A post
that disappears from the account stays in `own_posts` with its history intact,
because the history is the point.

### Failure

| Case | What the query returns | What the screen shows |
|---|---|---|
| No token configured | `account: null`, every metric `value: null, sampleSize: 0` | The not configured panel with the exact variable name and the next step. No tiles, no zeros. |
| Token expired or revoked | The last stored snapshot, unchanged | Last snapshot with its date, plus a banner saying the live pull failed. Stale data with a date beats a blank page, but it must be labelled. |
| Rate limited | The last stored snapshot | Same, with the rate limit message. Measure now disables for a cooldown. |
| Network unreachable | The last stored snapshot | Same, with the network message. Different copy from rate limited, because the fixes differ. |
| One post's insights failed | That post's `insightsError` set, its metric cells null, `failedSampleSize` incremented | The post's cells read "failed", never zero. Aggregates print "n of 8 posts measured". |
| Insights unavailable for an old post | Same as above, with the API's own reason | "No insights available", not zero. |
| Comments failed, posts succeeded | `OwnCommentSummary.fetchError` set | The comments block shows its own error. The rest of the page renders. |
| Metric never requested by the client | `wired: false`, `value: null` | The tile renders with a dash and the text that it is not wired yet. Visible, so the gap is visible. |
| No measurement ever taken | `account: null`, `postsInWindow: 0` | "No measurement yet" plus a primary Measure now button. No tiles. |
| Measured, account has zero posts | Real zeros on the account row, empty post list | Header renders the real zeros, because they were measured. Post, format and comment blocks say there is nothing published yet. |

### Migration

Four new tables, generated. Additive only, nothing dropped, nothing renamed. Not
destructive.

### Open, and it is the scope owner's call

Token expiry cannot be computed from the token string. Options are storing an
issue date as a second env variable and counting sixty days, calling a debug
endpoint if the host in use exposes one, or showing only "last successful call"
with no countdown. The third is honest and gives no warning. Until this is
decided, `GraphTokenStatus` carries no `expiresAt`, because inventing one would
put a fabricated date on the screen.

---

## Contract 2: per channel sync run history

**Why.** The channels screen wants a run list and a "last 8 runs" bar per
channel. The prototype's bars have three states: tall means complete, short
means partial, red means failed.

**The problem with `sync_jobs`.** It is one row per run, not per channel per
run. A library wide run inserts a single row with `channel_id` null, walks every
channel, and aggregates their counters into that one row. Reading it back, there
is no way to say what happened to one channel inside a run that touched twelve.
`getChannelSyncProgressAction` already works around this by treating any library
run as "covers this channel", which is right for a progress bar and useless for
a history. Per channel attribution cannot be recovered from the existing table.
It has to be recorded at the time.

The engine already computes exactly what is needed. `syncChannel` returns
`{ counters, stopReason }` or `{ gap, counters, stopReason }` per channel, and
those values are currently folded into the job row and lost.

### Tables

```ts
export const syncChannelRuns = sqliteTable("sync_channel_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => syncJobs.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  /** Per channel outcome, narrower than the job's status: this channel's own
   *  result inside a run that may have gone fine for every other channel. */
  status: text("status").notNull(),      // "success" | "partial" | "failed" | "cancelled"
  stopReason: text("stop_reason"),       // "lookback" | "cap" | "exhausted" | "error" | "cancelled"
  lookbackDays: integer("lookback_days"),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsCreated: integer("items_created").notNull().default(0),
  itemsUpdated: integer("items_updated").notNull().default(0),
  itemsFailed: integer("items_failed").notNull().default(0),
  itemsDeleted: integer("items_deleted").notNull().default(0),
  assetsDownloaded: integer("assets_downloaded").notNull().default(0),
  assetsFailed: integer("assets_failed").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  /** Snapshot of the channel's median at the end of this run, so a run row can be
   *  read without joining channel_snapshots. */
  medianViewsAfter: real("median_views_after"),
}, (t) => [
  index("sync_channel_runs_channel_started").on(t.channelId, t.startedAt),
  uniqueIndex("sync_channel_runs_job_channel").on(t.jobId, t.channelId),
]);
```

The unique index over `(jobId, channelId)` is the honesty guard: one run visits
one channel once, and a second insert is a bug in the engine rather than a
second bar on the chart.

**Status is derived, not free text.** `success` when `stopReason` is `lookback`
or `exhausted` and `itemsFailed` is zero. `partial` when the run stopped at the
item cap, or completed with `itemsFailed` above zero, or `assetsFailed` above
zero. `failed` when a gap was recorded. `cancelled` when the user stopped it.
This mapping belongs in one exported function so the bars and the run list
cannot disagree.

### Queries

Added to `src/server/queries/channels.ts`.

```ts
export interface ChannelRunRow {
  runId: string;
  jobId: string;
  /** "channel" when the job was scoped to this channel alone, "library" when it
   *  was a whole-library run. The user reads these differently. */
  scope: "channel" | "library";
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "partial" | "failed" | "cancelled";
  stopReason: string | null;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  itemsDeleted: number;
  assetsFailed: number;
  errorCode: string | null;
  errorMessage: string | null;
}

/** Newest first. `limit` defaults to 8, which is what the sparkline wants. */
export async function getChannelRuns(channelId: string, limit?: number): Promise<ChannelRunRow[]>;

/** One call for the whole channels list, so the page does not fire N queries.
 *  Channels with no recorded runs are present with an empty array. */
export async function getChannelRunsBulk(channelIds: string[], limit?: number): Promise<Map<string, ChannelRunRow[]>>;
```

`getChannelRunsBulk` exists because `getChannelsList` already does per channel
work in a `Promise.all` and adding an eighth query per channel to that loop is
how a list page gets slow on a real library.

### Actions

None. This is read only, and the write is the sync engine's own bookkeeping, not
a user action. The engine inserts a `sync_channel_runs` row at the start of each
channel and updates it at the channel's end, in the same place it already calls
`tracker.flush`.

### Failure

- **Channel has never been synced.** Empty array. The bar strip renders nothing
  at all, not eight grey bars. Eight placeholder bars would assert eight runs.
- **Fewer than 8 runs.** The array is short. The strip renders what it has,
  left aligned, and does not pad. Three bars means three runs.
- **A run row exists with `finishedAt` null and the job is no longer running.**
  A crashed run. Status reads `failed` with `errorCode` null. The list says the
  run did not finish rather than claiming success.
- **The query throws.** The channels page must render its channels anyway. The
  runs field is optional on the row type and the strip renders absent, which is
  the same as "no data", and the failure is logged. A channels list that goes
  blank because a sparkline query failed is a worse bug than a missing sparkline.

### Migration

One new table, additive. Not destructive.

**But the history starts empty.** Every existing channel will show no runs until
the next sync. There is no backfill, because `sync_jobs` does not contain the
per channel facts, and manufacturing them from aggregates would be fabrication.
The screen has to be honest about that on day one: no bars until a run has been
recorded under the new table.

---

## Contract 3: saved views

**Why.** The feed's saved views control. `saved_filters` already exists and is
already read, and `docs/product/observed-bugs.md` confirms the control is wired
to the real table with a real empty state. What is missing is any way for the
user to create, rename or delete one. Today the only writer is
`db/bootstrap.ts`, which installs system presets.

### Tables

`saved_filters` stays, with two additive columns.

```ts
export const savedFilters = sqliteTable("saved_filters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<SavedFilterCriteria>().notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at"),     // new, nullable: existing preset rows have none
  updatedAt: text("updated_at"),     // new, nullable
});
```

Both new columns are nullable rather than `notNull().default(...)`. A default
would stamp today's date on preset rows that were installed months ago, which is
a small fabrication and still a fabrication. Null means "not recorded", and the
UI renders a dash.

**`criteria` gets a real type.** It is `Record<string, unknown>` today, which
means a saved view can hold any shape and the feed has to guess. The contract is
that it holds exactly the filter fields the feed already understands:

```ts
export interface SavedFilterCriteria {
  fleetId?: string;
  channelId?: string;
  platform?: "instagram" | "tiktok" | "youtube_shorts";
  minScore?: number;
  minViews?: number;
  sinceDays?: number;
  followerBand?: "nano" | "micro" | "mid" | "macro";
  sort?: FeedSort;
}
```

This is `FeedFilters` from `src/server/queries/feed.ts` minus `limit` and
`offset`, which are paging state and not part of a view. Applying a saved view
must never move the user to page four.

A stored blob is not trusted on read. A row whose criteria fails validation is
returned with a `valid: false` flag rather than dropped, so a broken view can be
seen and deleted instead of vanishing.

### Queries

`src/server/queries/feed.ts`, replacing the current `getSavedFilters`.

```ts
export interface SavedFilterRow {
  id: string;
  name: string;
  isSystem: boolean;
  criteria: SavedFilterCriteria;
  /** False when the stored blob did not parse as SavedFilterCriteria. The row is
   *  still returned so the user can delete it. */
  valid: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getSavedFilters(): Promise<SavedFilterRow[]>;
```

Order is system presets first by name, then user views by name. Stable, so the
control does not reshuffle after a save.

### Actions

New module `src/server/actions/saved-filter-actions.ts`.

```ts
export async function createSavedFilterAction(input: {
  name: string;
  criteria: SavedFilterCriteria;
}): Promise<ActionResult<{ id: string }>>;

export async function renameSavedFilterAction(id: string, name: string): Promise<ActionResult<Record<string, never>>>;

export async function updateSavedFilterCriteriaAction(id: string, criteria: SavedFilterCriteria): Promise<ActionResult<Record<string, never>>>;

export async function deleteSavedFilterAction(id: string): Promise<ActionResult<Record<string, never>>>;
```

Codes: `FILTER_NAME_TAKEN`, `FILTER_IS_SYSTEM`, `FILTER_NOT_FOUND`,
`FILTER_INVALID_CRITERIA`, `FILTER_UNKNOWN`.

### Failure

- **Name collides with an existing user view.** `FILTER_NAME_TAKEN`. Not
  silently overwritten. Note the bootstrap comment already explains why name
  alone is not a key: a user view called "Balanced" must not block the preset of
  that name, which is why uniqueness is checked within `isSystem = false` only.
- **Rename or delete targets a system preset.** `FILTER_IS_SYSTEM`, refused. The
  presets are reinstalled by bootstrap anyway, so a delete would appear to work
  and then undo itself.
- **Criteria fails validation on write.** `FILTER_INVALID_CRITERIA` with the
  failing field named. Nothing is written.
- **Criteria fails validation on read.** Row returned with `valid: false`.
  The control renders it as broken with a delete affordance and does not offer
  to apply it.
- **No saved views at all.** Empty array. The existing empty state already
  handles this.

### Migration

Two nullable columns added to an existing table. Additive. Not destructive.

Typing `criteria` is a TypeScript change only, no column change, so no migration
for that half. Existing preset rows must be checked against the new type before
this ships, because a preset that fails its own validation would render as
broken on every machine.

---

## Contract 4: channel median history

**Why.** The video detail screen's median bar and the block under it, labelled
in the prototype as "what that median is made of". The bar puts this post's
score against the channel's median with the median printed. The block below is
one bar per post in the median window, current post highlighted, values above
twice the median drawn clipped with a marker, plus four lines of copy: the
scale, this post's own position, the span ("N posts sampled") and a confidence
word coloured by sample size.

**Good news: no migration.** Both halves come from tables that already hold the
data.

- The per post distribution is the channel's own `videos` rows, view count and
  posted date, which is exactly what `computeChannelMedian` already reads.
- The median over time is `channel_snapshots`, which the sync engine has been
  writing one row per channel per successful run since it landed, with
  `capturedAt`, `followerCount` and `medianViews`. `getMedianViews` in
  `queries/channels.ts` reads only the newest row and throws the rest away.

### Queries

New in `src/server/queries/channels.ts`.

```ts
export interface MedianBasis {
  channelId: string;
  handle: string;
  /** Null below 5 usable posts or when the median is zero. computeChannelMedian's
   *  own rule, not a new one. */
  median: number | null;
  /** Posts that contributed a view count to the median. Never larger than the window. */
  sampleSize: number;
  /** The trailing window in posts. 20 today, from computeChannelMedian's default. */
  window: number;
  /** Oldest and newest postedAt inside the window. Null when the window is empty. */
  spanFrom: string | null;
  spanTo: string | null;
  /** One bar each, oldest first. Exactly the posts the median was computed over. */
  bars: {
    videoId: string;
    postedAt: string;
    viewCount: number;
    /** True for the post the detail page is showing, when it is in the window. */
    isSelf: boolean;
  }[];
}

/** `selfVideoId` marks one bar. Pass nothing from the channel screen. */
export async function getChannelMedianBasis(channelId: string, selfVideoId?: string): Promise<MedianBasis | null>;

export interface MedianHistoryPoint {
  capturedAt: string;
  medianViews: number | null;
  followerCount: number | null;
}

/** From channel_snapshots, oldest first. Empty until a sync has run. */
export async function getChannelMedianHistory(channelId: string, limit?: number): Promise<MedianHistoryPoint[]>;
```

Two rules the return type enforces.

The clip threshold and the bar heights are the component's business, not the
query's. `MedianBasis` returns raw view counts and the median, and the component
decides what twice the median looks like in pixels. A query that returned
percentages would bake a chart decision into the data layer.

The confidence word is also the component's, but the number behind it is not:
`sampleSize` is returned so the copy can say "8 posts sampled" and mean it. The
prototype's thresholds are under 10, under 30, and above, which matches the note
in `prototype-gaps.md` that a median needs about ten posts before its scores
mean anything. Those thresholds live in one exported constant so the bar, the
copy and the channels screen's "thin" note cannot drift.

### Actions

None. Read only.

### Failure

- **Fewer than 5 usable posts.** `median: null`, `bars` still populated with
  what exists. The bar row is suppressed and the copy says there is no median
  yet, naming the count. The histogram still renders, because "here are the four
  posts we have" is a true and useful statement even when no median follows from
  it.
- **Median is zero.** `computeChannelMedian` already returns null for this, and
  so does the contract. A score computed against zero is a division by zero
  dressed as a number.
- **Channel does not exist.** `null`. The detail page renders the post without
  the median block rather than erroring.
- **Every post in the window has a null view count.** `sampleSize: 0`,
  `median: null`, `bars` empty. The block says the channel has posts but no view
  counts, which is a different problem from having no posts, and the user needs
  to know which.
- **`channel_snapshots` empty for this channel.** `getChannelMedianHistory`
  returns an empty array. Any median trend renders absent. It is not zero.

### Migration

None. Both queries read tables that exist and are populated.

One caveat worth stating plainly: `channel_snapshots` rows are only written at
the end of a channel's successful sync. A channel that has failed its last four
syncs has a history that stops four runs ago, and the newest point is not "now".
Every point carries its own `capturedAt` and the UI must render the date, not
imply currency.

---

## Contract 5: video layout analysis, read from frames

**Why.** The detail screen's Layout section and the "Run frame pass" action.
The prototype's four fields are on screen text, text position, cut rhythm and
framing, plus a note reading "layout fields came from a frame pass on N sampled
frames". The prototype's own copy for the unrun state is the argument for the
feature: every field dashed, because that analysis came from the transcript
alone.

**The rule that shapes this contract.** Layout is read from frames, never from
the transcript. A transcript cannot know where text sits on screen or how many
cuts there were, and an LLM asked to guess will produce four confident sentences
that are fabrications. The stored row must therefore make it impossible to
present a transcript derived guess as a frame reading, which is what the
provenance columns below are for.

### Tables

`video_analyses` gains columns. It is keyed on `videoId` as its primary key
today and stays that way.

```ts
export const videoAnalyses = sqliteTable("video_analyses", {
  videoId: text("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  hookType: text("hook_type"),
  structureSegments: text("structure_segments", { mode: "json" }).$type<{ label: string; startSec: number; endSec: number; note: string }[]>(),
  formatTags: text("format_tags", { mode: "json" }).$type<string[]>(),
  styleTags: text("style_tags", { mode: "json" }).$type<string[]>(),
  whyItWorked: text("why_it_worked"),
  model: text("model"),
  createdAt: text("created_at").notNull(),

  // --- new, all nullable: an analysis without a frame pass has none of this ---
  layout: text("layout", { mode: "json" }).$type<VideoLayout>(),
  /** How many frames the pass actually sampled. The note under the section prints
   *  this number, so it is data, not decoration. Null means no pass has run. */
  framesSampled: integer("frames_sampled"),
  /** The vision model that read the frames. Deliberately separate from `model`,
   *  which named the text model that wrote hook and structure. Two different
   *  passes, two different models, two different provenances. */
  frameModel: text("frame_model"),
  framePassAt: text("frame_pass_at"),
  /** Set when a pass was attempted and failed. Distinguishes "never run" from
   *  "run and came back empty", which need different buttons. */
  framePassError: text("frame_pass_error"),
});
```

```ts
export interface VideoLayoutField {
  /** Null means the pass ran and could not determine this field. Renders as a dash. */
  value: string | null;
  /** Frame timestamps in seconds that this reading came from. A field with no
   *  supporting frames is not a reading. */
  fromFramesSec: number[];
}

export interface VideoLayout {
  onScreenText: VideoLayoutField;
  textPosition: VideoLayoutField;
  cutRhythm: VideoLayoutField;
  framing: VideoLayoutField;
}
```

`fromFramesSec` is the anti fabrication device. A field whose supporting frame
list is empty cannot be rendered as a reading, and a model that returns a
confident string with no frames behind it fails validation rather than reaching
the screen.

`durationSec` on `videos` already exists, so cut rhythm can print an average
without a second source.

### The frame source

Frames come from the downloaded video asset, through ffmpeg, which this codebase
already detects and shells out to: `detectBinary("ffmpeg")` and `execFileP` in
`src/server/lib/exec.ts`, used today by the whisper fallback path. Frame files
are temporary and are not stored in `media_assets`. `media_assets` is content
addressed storage for things the app serves to a browser, and sampled frames are
an input to one analysis run, not a served asset. Storing them would grow the
media directory for no reader.

The video asset is often absent: `EAGER_VIDEO_DOWNLOAD` defaults to false, so
videos download on first play. A frame pass on a post whose video has never been
fetched has to download it first, and that has to be visible in the UI, because
it is the slow part.

### Actions

New export in `src/server/actions/analyze-actions.ts`.

```ts
export async function runFramePassAction(videoId: string, opts?: {
  /** Re-run over an analysis that already has layout. Defaults to false. */
  force?: boolean;
  /** Frames to sample. Defaults to a value derived from duration. */
  maxFrames?: number;
}): Promise<ActionResult<{
  layout: VideoLayout;
  framesSampled: number;
  frameModel: string;
}>>;
```

Codes: `FRAME_NO_VIDEO_ASSET`, `FRAME_DOWNLOAD_FAILED`, `FRAME_FFMPEG_MISSING`,
`FRAME_EXTRACT_FAILED`, `FRAME_NO_VISION_MODEL`, `FRAME_MODEL_FAILED`,
`FRAME_PARSE_FAILED`, `FRAME_ALREADY_RUN`, `FRAME_UNKNOWN`.

### Queries

No new module. `getVideoDetail` in `src/server/queries/video.ts` already returns
the analysis row and gains the new fields. `rowToAnalysis` in
`services/analyze.ts` is the single mapper and is the one place to change, so
the shape cannot drift between the detail page and the export path.

### Failure

- **No video asset and the download fails.** `FRAME_NO_VIDEO_ASSET` or
  `FRAME_DOWNLOAD_FAILED`. The section stays dashed and the button offers a
  retry. No fields are written.
- **ffmpeg not on PATH.** `FRAME_FFMPEG_MISSING`. The section says which binary
  is missing and points at the local binaries section in settings, the same
  treatment yt-dlp and whisper already get.
- **The model returns a field with no supporting frames.** That field is stored
  as `value: null` and the rest are kept. A partial pass is a real result.
- **The model fails schema validation.** `LlmParseError` already exists in
  `src/server/llm/client.ts` and fires after one retry. `framePassError` is
  written, `layout` stays null, and the section offers a retry. No partial
  layout is saved from a failed parse.
- **Pass already run and `force` is false.** `FRAME_ALREADY_RUN` with the stored
  result returned, matching the get-or-create shape `getOrCreateAnalysis`
  already uses.
- **Never run.** `layout` null, `framesSampled` null. Every field renders as a
  dash and the section shows the Run frame pass button. This is the prototype's
  own designed state and it is the default.

### Migration

Five nullable columns added to `video_analyses`. Additive. Not destructive.

### The risk in this contract, stated plainly

**There is no vision path in this codebase.** `src/server/llm/client.ts` has
`generateText`, `generateParsed` and `ping`, and no image input anywhere. The
configured model is a text model behind the local 9router proxy
(`CLAUDE_MODEL=nvidia/minimaxai/minimax-m2.7`, `LLM_BASE_URL=http://localhost:20128`).
The settled decision in `docs/design/ux-flows/04-ownchannel-system.md` is that
text work goes to the local proxy and vision work goes to the Claude Code path,
and the Claude Code path does not exist either.

So this contract has a dependency nothing else in V1 has: either `LlmClient`
grows an image capable method with a model that can accept images, or the frame
pass runs through a `claude` subprocess. That is a fork in the road, it is not a
data layer decision, and it needs an owner. Until it is decided, the schema
columns above are safe to add and the action cannot be implemented.

---

## Contract 6: scheduling and planned posts

**Status: in V1. Ruled in by Kai on 2026-07-31.** A manual planner. The calendar
cells render for real and a day click opens a real editor. No publishing, no
reminder daemon, no Instagram write path of any kind.

**Why it was a real question.** The my-channel calendar in the prototype has four
cell states: published with its reach printed, scheduled, slot missed, and dead
air meaning three or more elapsed days with nothing published. It also has an
agenda list and a pipeline funnel. Three of those four states describe an
intention, and `prototype-gaps.md` records the honest reason they were dropped:
nothing in the app schedules a post, so every one of those cells would have been
invented.

**What it is and is not.** Crowsnest has no publish path and no scheduler.
`SYNC_INTERVAL_MINUTES` exists in the env and nothing reads it, and the settings
page already says so out loud. The V1 planner is a local record of intent. It
never calls Instagram, never fires a notification, and never marks anything
published on its own.

**This moves a boundary, knowingly.** CONTEXT.md defines Script as "the finished
text Crowsnest hands off. The end of this tool's job. Filming and publishing
belong elsewhere." Planning now sits inside the tool and publishing stays
outside it. Kai overrode the old line with that in view. CONTEXT.md's glossary
is updated to match rather than left to contradict this document, because two
documents disagreeing about where the product ends is how the next person builds
the wrong thing.

My recommendation below argued the other way and was overruled. It stays in the
document unedited, because a recommendation quietly deleted after the decision
went against it is worth nothing the next time one is asked for. Everything from
"Tables" onward is the ruled-in contract and is what gets built.

### My opinion, on the record, overruled

Asked for directly, so it is here rather than hedged.

**A manual planner with no publish path and no reminder does not earn its screen
space as drawn, and I would build the smaller half of it instead.**

The reasoning, in order.

The calendar has four cell states and they are not equally weak. Published, with
its reach printed, comes from contract 1 and is measured fact about what
happened. Dead air, meaning three or more elapsed days with nothing out, is also
derived from measured fact and needs no new table at all: it is the absence of
published rows. Those two states are the ones that tell Kai something he does
not already know, and they cost one query over `own_posts`.

Scheduled and missed are the two that need `planned_posts`, and they are the two
that depend on a person typing their intentions into a box that will not remind
them, will not publish for them, and has no way of finding out whether the thing
went out. `publishedOwnPostId` in the table above is set by hand. That is the
tell. A row whose whole purpose is to record a future event, which nothing
watches, which nobody is pinged about, and which has to be manually reconciled
against reality afterwards, is a to-do list with worse ergonomics than the one
Kai already has open. The predictable failure is not that it gets used wrong. It
is that it gets filled in once during the week it ships, then drifts, and then
every stale row makes the calendar less trustworthy than an empty calendar
would have been. In a tool whose stated selling point is that Kai can trust the
numbers, a screen that decays into wrong is worse than a screen that is absent.

CONTEXT.md is the stronger argument and it is a definition, not a preference:
Script is "the finished text Crowsnest hands off. The end of this tool's job.
Filming and publishing belong elsewhere." A scheduler is the first half of
publishing. Ruling it in does not add a feature, it moves the boundary of what
this product is, and it does it through a calendar cell rather than through a
decision anybody wrote down. That is the part worth flagging to Kai explicitly:
the question is not whether the calendar looks better with plans in it. It is
whether Crowsnest ends at the script.

The counter argument is real and I am not dismissing it. The prototype draws the
planned cells, Kai asked for the prototype at 100 percent, and a research tool
that finds an outlier, remixes it into a script, and then has nowhere to put
that script does feel like it stops one step early. `scripts` rows already pile
up with `status` of draft or final and nothing downstream of them. That is a
genuine dead end in the product today, and the calendar is one answer to it.

But it is not the only answer, and it is the most expensive one. The cheaper
answer is a date field on the thing that already exists. A `scripts` row that
can carry an intended date needs one nullable column, no new noun, no new CRUD
surface, no new screen, and it puts the date on the artifact the user actually
made rather than on a shadow copy of it. The calendar then renders published
cells from `own_posts` and dated-script cells from `scripts`, and every cell on
it points at something real that Kai built. Nothing has to be reconciled by
hand, because a script either has a date on it or it does not.

So: if the ruling is A, build it. The contract above is complete and I have no
objection to executing it. If the ruling is open, my recommendation is neither
A nor B as written, but the third option, which is published plus dead air from
measured data, a nullable `plannedDate` on `scripts`, and no `planned_posts`
table at all. That gets most of the prototype's calendar, costs one column, and
does not move the boundary CONTEXT.md draws.

### Tables

```ts
export const plannedPosts = sqliteTable("planned_posts", {
  id: text("id").primaryKey(),
  /** "draft" = finished cut with no date. "scheduled" = dated, in the future.
   *  "missed" = dated, the date passed, nothing published. Only "draft" and
   *  "scheduled" are ever stored; "missed" is derived on read. */
  state: text("state").notNull().default("draft"),
  title: text("title").notNull(),
  note: text("note"),
  /** Null for an undated draft. Date only, no time zone games: the app runs on
   *  one Mac in one place. */
  plannedDate: text("planned_date"),
  plannedTime: text("planned_time"),   // "HH:MM", null when only a date is set
  targetLengthSec: integer("target_length_sec"),
  /** The load-bearing link. A plan that carries a script is a plan with the work
   *  already in it. See "making the link matter" below. */
  scriptId: text("script_id").references(() => scripts.id, { onDelete: "set null" }),
  /** Provenance only, so the calendar can say "straight out of remix run 04".
   *  Never the carrier of the content. */
  remixSessionId: text("remix_session_id").references(() => remixSessions.id, { onDelete: "set null" }),
  sourceVideoId: text("source_video_id").references(() => videos.id, { onDelete: "set null" }),
  /** Set by hand when the user says a plan went out. Nothing sets this
   *  automatically, because nothing publishes. */
  publishedOwnPostId: text("published_own_post_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("planned_posts_date").on(t.plannedDate)]);
```

One additive column on an existing table, so a script knows where it came from:

```ts
// scripts, new column, nullable
remixSessionId: text("remix_session_id").references(() => remixSessions.id, { onDelete: "set null" }),
```

`saveScript` in `src/server/services/remix.ts` currently writes `sourceVideoId`
and `styleVaultItemId` onto the new `scripts` row and drops the session id on
the floor, so a finished script cannot say which remix run produced it. The
planner needs that sentence and so does the vault.

`missed` is derived on read rather than stored, because a stored `missed` needs
something to run and flip it, and there is nothing running. Deriving it means it
is correct the moment the page loads and stays correct without a daemon.

### Making the link matter, and what happens when things are deleted

The instruction is that a planned post out of a remix should carry the script
with it, or the planner is a notepad and will rot. That is right, and the shape
that delivers it is already half built.

**The script is the carrier. The session is not.** `saveScript` copies the
finished text into a `scripts` row (`src/server/services/remix.ts`, the
`db.insert(tables.scripts)` call). The content is a copy, not a reference. A
`remix_sessions` row is a working session holding stage state, hook options and
variants, and it is disposable by design. So the durability rule is structural
rather than a convention somebody has to remember:

> Deleting a remix session must never cost a plan its script, because the
> script does not live in the session.

`remixSessionId` on both tables is therefore `set null` and that is safe. The
plan loses one line of provenance and keeps everything that matters. The UI
drops the "straight out of remix run 04" note and renders the rest unchanged.

**Deleting a script is the case that actually hurts, so it is refused.** A plan
whose `scriptId` went null would silently degrade from "a finished cut, dated"
to "a title on a calendar", and it would do it without telling anyone. That is
exactly the rot the instruction is guarding against. So the delete path checks
first:

- `deleteScriptAction` refuses with `SCRIPT_CARRIED_BY_PLAN` when a
  `planned_posts` row references it, naming the plans and their dates.
- The user's options are explicit: delete the plans too, or detach the script
  from them first and then delete. Detaching is a separate deliberate action.
- `detachScriptFromPlanAction` nulls `scriptId` and writes a note the calendar
  renders, so a plan that lost its script says so instead of looking like a plan
  that never had one.

The FK stays `set null` as a backstop for any path that bypasses the action, but
the action is where the honesty lives. This mirrors the refusal pattern contract
3 already uses for system presets.

**What the plan renders per link state**, so no state is undesigned:

| Link state | Calendar cell | Editor |
|---|---|---|
| `scriptId` set | Title plus a marker that a script is attached, with its length | Script text inline, read only, plus open in the vault |
| `scriptId` null, `remixSessionId` set | Title plus the remix provenance line | Link back to the remix session to finish it |
| Both null | Title and note only | Plain editor, plus an attach-a-script picker |
| `scriptId` null after a detach | Title plus the detach note and its date | Same as both null, with the note visible |

The attach picker is what stops the planner being a notepad from the other
direction: a plan typed in first can pick up a script later without being
retyped.

**One thing this planner deliberately cannot do.** It never writes to Instagram,
never schedules a job, and never marks itself published. `publishedOwnPostId` is
set by hand. There is no code path from `planned_posts` to any network call, and
that is a property worth testing rather than trusting.

### Queries and actions

```ts
export interface PlannedPostRow {
  id: string;
  /** "missed" is computed here, never read from the column. */
  state: "draft" | "scheduled" | "missed";
  title: string;
  note: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  scriptId: string | null;
  /** Denormalized so the calendar cell does not join scripts to print a marker. */
  scriptTitle: string | null;
  scriptLengthChars: number | null;
  /** Set when a script was detached, so a plan that lost one can say so. */
  scriptDetachedNote: string | null;
  remixSessionId: string | null;
  sourceVideoId: string | null;
  publishedOwnPostId: string | null;
}

/** Plans overlapping the range, plus every undated draft, which belongs to no
 *  month and has to appear in the waiting-cuts pool on every one. */
export async function getPlannedPosts(range?: { from: string; to: string }): Promise<PlannedPostRow[]>;

/** The calendar's month payload in one call: published cells from own_posts,
 *  plan cells from planned_posts, and dead air derived from the gaps between
 *  published dates. Dead air is computed, never stored. */
export interface CalendarMonth {
  month: string;                 // "YYYY-MM"
  published: { ownPostId: string; date: string; reach: number | null; title: string | null }[];
  plans: PlannedPostRow[];
  /** Runs of 3 or more elapsed days with nothing published. Future days are
   *  never dead air, because nothing was missed yet. */
  deadAir: { from: string; to: string; days: number }[];
  /** Null when contract 1 has no measurement, so the month can say "no reach
   *  measured" rather than printing zeros under every published cell. */
  measuredAt: string | null;
}

export async function getCalendarMonth(month: string): Promise<CalendarMonth>;
```

```ts
export async function createPlannedPostAction(input: {
  title: string;
  note?: string;
  plannedDate?: string;
  plannedTime?: string;
  scriptId?: string;
  remixSessionId?: string;
  sourceVideoId?: string;
}): Promise<ActionResult<{ id: string }>>;

export async function updatePlannedPostAction(id: string, patch: {
  title?: string;
  note?: string;
  targetLengthSec?: number | null;
}): Promise<ActionResult<Record<string, never>>>;

export async function schedulePlannedPostAction(id: string, plannedDate: string, plannedTime?: string): Promise<ActionResult<Record<string, never>>>;
export async function unschedulePlannedPostAction(id: string): Promise<ActionResult<Record<string, never>>>;
export async function deletePlannedPostAction(id: string): Promise<ActionResult<Record<string, never>>>;

/** Attach a finished script to a plan, or swap the one it carries. */
export async function attachScriptToPlanAction(id: string, scriptId: string): Promise<ActionResult<Record<string, never>>>;
/** Deliberate, and it writes a note the calendar renders. */
export async function detachScriptFromPlanAction(id: string, reason?: string): Promise<ActionResult<Record<string, never>>>;
/** Hand-recorded. The only way a plan is ever marked published. */
export async function markPlanPublishedAction(id: string, ownPostId: string | null): Promise<ActionResult<Record<string, never>>>;
```

Codes: `PLAN_NOT_FOUND`, `PLAN_INVALID_DATE`, `PLAN_SCRIPT_NOT_FOUND`,
`PLAN_ALREADY_PUBLISHED`, `PLAN_UNKNOWN`. And on the script side,
`SCRIPT_CARRIED_BY_PLAN` on the existing delete path.

`unschedulePlannedPostAction` nulls the date and returns the row to `draft`,
which is the prototype's own "back in the pool, undated" behaviour. Rescheduling
is `schedulePlannedPostAction` again with a new date, not a separate verb.

### Failure

- **No plans at all.** `plans` empty. The calendar renders published cells and
  dead air only, and the agenda says nothing is published, scheduled or missed
  this month, which the prototype already has copy for.
- **No own channel measurement yet.** `published` empty and `measuredAt` null.
  Plan cells still render, because a plan is local and does not need the Graph
  API. The month says reach is not measured rather than printing zeros. This is
  the case on a machine with no Graph token, and the calendar must work there.
- **A plan points at a deleted remix session.** FK is `set null`. The plan keeps
  its script and its date, and loses one provenance line. Not an error.
- **A plan whose script was deleted around the refusal.** `scriptId` null with
  `scriptDetachedNote` set. The cell says the script is gone and when, instead
  of looking like a plan that never had one.
- **Deleting a script a plan carries.** Refused with `SCRIPT_CARRIED_BY_PLAN`,
  naming the plans and their dates. Nothing is deleted.
- **A date in the past on create.** Allowed, and it reads as `missed`
  immediately. Refusing it would stop the user recording a slot they blew, which
  is exactly what the prototype's missed state exists to show.
- **Two plans on one day.** Allowed. There is no rule anywhere that says one
  post per day, and inventing one would block a real Saturday.
- **Marking a plan published against an own post that does not exist.**
  `PLAN_SCRIPT_NOT_FOUND`'s sibling case: the id is validated against
  `own_posts` and refused if absent, so the link cannot point at nothing.
  `markPlanPublishedAction(id, null)` is the legal way to say "it went out and I
  am not linking it".

### Migration

One new table, `planned_posts`. One nullable column on `scripts`,
`remix_session_id`. Both additive. Not destructive. Nothing is dropped, renamed
or retyped, and no existing query has to learn about either until it wants to.

### CONTEXT.md

The glossary gains **Planned post** and the Script entry is amended so the two
do not contradict each other. Planning is inside the tool now, publishing is
still outside it, and the new entry says plainly that a Planned post never
touches Instagram. Done as part of this contract, not left as a follow-up.

---

## Contract 7: things the reading turned up

Not asked for, found while reading, and each one is a V1 hole that will
otherwise be discovered by whoever builds the screen.

### 7a. Own median reach, and why it must not reuse the existing function

The comparison screen and the my-channel screen both need "this post against my
own median". `computeChannelMedian` in `src/server/services/outlier-calc.ts`
takes view counts. Own posts report reach, which is unique accounts, a different
quantity entirely.

New `src/server/services/own-metrics.ts`:

```ts
export interface OwnPostForCalc { ownPostId: string; reach: number | null; postedAt: string }
export function computeOwnMedianReach(posts: OwnPostForCalc[], window?: number): number | null;
export function indexAgainstOwnMedian(reach: number | null, median: number | null): number | null;
```

Same trailing window shape, same `MIN_USABLE` of 5, same null on a zero median.
It must be a separate function rather than a reuse with a swapped field name.
Sharing one function across two incompatible units is exactly how the two end up
in one column.

### 7b. Sidebar count badges

`prototype-gaps.md` records the feed and vault count badges as absent because no
prop or query supplies them. One query, one place:

```ts
// src/server/queries/dashboard.ts
export interface ShellCounts {
  /** Non-deleted videos matching the feed's default filter. */
  feed: number | null;
  /** vault_items rows. */
  vault: number | null;
  /** Channels with a sync error set. Drives the attention badge on Channels. */
  channelsNeedingAttention: number | null;
}
export async function getShellCounts(): Promise<ShellCounts>;
```

Every field nullable so a failed count renders as no badge rather than as zero.
A zero badge and a broken badge look identical and mean opposite things.

### 7c. Engagement rate on the feed card

Recorded in `prototype-gaps.md` as missing from `FeedItem` and available only in
the quick preview's on demand fetch. `videos` already holds `viewCount`,
`likeCount`, `commentCount` and `shareCount`. Adding a computed
`engagementRate: number | null` to `feedItemColumns` is a query change with no
migration, and it must be null when `viewCount` is null or zero rather than
zero, for the same reason as everywhere else.

### 7d. The "not for me" dismiss control

The prototype's feed has one and there is no server action behind it. It needs a
persisted decision, or it lies on reload. Smallest honest shape is a nullable
`dismissedAt` column on `videos` plus a filter clause in `buildWhere`, alongside
the existing unconditional `deletedAt` clause. It is a different concept from
soft delete: `deletedAt` means Instagram no longer shows it, `dismissedAt` means
the user does not want to see it. Collapsing them would make a dismissed post
look deleted. One nullable column, additive, not destructive.

### 7e. `video_snapshots` is written and never read

One row per post per sync run, holding view, like and comment counts over time,
and nothing in production code reads it. Two honest options and the scope owner
picks one. Give it a reader, which is the per post view trend the detail page
could show and does not, or stop writing it. Leaving a write only table is how a
database grows without the product growing. This is the only item in this
document where the fix might be a deletion, and a deletion here would be
destructive, so it needs an explicit decision rather than a cleanup pass.

### 7f. Multi platform: cut. Instagram only in V1

**Ruled by Kai on 2026-07-31.** No TikTok, no YT Shorts, no ingestion for
either, no per-platform baseline maths, nothing. The chips come out of the feed,
which is the bug `observed-bugs.md` and `V1-BRIEF.md` both already name as
higher priority than any missing feature.

**The `platform` column stays exactly as it is.** `channels.platform` and
`videos.platform` keep their current text type and their current documented
values `"instagram" | "tiktok" | "youtube_shorts"`. Nothing is narrowed to a
literal type, nothing is constrained by a check, nothing is dropped. Narrowing
it now would buy no correctness at runtime, since the column is text either way,
and would cost a migration to widen again later. Adding a platform after V1 is
then additive: a new ingestion path writes a new value into a column that
already accepts it.

Three consequences for the data layer, all of them subtractive:

- `FeedFilters.platform` keeps its type and its filter clause. The filter works;
  it simply has one value to offer. This is a UI change, not a query change.
- `SavedFilterCriteria` in contract 3 keeps `platform` optional with the same
  three values, so a saved view written today stays readable if a platform is
  added later.
- No contract in this document adds a second platform, and no baseline,
  median or score in this document is per platform. Medians are per channel, as
  they already are.

---

## Summary: migrations this document asks for

| Migration | Tables | Additive | Destructive |
|---|---|---|---|
| Own channel insights | `own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`, all new | yes | no |
| Per channel run history | `sync_channel_runs`, new | yes | no |
| Saved views | `saved_filters` plus `created_at`, `updated_at`, both nullable | yes | no |
| Channel median history | none | n/a | n/a |
| Frame layout analysis | `video_analyses` plus `layout`, `frames_sampled`, `frame_model`, `frame_pass_at`, `frame_pass_error`, all nullable | yes | no |
| Planned posts | `planned_posts`, new, plus `scripts.remix_session_id`, nullable | yes | no |
| Dismiss control | `videos` plus `dismissed_at`, nullable | yes | no |
| Multi platform cut | none. `platform` columns are left exactly as they are | n/a | n/a |

Nothing in this document drops a column, renames a column, or changes a type on
an existing column. Nothing needs a data backfill, and nothing can be
backfilled: per channel run history starts empty by necessity, because the facts
were never recorded.

The one destructive option anywhere here is dropping `video_snapshots` in 7e,
and it is written as a decision to be made rather than a change to be applied.

## The riskiest contract

Contract 5, the frame pass. Every other contract in this document is a table, a
query and an action against capabilities this codebase already has. Contract 5
needs a vision model, and there is no image path in `src/server/llm/client.ts`,
no vision capable model configured, and no Claude Code subprocess to hand the
work to. The schema half is safe and cheap. The action half is blocked on a
decision nobody has made, and it is the one contract where an unblocked
implementer will be tempted to fill the four layout fields from the transcript,
which is precisely the fabrication this feature exists to replace.
