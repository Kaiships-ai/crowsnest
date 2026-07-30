import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { SyncGap } from "../services/sync-types";

/**
 * Every binary we serve ourselves. Instagram CDN URLs are signed and expire within
 * hours, so a stored URL is worthless by the time anyone looks at it — assets are
 * downloaded during sync and served from `/api/media/[assetId]` instead.
 *
 * Content-addressed: `sha256` is unique, so the same bytes fetched twice (a reused
 * thumbnail, a re-synced reel) collapse to one row and one file on disk. That makes
 * `storagePath` derivable (`<sha256[0:2]>/<sha256>.<ext>`) and makes cache headers
 * safely immutable.
 *
 * `sourceUrlHash` is a sha1 of the expiring CDN URL, kept only to correlate a row with
 * the request that produced it when debugging. The URL itself is deliberately NOT
 * stored — nothing should ever be able to hand one to a browser.
 */
export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  sha256: text("sha256").notNull(),
  kind: text("kind").notNull(), // "thumbnail" | "video" | "avatar"
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSec: real("duration_sec"),
  storagePath: text("storage_path").notNull(), // relative to MEDIA_ROOT, never absolute
  sourceUrlHash: text("source_url_hash"),
  downloadedAt: text("downloaded_at").notNull(),
  lastVerifiedAt: text("last_verified_at"),
}, (t) => [uniqueIndex("media_assets_sha256").on(t.sha256)]);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(), // "instagram" | "tiktok" | "youtube_shorts"
  handle: text("handle").notNull(),
  externalId: text("external_id"),
  displayName: text("display_name"),
  avatarAssetId: text("avatar_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  mediaCount: integer("media_count"),
  bio: text("bio"),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  syncError: text("sync_error"),
  syncErrorCode: text("sync_error_code"),
  trackedSince: text("tracked_since").notNull(),
  lastSyncedAt: text("last_synced_at"),
  /**
   * Marks the one tracked channel that is Kai's own account, so the app has a single
   * place to answer "which channel is mine" instead of nothing at all. This channel row
   * is still populated by the instagrapi sidecar sync same as any other; the Graph API
   * insights in `own_post_insights` etc. are a completely separate table set keyed on
   * the Graph account, not on this row's id, so a wrong or absent flag here never leaks
   * into an insights number. The partial unique index below is the structural guarantee
   * that "my own channel" cannot mean two different rows at once.
   */
  isOwn: integer("is_own", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  uniqueIndex("channels_platform_handle").on(t.platform, t.handle),
  uniqueIndex("channels_single_own").on(t.isOwn).where(sql`${t.isOwn} = 1`),
]);

export const fleets = sqliteTable("fleets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nicheLabel: text("niche_label"),
  createdAt: text("created_at").notNull(),
});

