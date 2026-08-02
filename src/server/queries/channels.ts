import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { OUTLIERS_30D_MIN_SCORE } from "@/lib/outlier-constants";
import { db, tables } from "@/server/db";
import {
  computeChannelBaseline,
  selectBaselineWindow,
  type BaselineMethod,
  type WindowSpec,
} from "@/server/services/outlier-calc";
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
  /**
   * Which of these count a post Instagram has since removed:
   * - `videoCount` counts live posts only.
   * - `removedCount` is how many are gone, so a screen can say "8 posts, 2 removed"
   *   instead of quietly reporting 10.
   * - `medianViews`, `outliers30d`, and `bestScore` all exclude removed posts. The first
   *   two come from their own filtered queries; `bestScore` is filtered the same way here
   *   so a channel's "current best" can never quietly be a post the grid marks removed —
   *   that figure changing meaning without saying so is the exact defect `videoCount` had.
   * - `series` and `videos` DO include removed posts, each carrying `deleted: true`. Their
   *   views are real history, rows are never hard deleted, and the removed marker has to
   *   be reachable for the screen to show it — a caller that wants a live-only series can
   *   filter on that flag itself.
   */
  stats: {
    medianViews: number | null;
    bestScore: number | null;
    outliers30d: number;
    videoCount: number;
    removedCount: number;
  };
  series: { capturedAt: string; viewCount: number | null; outlierScore: number | null; videoId: string; deleted: boolean }[];
  videos: Awaited<ReturnType<typeof getOutlierFeed>>["items"];
}

type ChannelSelect = typeof tables.channels.$inferSelect;

// Moved to `@/lib/outlier-constants` (M4, branch review) so the Channels table header
// (channel-table.tsx) can import the real constant instead of re-declaring the literal:
// this file's `db` import makes it server-only, so a client component can't import from
// here directly without dragging server code into the client bundle.
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
 *
 * Exported (only) for queries/saved-posts.ts: the Vault's "vs median" column needs the
 * exact same number this file already computes for the Channels screen, read live
 * rather than duplicated — two implementations of "one channel's normal" is how they
 * drift, same reasoning own-metrics.ts already states for reach vs views.
 */
export async function getMedianViews(channelId: string): Promise<number | null> {
  // Always computed, never read back from channel_snapshots.
  //
  // This used to prefer the newest snapshot row and fall back to computing. That was
  // safe while the baseline was a fixed 20-post median, and it stopped being safe the
  // moment method and window became settings. A snapshot is whatever the sync that
  // wrote it believed at the time, and changing a scoring setting rewrites every stored
  // score without rewriting old snapshots. @kallaway showed it: the list read 198,637
  // from a stale snapshot while the score on every card was computed against 224,403.5,
  // which is the real median of the eight stored view counts.
  //
  // A displayed baseline that disagrees with the baseline the scores were divided by is
  // the worst kind of wrong number here, because both look right on their own screen.
  // Snapshots stay as history, which is what getChannelMedianHistory reads them for.
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
        .where(and(eq(tables.fleetChannels.fleetId, fleetId), isNull(tables.channels.deletedAt)))
        .then((rows) => rows.map((r) => r.channel))
    : await db.select().from(tables.channels).where(isNull(tables.channels.deletedAt));

  return Promise.all(channelRows.map(buildChannelRow));
}

export interface KanbanBoard {
  fleets: Fleet[];
  channels: ChannelRow[];
  /** channelId to its single fleet id, or null for Unassigned. */
  placement: Record<string, string | null>;
}

/**
 * The Channels Kanban board: ordered fleets, every channel as a card row, and each
 * channel's single fleet placement (null is Unassigned). Membership is single now
 * (Task 1 collapse plus moveChannelsAction), so `channel.fleets[0]` is the whole story.
 */
export async function getKanbanBoard(): Promise<KanbanBoard> {
  const [fleets, channels] = await Promise.all([getFleets(), getChannelsList()]);
  const placement: Record<string, string | null> = {};
  for (const c of channels) placement[c.id] = c.fleets[0]?.id ?? null;
  return { fleets, channels, placement };
}

/** The tracked channel marked as Kai's own, if any. Null on a fresh install and on any
 *  machine where no channel has been marked yet — never a thrown error, since "nobody
 *  has set this up yet" is an ordinary, expected state here. `removeChannelAction`
 *  already clears `isOwn` as part of removing a channel, so this `isNull(deletedAt)`
 *  is a belt-and-suspenders read guard, not the only thing standing between a removed
 *  channel and this result. */
export async function getOwnChannel(): Promise<ChannelRow | null> {
  const [row] = await db
    .select()
    .from(tables.channels)
    .where(and(eq(tables.channels.isOwn, true), isNull(tables.channels.deletedAt)))
    .limit(1);
  return row ? buildChannelRow(row) : null;
}

export interface Fleet {
  id: string;
  name: string;
  channelCount: number;
  sortOrder: number;
}

export async function getFleets(): Promise<Fleet[]> {
  const fleets = await db.select().from(tables.fleets).orderBy(tables.fleets.sortOrder, tables.fleets.createdAt);
  return Promise.all(
    fleets.map(async (f) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tables.fleetChannels)
        .where(eq(tables.fleetChannels.fleetId, f.id));
      return { id: f.id, name: f.name, channelCount: row?.count ?? 0, sortOrder: f.sortOrder };
    })
  );
}

