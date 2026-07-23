import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(), // "instagram" | "tiktok" | "youtube_shorts"
  handle: text("handle").notNull(),
  externalId: text("external_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  followingCount: integer("following_count"),
  mediaCount: integer("media_count"),
  bio: text("bio"),
  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  syncError: text("sync_error"),
  trackedSince: text("tracked_since").notNull(),
  lastSyncedAt: text("last_synced_at"),
}, (t) => [uniqueIndex("channels_platform_handle").on(t.platform, t.handle)]);

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

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  caption: text("caption"),
  postedAt: text("posted_at").notNull(),
  durationSec: integer("duration_sec"),
  thumbnailUrl: text("thumbnail_url"),
  videoUrl: text("video_url"),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  outlierScore: real("outlier_score"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastRefreshedAt: text("last_refreshed_at"),
}, (t) => [uniqueIndex("videos_platform_external").on(t.platform, t.externalId)]);

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

export const syncJobs = sqliteTable("sync_jobs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(), // "running" | "success" | "partial" | "failed"
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>(),
  gaps: text("gaps", { mode: "json" }).$type<{ channelId: string; provider: string; error: string }[]>(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
