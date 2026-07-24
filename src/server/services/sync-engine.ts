import { and, eq, inArray } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { getProviderChain } from "../providers/registry";
import { fetchReelByUrl } from "../providers/ytdlp";
import type { Platform, ProfileStats, SocialProvider, VideoStats } from "../providers/types";
import { computeChannelMedian, scoreVideos, type VideoForCalc } from "./outlier-calc";

// ---- public types (DATA.md §5 / plan §Task 6 contract) ----

export interface SyncGap {
  channelId: string;
  provider: string;
  error: string;
}

export interface SyncResult {
  jobId: string;
  channelsSynced: number;
  videosUpserted: number;
  gaps: SyncGap[];
}

export interface RunSyncOpts {
  channelIds?: string[];
  providers?: SocialProvider[];
  /** Test seam — overrides the 300-800ms per-request jitter sleep. */
  sleep?: (ms: number) => Promise<void>;
}

type ChannelRow = typeof tables.channels.$inferSelect;

const POOL_SIZE = 3;
const RECENT_VIDEOS_LIMIT = 30;
const RETRY_BACKOFF_MS = 2000;
const SCORE_WINDOW = 20;

function jitterMs(): number {
  return 300 + Math.random() * 500;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function toCalc(row: { id: string; viewCount: number | null; postedAt: string }): VideoForCalc {
  return { id: row.id, viewCount: row.viewCount, postedAt: row.postedAt };
}

/** Retryable iff the error looks like a 429 or 5xx — same-provider retry once, 2s backoff. */
function isRetryable(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status === 429 || status >= 500;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(msg) || /\b5\d{2}\b/.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await sleep(RETRY_BACKOFF_MS);
    return fn(); // one retry only; a second failure propagates to the caller
  }
}