export const fleetChannels = sqliteTable("fleet_channels", {
  fleetId: text("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.fleetId, t.channelId] })]);

/**
 * One row per top-level post. Table keeps the name `videos` (the product is built around
 * short-form video) but `mediaType` now distinguishes photo / video / carousel, because
 * a 30-day sync of a real creator returns all three.
 *
 * `externalId` holds Instagram's media `pk` — the goal's "idempotent upsert keyed on
 * media pk" rides on the existing unique index over (platform, externalId).
 *
 * There is deliberately no `thumbnailUrl` / `videoUrl` column any more. Those held
 * expiring CDN URLs that were rendered straight into <img>; they are replaced by
 * foreign keys into media_assets. Leaving them nullable-but-unused would invite the
 * exact regression this work exists to remove.
 */
export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  shortcode: text("shortcode"),
  mediaType: text("media_type").notNull().default("video"), // "photo" | "video" | "carousel"
  productType: text("product_type"), // raw IG value: "clips" | "feed" | "igtv" | ...
  url: text("url").notNull(),
  caption: text("caption"),
  postedAt: text("posted_at").notNull(),
  durationSec: integer("duration_sec"),
  thumbnailAssetId: text("thumbnail_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  videoAssetId: text("video_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  outlierScore: real("outlier_score"),
  /** Set when a post we previously saw is gone from the creator's timeline. Rows are
   *  never hard-deleted — transcripts, analyses and remix sessions hang off them. */
  deletedAt: text("deleted_at"),
  /** Untouched provider payload, for diagnosing private-API drift after the fact. */
  rawPayload: text("raw_payload", { mode: "json" }).$type<Record<string, unknown>>(),
  rawFetchedAt: text("raw_fetched_at"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastRefreshedAt: text("last_refreshed_at"),
}, (t) => [
  uniqueIndex("videos_platform_external").on(t.platform, t.externalId),
  index("videos_channel_posted").on(t.channelId, t.postedAt),
]);

/**
 * Carousel children. A carousel is ONE `videos` row plus N of these — never N top-level
 * rows, and never collapsed to its first image.
 *
 * Instagram's child objects (instagrapi `Resource`) carry only pk / media_type /
 * thumbnail_url / video_url, so caption and taken_at are inherited from the parent and
 * are not duplicated here.
 */
export const videoChildren = sqliteTable("video_children", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  externalId: text("external_id").notNull(),
  mediaType: text("media_type").notNull(), // "photo" | "video"
  thumbnailAssetId: text("thumbnail_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  videoAssetId: text("video_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
  rawPayload: text("raw_payload", { mode: "json" }).$type<Record<string, unknown>>(),
}, (t) => [
  uniqueIndex("video_children_video_position").on(t.videoId, t.position),
  uniqueIndex("video_children_video_external").on(t.videoId, t.externalId),
]);

export const channelSnapshots = sqliteTable("channel_snapshots", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  capturedAt: text("captured_at").notNull(),
  followerCount: integer("follower_count"),
  medianViews: real("median_views"),
});

export const videoSnapshots = sqliteTable("video_snapshots", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  capturedAt: text("captured_at").notNull(),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
});

export const transcripts = sqliteTable("transcripts", {
  videoId: text("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  language: text("language"),
  durationSec: real("duration_sec"),
  source: text("source").notNull(), // "whisper-local" | "groq" | "caption"
  createdAt: text("created_at").notNull(),
});

export const videoAnalyses = sqliteTable("video_analyses", {
  videoId: text("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  hookType: text("hook_type"),
  structureSegments: text("structure_segments", { mode: "json" }).$type<{ label: string; startSec: number; endSec: number; note: string }[]>(),
  formatTags: text("format_tags", { mode: "json" }).$type<string[]>(),
  styleTags: text("style_tags", { mode: "json" }).$type<string[]>(),
  whyItWorked: text("why_it_worked"),
  model: text("model"),
  createdAt: text("created_at").notNull(),
});

export const vaultItems = sqliteTable("vault_items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "hook" | "style"
  sourceVideoId: text("source_video_id").references(() => videos.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  templateText: text("template_text").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
});

export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceVideoId: text("source_video_id").references(() => videos.id, { onDelete: "set null" }),
  hookVaultItemId: text("hook_vault_item_id").references(() => vaultItems.id, { onDelete: "set null" }),
  styleVaultItemId: text("style_vault_item_id").references(() => vaultItems.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // "draft" | "final"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const savedFilters = sqliteTable("saved_filters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
});

export const remixSessions = sqliteTable("remix_sessions", {
  id: text("id").primaryKey(),
  sourceVideoId: text("source_video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  stage: text("stage").notNull().default("prompt"), // "prompt"|"research"|"hook"|"style"|"script"
  topic: text("topic"),
  niche: text("niche"),
  targetLengthSec: integer("target_length_sec"),
  researchNotes: text("research_notes", { mode: "json" }).$type<Record<string, unknown>>(),
  hookOptions: text("hook_options", { mode: "json" }).$type<string[]>(),
  chosenHook: text("chosen_hook"),
  styleVaultItemId: text("style_vault_item_id"),
  outline: text("outline"),
  variants: text("variants", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One row per sync run per channel (`channelId` null = a whole-library run).
 *
 * The counters are not decoration: `itemsSeen` / `itemsCreated` are what prove a sync
 * actually happened and that a second consecutive run is genuinely idempotent.
 *
 * Concurrency: `sync_jobs_channel_running` is a PARTIAL unique index over channelId
 * WHERE status = 'running'. A second concurrent sync of the same channel fails its
 * INSERT at the database, not at an in-process mutex that a second Node worker or a
 * `tsx` script would never see. `heartbeatAt` lets a crashed run's stale lock be reaped.
 */
export const syncJobs = sqliteTable("sync_jobs", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  /**
   * What the single-flight lock is actually keyed on: the channel id for a per-channel
   * run, or the literal "__library__" for a whole-library run.
   *
   * This exists because SQLite treats NULLs as DISTINCT in a unique index, so a partial
   * unique index over `channel_id` did NOT lock library-wide runs against each other —
   * two of them inserted happily side by side (verified). A NOT NULL key closes that.
   */
  lockKey: text("lock_key").notNull().default("__library__"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  heartbeatAt: text("heartbeat_at"),
  status: text("status").notNull(), // "running" | "success" | "partial" | "failed"
  lookbackDays: integer("lookback_days"),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsCreated: integer("items_created").notNull().default(0),
  itemsUpdated: integer("items_updated").notNull().default(0),
  itemsFailed: integer("items_failed").notNull().default(0),
  itemsDeleted: integer("items_deleted").notNull().default(0),
  assetsDownloaded: integer("assets_downloaded").notNull().default(0),
  assetsFailed: integer("assets_failed").notNull().default(0),
  stopReason: text("stop_reason"), // "lookback" | "cap" | "exhausted" | "error" | "cancelled"
  errorCode: text("error_code"),
  errorMessage: text("error_message"),

  /**
   * Live progress. These exist because the counters above were only ever written once,
   * when the run ENDED — so a UI polling this row mid-sync read zeros and had nothing
   * truthful to render. The sync engine now flushes the block below (plus the counters)
   * at every page and channel boundary, which is what makes a real progress bar possible
   * instead of an indeterminate spinner that means "something, maybe".
   */
  phase: text("phase"), // see SyncPhase in services/sync-types.ts
  /** Denormalized on purpose: the poll path renders the current channel every second and
   *  should not join `channels` to print a name. */
  currentChannelHandle: text("current_channel_handle"),
  /** Both null until the run has enumerated its channel list. `channelsDone/Total` is the
   *  only honestly determinate fraction a sync has — item counts have no known
   *  denominator until Instagram stops paginating. */
  channelsTotal: integer("channels_total"),
  channelsDone: integer("channels_done").notNull().default(0),
  /** Count of retried upstream calls. Surfaced so a slow-but-recovering sync reads as
   *  "retrying, 3 so far" rather than as a hang. */
  retries: integer("retries").notNull().default(0),
  /** Co-operative cancel. The UI sets it; the engine checks it at each page/channel
   *  boundary and stops cleanly with stopReason 'cancelled'. Not a kill — an in-flight
   *  HTTP call is allowed to finish so partial work is still committed. */
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>(),
  /**
   * Points at the ONE definition of the shape (`sync-types.ts`) rather than restating it.
   * The inline copy had gone stale — it was missing `handle` and `code`, and only
   * survived because writes of a full `SyncGap` are not object literals, so no
   * excess-property check fires, and the one reader goes through raw `sql``` and skips
   * the mapper. Two accidents holding up a lie; a typed read would have silently dropped
   * both fields.
   */
  gaps: text("gaps", { mode: "json" }).$type<SyncGap[]>(),
}, (t) => [
  uniqueIndex("sync_jobs_lock_running")
    .on(t.lockKey)
    .where(sql`${t.status} = 'running'`),
  index("sync_jobs_started").on(t.startedAt),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Own-channel Instagram Insights (V1 data contracts, contract 1). Reach, saves, shares
 * and the rest of Kai's own performance data, pulled through the Graph API and kept
 * deliberately separate from `channels` / `videos`.
 *
 * Why separate rather than a flag: a flag on `channels` would put own posts inside
 * `getOutlierFeed`, `getDashboardStats` and `scoreVideos` by default, and every one of
 * those would then need an exclusion clause somebody will eventually forget to add.
 * Separation makes "own posts never appear in the outlier feed" a structural fact
 * instead of a convention.
 */

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
  mediaType: text("media_type").notNull(), // raw IG value
  productType: text("product_type"), // "REELS" | "FEED" | ...
  format: text("format").notNull(), // "Reel" | "Carousel" | raw media type
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
  /** Unverified metrics. Nullable and never defaulted to 0: a zero is a measurement, and
   *  these have never been measured (the ported client does not request them yet). */
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
  kind: text("kind").notNull(), // classifier output
  classifierVersion: text("classifier_version").notNull(),
  capturedAt: text("captured_at").notNull(),
}, (t) => [uniqueIndex("own_comments_external").on(t.externalId)]);
