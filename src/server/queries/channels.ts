import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { computeChannelBaseline } from "@/server/services/outlier-calc";
import { getScoringOptions } from "@/server/settings";
import { getOutlierFeed } from "./feed";

export interface ChannelRow {
  id: string;
  handle: string;
  displayName: string | null;
  avatarAssetId: string | null;
  platform: string;
  followerCount: number | null;
  medianViews: number | null;
  outliers30d: number;
  lastSyncedAt: string | null;
  syncError: string | null;
  fleets: { id: string; name: string }[];
  /** True for the one tracked channel marked as Kai's own (V1 data contracts: "the
   *  own-channel concept"). At most one row can ever carry this — enforced by a
   *  partial unique index on `channels.is_own`, not by application code alone. */
  isOwn: boolean;
}

export interface ChannelDetail {
  channel: ChannelRow;
  stats: { medianViews: number | null; bestScore: number | null; outliers30d: number; videoCount: number };
  series: { capturedAt: string; viewCount: number | null; outlierScore: number | null; videoId: string }[];
  videos: Awaited<ReturnType<typeof getOutlierFeed>>["items"];
}

type ChannelSelect = typeof tables.channels.$inferSelect;

const OUTLIERS_30D_MIN_SCORE = 2;
const OUTLIERS_30D_WINDOW_DAYS = 30;

/**
 * medianViews: latest channel_snapshots row when phase-2A sync has populated one,
 * falling back to computeChannelBaseline over the videos table (phase-1 final-review
 * M8) — a channel synced only once has no prior snapshot row, so the fallback is what's exercised
 * until the sync engine lands.
 *
 * The field is still named "medianViews" for every existing caller, but the number it
 * holds is whatever `app_settings.score_baseline_method` says "normal" means — median by
 * default, but mean or a trimmed mean if that setting has been changed. Renaming the
 * field to match is a UI-facing change across every screen that reads it and is out of
 * scope here; flagged for whoever next touches the channels screens.
 */
async function getMedianViews(channelId: string): Promise<number | null> {
  const [snapshot] = await db
    .select({ medianViews: tables.channelSnapshots.medianViews })
    .from(tables.channelSnapshots)
    .where(eq(tables.channelSnapshots.channelId, channelId))
    .orderBy(desc(tables.channelSnapshots.capturedAt))
    .limit(1);
  if (snapshot?.medianViews != null) return snapshot.medianViews;

  const videos = await db
    .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
    .from(tables.videos)
    .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)));
  return computeChannelBaseline(videos, await getScoringOptions());
}

async function countOutliers30d(channelId: string): Promise<number> {
  const cutoff = new Date(Date.now() - OUTLIERS_30D_WINDOW_DAYS * 86_400_000).toISOString();
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.videos)
    .where(
      and(
        eq(tables.videos.channelId, channelId),
        gte(tables.videos.outlierScore, OUTLIERS_30D_MIN_SCORE),
        gte(tables.videos.postedAt, cutoff),
        isNull(tables.videos.deletedAt)
      )
    );
  return row?.count ?? 0;
}

async function getChannelFleets(channelId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: tables.fleets.id, name: tables.fleets.name })
    .from(tables.fleetChannels)
    .innerJoin(tables.fleets, eq(tables.fleetChannels.fleetId, tables.fleets.id))
    .where(eq(tables.fleetChannels.channelId, channelId));
}

async function buildChannelRow(channel: ChannelSelect): Promise<ChannelRow> {
  const [medianViews, outliers30d, fleets] = await Promise.all([
    getMedianViews(channel.id),
    countOutliers30d(channel.id),
    getChannelFleets(channel.id),
  ]);
  return {
    id: channel.id,
    handle: channel.handle,
    displayName: channel.displayName,
    avatarAssetId: channel.avatarAssetId,
    platform: channel.platform,
    followerCount: channel.followerCount,
    medianViews,
    outliers30d,
    lastSyncedAt: channel.lastSyncedAt,
    syncError: channel.syncError,
    fleets,
    isOwn: channel.isOwn,
  };
}

export async function getChannelsList(fleetId?: string): Promise<ChannelRow[]> {
  const channelRows: ChannelSelect[] = fleetId
    ? await db
        .select({ channel: tables.channels })
        .from(tables.fleetChannels)
        .innerJoin(tables.channels, eq(tables.fleetChannels.channelId, tables.channels.id))
        .where(eq(tables.fleetChannels.fleetId, fleetId))
        .then((rows) => rows.map((r) => r.channel))
    : await db.select().from(tables.channels);

  return Promise.all(channelRows.map(buildChannelRow));
}

/** The tracked channel marked as Kai's own, if any. Null on a fresh install and on any
 *  machine where no channel has been marked yet — never a thrown error, since "nobody
 *  has set this up yet" is an ordinary, expected state here. */
export async function getOwnChannel(): Promise<ChannelRow | null> {
  const [row] = await db.select().from(tables.channels).where(eq(tables.channels.isOwn, true)).limit(1);
  return row ? buildChannelRow(row) : null;
}

export interface Fleet {
  id: string;
  name: string;
  channelCount: number;
}

export async function getFleets(): Promise<Fleet[]> {
  const fleets = await db.select().from(tables.fleets);
  return Promise.all(
    fleets.map(async (f) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tables.fleetChannels)
        .where(eq(tables.fleetChannels.fleetId, f.id));
      return { id: f.id, name: f.name, channelCount: row?.count ?? 0 };
    })
  );
}

export async function getChannelDetail(id: string): Promise<ChannelDetail | null> {
  const [channelRaw] = await db.select().from(tables.channels).where(eq(tables.channels.id, id)).limit(1);
  if (!channelRaw) return null;

  const channel = await buildChannelRow(channelRaw);
  // Reuses the feed query (not video_snapshots — M8) so "a video joined with its
  // channel" has exactly one implementation; series is derived from the same rows.
  const { items: videos } = await getOutlierFeed({ channelId: id, sort: "recent", limit: 10_000, offset: 0 });

  const bestScore = videos.reduce<number | null>(
    (max, v) => (v.outlierScore != null && (max === null || v.outlierScore > max) ? v.outlierScore : max),
    null
  );
  const series = videos.map((v) => ({
    capturedAt: v.postedAt,
    viewCount: v.viewCount,
    outlierScore: v.outlierScore,
    videoId: v.videoId,
  }));

  return {
    channel,
    stats: { medianViews: channel.medianViews, bestScore, outliers30d: channel.outliers30d, videoCount: videos.length },
    series,
    videos,
  };
}