/** Simple worker-pool: up to POOL_SIZE items processed concurrently off a shared queue. */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workerCount = Math.min(POOL_SIZE, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/** Inserts or updates a video keyed by (platform, externalId); returns the row id + the
 *  fields snapshots need, so callers don't have to re-query right after writing. */
async function upsertVideo(
  channelId: string,
  v: VideoStats
): Promise<{ id: string; viewCount: number | null; likeCount: number | null; commentCount: number | null }> {
  const existing = await db
    .select({ id: tables.videos.id })
    .from(tables.videos)
    .where(and(eq(tables.videos.platform, v.platform), eq(tables.videos.externalId, v.id)))
    .limit(1);

  const likeCount = v.likeCount ?? null;
  const commentCount = v.commentCount ?? null;

  if (existing[0]) {
    const id = existing[0].id;
    await db
      .update(tables.videos)
      .set({
        caption: v.caption,
        postedAt: v.postedAt,
        durationSec: v.durationSec,
        thumbnailUrl: v.thumbnailUrl,
        videoUrl: v.videoUrl,
        viewCount: v.viewCount,
        likeCount,
        commentCount,
        shareCount: v.shareCount ?? null,
        lastRefreshedAt: nowIso(),
      })
      .where(eq(tables.videos.id, id));
    return { id, viewCount: v.viewCount, likeCount, commentCount };
  }

  const id = newId();
  const now = nowIso();
  await db.insert(tables.videos).values({
    id,
    channelId,
    platform: v.platform,
    externalId: v.id,
    url: v.url,
    caption: v.caption,
    postedAt: v.postedAt,
    durationSec: v.durationSec,
    thumbnailUrl: v.thumbnailUrl,
    videoUrl: v.videoUrl,
    viewCount: v.viewCount,
    likeCount,
    commentCount,
    shareCount: v.shareCount ?? null,
    firstSeenAt: now,
    lastRefreshedAt: now,
  });
  return { id, viewCount: v.viewCount, likeCount, commentCount };
}

/** Recomputes outlierScore for a channel's full video set and writes it back; returns the
 *  channel's current median (for the channel_snapshots row). */
async function recomputeChannelScores(channelId: string): Promise<number | null> {
  const rows = await db
    .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
    .from(tables.videos)
    .where(eq(tables.videos.channelId, channelId));
  const calc = rows.map(toCalc);
  const scores = scoreVideos(calc, SCORE_WINDOW);
  for (const row of rows) {
    await db.update(tables.videos).set({ outlierScore: scores.get(row.id) ?? null }).where(eq(tables.videos.id, row.id));
  }
  return computeChannelMedian(calc, SCORE_WINDOW);
}

/** Syncs one channel through the provider fallback chain. Never throws — provider and
 *  DB errors alike become a gap so one broken channel can't abort the whole run. */
async function syncOneChannel(
  channel: ChannelRow,
  providers: SocialProvider[],
  sleep: (ms: number) => Promise<void>
): Promise<{ gap?: SyncGap; videosUpserted: number }> {
  if (providers.length === 0) {
    const error = "no provider configured";
    await db.update(tables.channels).set({ syncError: error }).where(eq(tables.channels.id, channel.id));
    return { gap: { channelId: channel.id, provider: "none", error }, videosUpserted: 0 };
  }

  let profile: ProfileStats | null = null;
  let videos: VideoStats[] | null = null;
  let lastError: { provider: string; error: string } | null = null;

  for (const provider of providers) {
    try {
      await sleep(jitterMs());
      profile = await withRetry(() => provider.getProfile(channel.handle), sleep);
      await sleep(jitterMs());
      videos = await withRetry(() => provider.getRecentVideos(channel.handle, RECENT_VIDEOS_LIMIT), sleep);
      lastError = null;
      break;
    } catch (err) {
      lastError = { provider: provider.name, error: errorMessage(err) };
      profile = null;
      videos = null;
    }
  }

  if (!profile || !videos) {
    const gap: SyncGap = {
      channelId: channel.id,
      provider: lastError?.provider ?? providers[providers.length - 1].name,
      error: lastError?.error ?? "unknown error",
    };
    await db.update(tables.channels).set({ syncError: gap.error }).where(eq(tables.channels.id, channel.id));
    return { gap, videosUpserted: 0 };
  }

  await db
    .update(tables.channels)
    .set({
      externalId: profile.externalId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      mediaCount: profile.mediaCount,
      bio: profile.bio,
      isVerified: profile.isVerified ?? false,
      syncError: null,
      lastSyncedAt: nowIso(),
    })
    .where(eq(tables.channels.id, channel.id));

  const upserted = [];
  for (const v of videos) {
    upserted.push(await upsertVideo(channel.id, v));
  }

  const medianViews = await recomputeChannelScores(channel.id);

  await db.insert(tables.channelSnapshots).values({
    id: newId(),
    channelId: channel.id,
    capturedAt: nowIso(),
    followerCount: profile.followerCount,
    medianViews,
  });

  for (const r of upserted) {
    await db.insert(tables.videoSnapshots).values({
      id: newId(),
      videoId: r.id,
      capturedAt: nowIso(),
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
    });
  }

  return { gap: undefined, videosUpserted: upserted.length };
}

/**
 * Runs a sync pass per DATA.md §5: profiles-then-videos per channel, a small concurrency
 * pool with jitter, provider fallback chain with one 429/5xx retry, upsert-by-external-id,
 * per-channel score recompute + snapshots. Never throws for per-channel provider failures
 * (recorded as gaps instead) — only throws for invalid input, before any channel or job
 * row is touched.
 */
export async function runSync(opts: RunSyncOpts = {}): Promise<SyncResult> {
  if (opts.channelIds !== undefined) {
    const invalid = opts.channelIds.length === 0 || opts.channelIds.some((id) => typeof id !== "string" || id.length === 0);
    if (invalid) throw new Error("runSync: channelIds must be a non-empty array of non-empty channel ids when provided");
  }

  const providers = opts.providers ?? getProviderChain();
  const sleep = opts.sleep ?? defaultSleep;

  const jobId = newId();
  await db.insert(tables.syncJobs).values({ id: jobId, startedAt: nowIso(), status: "running" });

  const gaps: SyncGap[] = [];
  let channelsSynced = 0;
  let videosUpserted = 0;

  try {
    const channelRows = opts.channelIds
      ? await db.select().from(tables.channels).where(inArray(tables.channels.id, opts.channelIds))
      : await db.select().from(tables.channels);

    await runPool(channelRows, async (channel) => {
      const result = await syncOneChannel(channel, providers, sleep);
      if (result.gap) {
        gaps.push(result.gap);
      } else {
        channelsSynced += 1;
        videosUpserted += result.videosUpserted;
      }
    });

    const status: "success" | "partial" = gaps.length > 0 ? "partial" : "success";
    await db
      .update(tables.syncJobs)
      .set({ finishedAt: nowIso(), status, stats: { channels: channelsSynced, videos: videosUpserted }, gaps })
      .where(eq(tables.syncJobs.id, jobId));

    return { jobId, channelsSynced, videosUpserted, gaps };
  } catch (err) {
    await db
      .update(tables.syncJobs)
      .set({
        finishedAt: nowIso(),
        status: "failed",
        stats: { channels: channelsSynced, videos: videosUpserted },
        gaps,
      })
      .where(eq(tables.syncJobs.id, jobId));
    throw err;
  }
}

/**
 * Adds a channel by handle, normalizing to the canonical @-prefixed form first. Returns
 * the existing row's id if (platform, handle) is already tracked. Otherwise tries the
 * provider chain for an immediate profile fetch (best-effort — a failure just leaves the
 * new row keyless-thin, syncError set, to be picked up by the next scheduled sync).
 */
export async function addChannel(
  input: { handle: string; platform: Platform },
  providers: SocialProvider[] = getProviderChain()
): Promise<{ channelId: string }> {
  const handle = normalizeHandle(input.handle);
  if (handle === "@") throw new Error("addChannel: handle is required");

  const existing = await db
    .select({ id: tables.channels.id })
    .from(tables.channels)
    .where(and(eq(tables.channels.platform, input.platform), eq(tables.channels.handle, handle)))
    .limit(1);
  if (existing[0]) return { channelId: existing[0].id };

  let profile: ProfileStats | null = null;
  let lastError: string | null = null;
  for (const provider of providers) {
    try {
      profile = await provider.getProfile(handle);
      break;
    } catch (err) {
      lastError = errorMessage(err);
    }
  }

  const id = newId();
  await db.insert(tables.channels).values({
    id,
    platform: input.platform,
    handle,
    externalId: profile?.externalId,
    displayName: profile?.displayName,
    avatarUrl: profile?.avatarUrl,
    followerCount: profile?.followerCount,
    followingCount: profile?.followingCount,
    mediaCount: profile?.mediaCount,
    bio: profile?.bio,
    isVerified: profile?.isVerified ?? false,
    syncError: profile ? null : (lastError ?? "no provider configured"),
    trackedSince: nowIso(),
    lastSyncedAt: profile ? nowIso() : null,
  });

  return { channelId: id };
}

/**
 * Manual single-reel import (the yt-dlp keyless escape hatch — not part of the sync
 * provider chain). Creates a minimal channel stub if the reel's owner isn't tracked yet,
 * upserts the video, and recomputes that channel's outlier scores.
 */
export async function importReelByUrl(
  url: string,
  fetchReel: (url: string) => Promise<VideoStats & { channelHandle: string }> = fetchReelByUrl
): Promise<{ videoId: string; channelId: string }> {
  const stats = await fetchReel(url);
  const handle = stats.channelHandle;

  const existingChannel = await db
    .select({ id: tables.channels.id })
    .from(tables.channels)
    .where(and(eq(tables.channels.platform, stats.platform), eq(tables.channels.handle, handle)))
    .limit(1);

  let channelId: string;
  if (existingChannel[0]) {
    channelId = existingChannel[0].id;
  } else {
    channelId = newId();
    await db.insert(tables.channels).values({
      id: channelId,
      platform: stats.platform,
      handle,
      syncError: null,
      trackedSince: nowIso(),
    });
  }

  const upserted = await upsertVideo(channelId, stats);
  await recomputeChannelScores(channelId);

  return { videoId: upserted.id, channelId };
}
