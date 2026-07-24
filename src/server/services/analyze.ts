import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { getLlm, resolveModel, type LlmClient } from "@/server/llm/client";
import { VideoAnalysisSchema, type VideoAnalysis } from "@/server/llm/schemas";
import { ANALYZE_SYSTEM, buildAnalyzeUser } from "./prompts/analyze-prompt";

function rowToAnalysis(row: typeof tables.videoAnalyses.$inferSelect): VideoAnalysis {
  return {
    hookType: row.hookType ?? "",
    structureSegments: row.structureSegments ?? [],
    formatTags: row.formatTags ?? [],
    styleTags: row.styleTags ?? [],
    whyItWorked: row.whyItWorked ?? "",
  };
}

/**
 * Cached, on-demand Claude video analysis (Task 2 of the phase-3 plan). Returns
 * `null` when no transcript is available yet — analysis requires transcript text;
 * caption-only metadata isn't enough to ground hook/structure/why-it-worked.
 *
 * The `llm` client is resolved (via `getLlm()`, which throws `NoApiKeyError` when
 * unkeyed) only when a fresh analysis is actually about to be generated — a cache hit
 * or a missing transcript returns without ever touching Claude, so keyless mode still
 * renders already-analyzed videos and transcript-less videos with no Alert needed.
 */
export async function getOrCreateAnalysis(videoId: string, llm?: LlmClient): Promise<VideoAnalysis | null> {
  const [existing] = await db
    .select()
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, videoId))
    .limit(1);
  if (existing) return rowToAnalysis(existing);

  const [transcriptRow] = await db
    .select({ text: tables.transcripts.text })
    .from(tables.transcripts)
    .where(eq(tables.transcripts.videoId, videoId))
    .limit(1);
  if (!transcriptRow) return null;

  const [video] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  if (!video) return null; // no video row to analyze against (shouldn't happen given the FK, but stay defensive)

  const client = llm ?? getLlm();
  const analysis = await client.generateParsed({
    system: ANALYZE_SYSTEM,
    user: buildAnalyzeUser(
      { caption: video.caption, durationSec: video.durationSec, viewCount: video.viewCount, outlierScore: video.outlierScore },
      transcriptRow.text
    ),
    schema: VideoAnalysisSchema,
  });

  await db.insert(tables.videoAnalyses).values({
    videoId,
    hookType: analysis.hookType,
    structureSegments: analysis.structureSegments,
    formatTags: analysis.formatTags,
    styleTags: analysis.styleTags,
    whyItWorked: analysis.whyItWorked,
    model: resolveModel(),
    createdAt: nowIso(),
  });

  return analysis;
}
