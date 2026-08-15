import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { getLlm, resolveModel, type LlmClient } from "@/server/llm/client";
import {
  VideoAnalysisSchema,
  type StoredAnalysisFields,
  type StoredVideoLayout,
} from "@/server/llm/schemas";
import { getOrCreateTranscript } from "@/server/transcribe";
import { ANALYZE_SYSTEM, buildAnalyzeUser } from "./prompts/analyze-prompt";

type TranscribeFn = (videoId: string) => Promise<{ text: string; source: string; cached: boolean }>;

/**
 * `VideoAnalysis` plus the Layout section's provenance columns (V1 data contracts,
 * contract 5). Kept as a separate, wider type rather than folding layout into
 * `VideoAnalysis` itself: `VideoAnalysisSchema` is validated 1:1 against what the text
 * model returns, and the text model never produces layout — a frame pass does, on a
 * separate row update, with its own model and its own timestamp. Every caller that only
 * wants hook/structure/format/style/why (remix.ts's prompt building) still gets a valid
 * `VideoAnalysis` for free, since this type is a strict superset.
 */
export interface StoredVideoAnalysis extends StoredAnalysisFields {
  /** Null until a frame pass has run. Never partially fabricated from the transcript —
   *  see the doc comment on `videoAnalyses.layout` in schema.ts. */
  layout: StoredVideoLayout | null;
  framesSampled: number | null;
  frameModel: string | null;
  framePassAt: string | null;
  framePassError: string | null;
}

// Exported for reuse by remix.ts (Task 5), which needs the same video_analyses row ->
// VideoAnalysis mapping to describe the source video's hook/structure to Claude.
export function rowToAnalysis(row: typeof tables.videoAnalyses.$inferSelect): StoredVideoAnalysis {
  return {
    hookType: row.hookType ?? "",
    structureSegments: row.structureSegments ?? [],
    formatTags: row.formatTags ?? [],
    styleTags: row.styleTags ?? [],
    whyItWorked: row.whyItWorked ?? "",
    layout: row.layout ?? null,
    framesSampled: row.framesSampled ?? null,
    frameModel: row.frameModel ?? null,
    framePassAt: row.framePassAt ?? null,
    framePassError: row.framePassError ?? null,
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
 * freshly synced video (sync and import never transcribe; DATA.md §7 always specified
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
  opts?: { llm?: LlmClient; transcribe?: TranscribeFn; force?: boolean }
): Promise<StoredAnalysisFields | null> {
  const [existing] = await db
    .select()
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, videoId))
    .limit(1);
  if (existing && !opts?.force) {
    // This function's own contract is plain `VideoAnalysis` (the text-model shape);
    // the Layout columns are a separate concern read by `getVideoDetail` directly via
    // `rowToAnalysis`, not by this cache-or-generate path. Stripped here rather than
    // widening this return type, so a caller of `getOrCreateAnalysis` never has to
    // know the Layout section exists.
    const { hookType, structureSegments, formatTags, styleTags, whyItWorked } = rowToAnalysis(existing);
    return { hookType, structureSegments, formatTags, styleTags, whyItWorked };
  }

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

  const textFields = {
    hookType: analysis.hookType,
    structureSegments: analysis.structureSegments,
    formatTags: analysis.formatTags,
    styleTags: analysis.styleTags,
    whyItWorked: analysis.whyItWorked,
    model: resolveModel(),
  };

  if (existing) {
    // A forced re-analysis updates the TEXT-model columns only. The Layout columns
    // (layout / framesSampled / frameModel / framePassAt / framePassError) belong to a
    // separate frame pass with its own provenance, and a re-analysis has seen no
    // frames — wiping them here would throw away a real reading, and copying them
    // forward under a new `model` would misattribute it. `createdAt` also stays: it
    // records when this video was first analyzed, which is still true.
    await db.update(tables.videoAnalyses).set(textFields).where(eq(tables.videoAnalyses.videoId, videoId));
  } else {
    await db.insert(tables.videoAnalyses).values({ videoId, ...textFields, createdAt: nowIso() });
  }

  return analysis;
}
