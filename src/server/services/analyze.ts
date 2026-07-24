import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { getLlm, resolveModel, type LlmClient } from "@/server/llm/client";
import { VideoAnalysisSchema, type VideoAnalysis } from "@/server/llm/schemas";
import { getOrCreateTranscript } from "@/server/transcribe";
import { ANALYZE_SYSTEM, buildAnalyzeUser } from "./prompts/analyze-prompt";

type TranscribeFn = (videoId: string) => Promise<{ text: string; source: string; cached: boolean }>;

// Exported for reuse by remix.ts (Task 5), which needs the same video_analyses row ->
// VideoAnalysis mapping to describe the source video's hook/structure to Claude.
export function rowToAnalysis(row: typeof tables.videoAnalyses.$inferSelect): VideoAnalysis {
  return {
    hookType: row.hookType ?? "",
    structureSegments: row.structureSegments ?? [],
    formatTags: row.formatTags ?? [],
    styleTags: row.styleTags ?? [],
    whyItWorked: row.whyItWorked ?? "",
  };
}

/**
 * Cached, on-demand Claude video analysis (Task 2 of the phase-3 plan; wired to
 * on-demand transcription per the final pre-ship review's finding B1). A cache hit
 * returns without ever touching the transcript or Claude.
 *
 * On a cache miss with no transcript yet, this now *creates* one via
 * `getOrCreateTranscript`'s cache-first whisper.cpp -> Groq chain instead of giving
 * up — before this fix, `transcribe/index.ts` had zero callers anywhere in
 * `app/`/`components/`/`actions/`, so Analyze was structurally dead on any
 * non-seeded video (sync and import never transcribe; DATA.md §7 always specified
 * transcription as on-demand, not automatic). A `NoTranscriptProviderError` from that
 * call (neither whisper.cpp nor Groq usable) propagates untouched — same as
 * `getLlm()`'s `NoApiKeyError` always has — for the action layer to map to a
 * friendly message.
 *
 * The `llm` client is resolved (via `getLlm()`, which throws `NoApiKeyError` when
 * unkeyed) only once a transcript is actually in hand and a fresh analysis is about
 * to be generated — a cache hit never touches Claude or the transcribe chain, and
 * transcribing itself needs no Claude key at all (whisper.cpp is local).
 */
export async function getOrCreateAnalysis(
  videoId: string,
  opts?: { llm?: LlmClient; transcribe?: TranscribeFn }
): Promise<VideoAnalysis | null> {
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

  const transcribe = opts?.transcribe ?? getOrCreateTranscript;
  const transcriptText = transcriptRow ? transcriptRow.text : (await transcribe(videoId)).text;

  const [video] = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  if (!video) return null; // no video row to analyze against (shouldn't happen given the FK, but stay defensive)

  const client = opts?.llm ?? getLlm();
  const analysis = await client.generateParsed({
    system: ANALYZE_SYSTEM,
    user: buildAnalyzeUser(
      { caption: video.caption, durationSec: video.durationSec, viewCount: video.viewCount, outlierScore: video.outlierScore },
      transcriptText
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
