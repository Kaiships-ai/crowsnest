import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { downloadVideoAction } from "@/server/actions/media-actions";
import { getOrCreateAnalysis } from "./analyze";

/**
 * The sync's auto-analyze pass (phase-0 9router-supervisor plan, Task 2).
 *
 * `generateIdeasForNewOutliers` (below in spirit, `ideas.ts` in practice) only ever turns
 * an ALREADY-analyzed outlier into an inbox idea — it inner-joins `video_analyses`, so a
 * freshly-scored outlier with no analysis row is invisible to it no matter how high its
 * score. Before this pass existed, analysis was on-demand only (the video detail page's
 * "Analyze" button), so on a real library only a handful of posts ever got analyzed and
 * the ideas inbox stayed nearly empty. This pass closes that gap by download-transcribe-
 * analyzing the channel's top unanalyzed outliers itself, so `video_analyses` is populated
 * by the time `generateIdeasForNewOutliers` runs later in the same sync.
 *
 * Same threshold as the ideas pass (`>= 3`, `ideas.ts`'s `threshold ?? 3`) so a post that
 * would qualify for an idea today also qualifies to be analyzed. A tighter, hard-coded cap
 * (10, not the ideas pass's 20): this pass buys real work per candidate — a download plus
 * a transcription plus an LLM call, versus the ideas pass's single LLM call — so a channel
 * with a long backlog of unanalyzed outliers should not spend a whole sync on it. No
 * settings key for either number yet (deliberately out of scope here); a later task can
 * expose them.
 */
export const AUTO_ANALYZE_THRESHOLD = 3;
export const AUTO_ANALYZE_CAP = 10;

export interface AutoAnalyzeSummary {
  /** Candidates actually reached before a stop (early `shouldStop`/tracker failure trims
   *  this below `candidates.length`). */
  attempted: number;
  /** `getOrCreateAnalysis` returned without throwing. */
  analyzed: number;
  /** A download was actually performed (i.e. `videoAssetId` was null going in and the
   *  download step reported success). Never counted for a video that already had an
   *  asset. */
  downloaded: number;
  /** Either the download or the analyze step failed for this candidate. */
  failed: number;
}

type DownloadFn = (videoId: string) => Promise<{ ok: boolean; error?: string }>;
type AnalyzeFn = (videoId: string) => Promise<unknown>;

/**
 * Finds the channel's unanalyzed outliers (`outlierScore >= threshold`, no
 * `video_analyses` row yet, top-scorers-first, capped) and, for each in order,
 * downloads the video if it has no local asset yet then analyzes it — the same
 * download-then-analyze shape `downloadVideoAction` + `getOrCreateAnalysis` already give
 * the on-demand "Analyze" button, just driven from the sync path instead of a click.
 *
 * Download is NOT the sync page-walk's eager `tryEnsureAsset(item.videoUrl, ...)`
 * (`sync-engine.ts`'s `EAGER_VIDEO_DOWNLOAD` path): that call uses the URL captured at
 * sync time, which Instagram's CDN signs and expires within hours, so by the time this
 * pass runs (after the whole page walk, after scoring) a stored URL from earlier in the
 * same run can already be dead. `downloadVideoAction` re-resolves the *current* URL via
 * `igClient.resolveMedia` first — the same reason the on-demand button does it that way —
 * so this pass reuses it directly rather than duplicating that re-resolve-then-fetch
 * logic. It is also the only extra file, besides `sync-engine.ts` itself, allow-listed in
 * `score-recompute-guard.test.ts` to write `tables.videos` at all; a second, ad-hoc write
 * path here would either fail that guard or need widening it for no reason, when the
 * existing action already does the write.
 *
 * `download`/`analyze` are injectable (default to the real `downloadVideoAction` /
 * `getOrCreateAnalysis`) so a test can substitute fakes instead of mocking two modules'
 * worth of network, ffmpeg and LLM calls — the same shape `generateIdeasForNewOutliers`
 * uses for its own `llm` override.
 *
 * Per-item errors (a dead 9router, a download that 404s, a transcript provider that's
 * unavailable) are caught and logged, never rethrown: one bad outlier must cost one
 * `failed` count, not the rest of the pass, and not the sync run itself. Like
 * `generateIdeasForNewOutliers`, this function itself never throws — `shouldStop`/`tick`
 * failures (both touch the database in production) end the pass early exactly like that
 * function's own tracker-failure branch, so `syncOneChannel` needs no try/catch around
 * this call either.
 */
export async function autoAnalyzeNewOutliers(
  channelId: string,
  opts: {
    threshold?: number;
    cap?: number;
    download?: DownloadFn;
    analyze?: AnalyzeFn;
    shouldStop?: () => Promise<boolean>;
    tick?: () => Promise<void>;
    /** The run whose trace these log lines belong to. Optional so a test (or a one-off
     *  script) can call the pass on its own. */
    runId?: string;
  } = {}
): Promise<AutoAnalyzeSummary> {
  const threshold = opts.threshold ?? AUTO_ANALYZE_THRESHOLD;
  const cap = opts.cap ?? AUTO_ANALYZE_CAP;
  const download = opts.download ?? downloadVideoAction;
  const analyze = opts.analyze ?? getOrCreateAnalysis;

  const summary: AutoAnalyzeSummary = { attempted: 0, analyzed: 0, downloaded: 0, failed: 0 };

  let candidates: { id: string; videoAssetId: string | null }[];
  try {
    candidates = await db
      .select({ id: tables.videos.id, videoAssetId: tables.videos.videoAssetId })
      .from(tables.videos)
      .leftJoin(tables.videoAnalyses, eq(tables.videoAnalyses.videoId, tables.videos.id))
      .where(
        and(
          eq(tables.videos.channelId, channelId),
          gte(tables.videos.outlierScore, threshold),
          isNull(tables.videoAnalyses.videoId),
          isNull(tables.videos.deletedAt)
        )
      )
      .orderBy(desc(tables.videos.outlierScore))
      .limit(cap);
  } catch (err) {
    log.error("auto_analyze.candidates_failed", {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    }, opts.runId);
    return summary;
  }

  for (const row of candidates) {
    try {
      await opts.tick?.();
      if (await opts.shouldStop?.()) {
        return summary;
      }
    } catch (err) {
      log.error("auto_analyze.tracker_failed", {
        channelId,
        error: err instanceof Error ? err.message : String(err),
        ...summary,
      }, opts.runId);
      return summary;
    }

    summary.attempted += 1;
    try {
      if (!row.videoAssetId) {
        const result = await download(row.id);
        if (!result.ok) {
          summary.failed += 1;
          log.error("auto_analyze.download_failed", {
            channelId,
            videoId: row.id,
            error: result.error ?? "unknown download failure",
          }, opts.runId);
          continue;
        }
        summary.downloaded += 1;
      }

      await analyze(row.id);
      summary.analyzed += 1;
    } catch (err) {
      summary.failed += 1;
      log.error("auto_analyze.item_failed", {
        channelId,
        videoId: row.id,
        error: err instanceof Error ? err.message : String(err),
      }, opts.runId);
    }
  }

  return summary;
}