export async function getChannelDetail(id: string): Promise<ChannelDetail | null> {
  const [channelRaw] = await db.select().from(tables.channels).where(eq(tables.channels.id, id)).limit(1);
  // A removed channel reads as not-found, same as one that never existed — it no
  // longer has a screen to render, since `getChannelsList` already dropped it from
  // the list this detail page would have been reached from.
  if (!channelRaw || channelRaw.deletedAt) return null;

  const channel = await buildChannelRow(channelRaw);
  // Reuses the feed query (not video_snapshots — M8) so "a video joined with its
  // channel" has exactly one implementation; series is derived from the same rows.
  // `videos` carries removed posts (deleted: true) so the screen can mark them — see
  // ChannelDetail's doc comment for which of the fields below include them and which don't.
  const { items: videos } = await getOutlierFeed({ channelId: id, sort: "recent", limit: 10_000, offset: 0 });

  const liveVideos = videos.filter((v) => !v.deleted);
  const removedCount = videos.length - liveVideos.length;

  // Matches outliers30d and medianViews: a removed post's score is real history, but a
  // channel's "current best" figure staying live-only, like its siblings, beats a
  // bestScore that can point at a post the grid marks removed.
  const bestScore = liveVideos.reduce<number | null>(
    (max, v) => (v.outlierScore != null && (max === null || v.outlierScore > max) ? v.outlierScore : max),
    null
  );
  const series = videos.map((v) => ({
    capturedAt: v.postedAt,
    viewCount: v.viewCount,
    outlierScore: v.outlierScore,
    videoId: v.videoId,
    deleted: v.deleted,
  }));

  return {
    channel,
    stats: {
      medianViews: channel.medianViews,
      bestScore,
      outliers30d: channel.outliers30d,
      videoCount: liveVideos.length,
      removedCount,
    },
    series,
    videos,
  };
}

/**
 * Channel median histogram (V1 data contracts §4, plan Wave 1 item 3): the video
 * detail screen's "what this median is made of" block.
 *
 * The baseline window and method are NOT hardcoded here — they come from
 * `getScoringOptions()`, the same call `getMedianViews` above and the scoring engine
 * both make. A histogram built under different settings than the score it explains
 * would misrepresent that score, so `selectBaselineWindow` and `computeChannelBaseline`
 * are handed the exact same options and therefore the exact same posts.
 */
export interface MedianBasis {
  channelId: string;
  handle: string;
  /** Null below the settings module's minUsable posts, or when the baseline statistic
   *  is exactly zero — computeChannelBaseline's own rule, evaluated under whatever
   *  settings are configured right now. */
  median: number | null;
  /** Which statistic produced `median` — app_settings.score_baseline_method. Not
   *  always "median"; the field is named for the common case. */
  method: BaselineMethod;
  /** Posts that contributed a view count to the baseline. Never larger than the
   *  window, and this is the number the confidence word and the "N posts sampled"
   *  copy are computed from. */
  sampleSize: number;
  /** Fewer usable posts than this and `median` is null — app_settings.score_min_usable_posts. */
  minUsable: number;
  /** The configured trailing window (posts / days / all) — app_settings.score_baseline_window. */
  window: WindowSpec;
  /** Oldest and newest postedAt among the sampled posts. Null when the sample is empty. */
  spanFrom: string | null;
  spanTo: string | null;
  /** One bar each, oldest first — exactly the posts the baseline was computed over. The
   *  clip threshold and bar heights are the component's business, not this query's. */
  bars: { videoId: string; postedAt: string; viewCount: number; isSelf: boolean }[];
}

/** `selfVideoId` marks one bar as the post the detail page is showing, when that post
 *  falls inside the sampled window. Pass nothing from the channels screen. */
export async function getChannelMedianBasis(channelId: string, selfVideoId?: string): Promise<MedianBasis | null> {
  const [channel] = await db.select().from(tables.channels).where(eq(tables.channels.id, channelId)).limit(1);
  if (!channel) return null;

  const videos = await db
    .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
    .from(tables.videos)
    .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)));

  const scoringOptions = await getScoringOptions();
  const usable = selectBaselineWindow(videos, scoringOptions);
  const median = computeChannelBaseline(videos, scoringOptions);

  const bars = usable
    .slice()
    .reverse() // selectBaselineWindow returns newest-first; the histogram reads oldest-first
    .map((v) => ({
      videoId: v.id,
      postedAt: v.postedAt,
      viewCount: v.viewCount as number, // selectBaselineWindow already dropped null viewCounts
      isSelf: v.id === selfVideoId,
    }));

  return {
    channelId,
    handle: channel.handle,
    median,
    method: scoringOptions.method,
    sampleSize: usable.length,
    minUsable: scoringOptions.minUsable,
    window: scoringOptions.window,
    spanFrom: bars[0]?.postedAt ?? null,
    spanTo: bars.at(-1)?.postedAt ?? null,
    bars,
  };
}

export interface MedianHistoryPoint {
  capturedAt: string;
  medianViews: number | null;
  followerCount: number | null;
}

const MEDIAN_HISTORY_DEFAULT_LIMIT = 30;

/** From `channel_snapshots`, oldest first. Empty until this channel has completed at
 *  least one sync — there is nothing to backfill this from, so an empty array is the
 *  honest answer, not an error. */
export async function getChannelMedianHistory(channelId: string, limit = MEDIAN_HISTORY_DEFAULT_LIMIT): Promise<MedianHistoryPoint[]> {
  const rows = await db
    .select({
      capturedAt: tables.channelSnapshots.capturedAt,
      medianViews: tables.channelSnapshots.medianViews,
      followerCount: tables.channelSnapshots.followerCount,
    })
    .from(tables.channelSnapshots)
    .where(eq(tables.channelSnapshots.channelId, channelId))
    .orderBy(desc(tables.channelSnapshots.capturedAt))
    .limit(limit);

  return rows.reverse();
}
